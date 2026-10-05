package io.github.turboims.ksu;

import android.os.IBinder;
import org.json.JSONObject;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Tracks and clears only Carrier test overrides successfully written by this module. */
public final class CarrierTestOverrideControl {
    private static final String OWNER = "turboims-next";
    private final Object telephony;
    private final Method setMethod;
    private final Method clearMethod;
    private final String session;
    private final RecordStore records;
    static final int IDENTITY_SCHEMA = 2;

    public CarrierTestOverrideControl(String session) throws Exception {
        this.session = session;
        this.records = new FileRecords();
        Class<?> sm = Class.forName("android.os.ServiceManager");
        IBinder binder = (IBinder) invoke(sm.getMethod("getService", String.class), null, "phone");
        if (binder == null || !binder.pingBinder()) throw new java.io.IOException("Telephony Binder service is unavailable");
        Class<?> api = Class.forName("com.android.internal.telephony.ITelephony");
        telephony = invoke(Class.forName(api.getName() + "$Stub").getMethod("asInterface", IBinder.class), null, binder);
        if (telephony == null) throw new java.io.IOException("ITelephony is unavailable");
        Method found = null;
        for (Method method : api.getMethods()) {
            if (supportsCarrierTestOverrideSignature(method)) { found = method; break; }
        }
        if (found == null) throw new NoSuchMethodException("ITelephony.setCarrierTestOverride signature unavailable");
        setMethod = found;
        Method clear;
        try { clear = api.getMethod("clearCarrierTestOverride", int.class); }
        catch (NoSuchMethodException e) { clear = null; }
        clearMethod = clear;
    }

    /**
     * Android's ITelephony changed the final carrier-privilege/APN arguments from
     * legacy arrays to strings. Both forms accept null for these optional fields.
     */
    static boolean supportsCarrierTestOverrideSignature(Method method) {
        if (!method.getName().equals("setCarrierTestOverride")) return false;
        Class<?>[] p = method.getParameterTypes();
        if (p.length != 10 || p[0] != int.class) return false;
        for (int i = 1; i <= 7; i++) {
            if (p[i] != String.class) return false;
        }
        return isStringOrLegacyArray(p[8]) && isStringOrLegacyArray(p[9]);
    }

    private static boolean isStringOrLegacyArray(Class<?> type) {
        return type == String.class || type.isArray();
    }

    public static boolean hasRecord(int subId) {
        return Files.exists(JsonIO.STATE.resolve("carrier-test-override-" + subId + ".json"));
    }

    interface RecordStore {
        Map<String, Object> read(int subId) throws Exception;
        void write(int subId, Map<String, Object> record) throws Exception;
        void delete(int subId) throws Exception;
    }

    CarrierTestOverrideControl(Object telephony, Method setMethod, Method clearMethod,
                               String session, RecordStore records) {
        this.telephony = telephony; this.setMethod = setMethod; this.clearMethod = clearMethod;
        this.session = session; this.records = records;
    }

    public Map<String, Object> apply(int subId, int slot, String mccmnc,
                                    String observedMccMnc, String subscriptionMccMnc) throws Exception {
        if (!isValidMccMnc(mccmnc))
            throw new IllegalArgumentException("Carrier test MCC/MNC must contain 5 or 6 digits");
        Map<String, Object> old = records.read(subId);
        if (old != null) {
            requireOwner(old, subId, slot);
            if (!session.equals(string(old, "session"))) {
                // This API changes in-memory IccRecords, not the physical SIM.
                // A prior boot's request cannot authorize a write to this boot's identity.
                records.delete(subId);
                old = null;
            }
        }
        String prior = null;
        String nativeCode = "";
        String priorPhase = "";
        if (old != null) {
            priorPhase = string(old, "phase");
            requireSettledPhase(priorPhase);
            prior = string(old, "mccmnc");
            nativeCode = string(old, "native_mccmnc");
            // Legacy records used empty IMSI/ICCID and must never bypass the corrected call.
            if (integer(old, "identity_schema") == IDENTITY_SCHEMA && "applied".equals(priorPhase)
                    && canReuse(mccmnc, prior, session, string(old, "session"), observedMccMnc))
                return result(subId, slot, mccmnc, "already_owned", false);
        } else if (isValidMccMnc(observedMccMnc) && observedMccMnc.equals(subscriptionMccMnc)) {
            // Capture before our first write. Never recover a legacy baseline from
            // SubscriptionInfo: it can itself contain the module's test PLMN.
            nativeCode = observedMccMnc;
        }
        records.write(subId, record(subId, slot, mccmnc, nativeCode, "pending"));
        try {
            set(subId, mccmnc);
            records.write(subId, record(subId, slot, mccmnc, nativeCode, "applied"));
            return result(subId, slot, mccmnc, "binder_accepted", true);
        } catch (Throwable error) {
            if (prior != null && isValidMccMnc(prior)) {
                try {
                    set(subId, prior);
                    // Rollback also preserves optional native identities.
                    records.write(subId, record(subId, slot, prior, nativeCode, priorPhase));
                } catch (Throwable rollback) {
                    error.addSuppressed(rollback);
                    records.write(subId, record(subId, slot, mccmnc, nativeCode, "uncertain"));
                }
            } else records.write(subId, record(subId, slot, mccmnc, nativeCode, "uncertain"));
            throw asException(error);
        }
    }

    public Map<String, Object> clearOwned(int subId, int slot, String observedMccMnc) throws Exception {
        Map<String, Object> saved = records.read(subId);
        if (saved == null) return result(subId, slot, "", "not_owned", false);
        requireOwner(saved, subId, slot);
        String previousCode = string(saved, "mccmnc");
        if (!session.equals(string(saved, "session"))) {
            records.delete(subId);
            return result(subId, slot, previousCode, "expired_boot_record", false);
        }
        requireSettledPhase(string(saved, "phase"));
        if (clearMethod != null) {
            invoke(clearMethod, telephony, subId);
            records.delete(subId);
            return result(subId, slot, previousCode, "cleared_owned", true);
        }
        String nativeCode = string(saved, "native_mccmnc");
        if (integer(saved, "identity_schema") != IDENTITY_SCHEMA || !isValidMccMnc(nativeCode))
            throw new CleanupRequiresReboot();
        if ("restored_fallback".equals(string(saved, "phase")) && canReuse(nativeCode, previousCode,
                session, string(saved, "session"), observedMccMnc))
            return result(subId, slot, nativeCode, "already_restored_native_identity", false);
        // A proven pre-write baseline, never a possibly contaminated live subscription.
        // This restores native fields; the framework test-mode bit may remain until reboot.
        set(subId, nativeCode);
        records.write(subId, record(subId, slot, nativeCode, nativeCode, "restored_fallback"));
        return result(subId, slot, nativeCode, "restored_native_identity_fallback", true);
    }

    static final class CleanupRequiresReboot extends IllegalStateException {
        CleanupRequiresReboot() {
            super("Legacy carrier test override has no trusted pre-write identity and "
                    + "clearCarrierTestOverride is unavailable; reboot to remove the volatile override");
        }
    }

    private static void requireOwner(Map<String, Object> record, int subId, int slot) {
        if (!OWNER.equals(string(record, "owner")) || integer(record, "slot") != slot
                || integer(record, "sub_id") != subId)
            throw new IllegalStateException("Carrier test override ownership/slot conflict");
    }
    private static void requireSettledPhase(String phase) {
        if (!"applied".equals(phase) && !"restored_fallback".equals(phase))
            throw new IllegalStateException("Previous Carrier test override state is uncertain; reboot before retry");
    }
    private static String string(Map<String, Object> record, String key) {
        Object value = record.get(key); return value instanceof String ? (String) value : "";
    }
    private static int integer(Map<String, Object> record, String key) {
        Object value = record.get(key); return value instanceof Number ? ((Number) value).intValue() : -1;
    }

    static boolean canReuse(String requested, String previous, String currentSession,
                            String savedSession, String observedMccMnc) {
        return requested.equals(previous) && currentSession.equals(savedSession)
                && requested.equals(observedMccMnc);
    }

    static boolean isValidMccMnc(String mccmnc) {
        return mccmnc != null && mccmnc.matches("[0-9]{5,6}");
    }

    private void set(int subId, String code) throws Exception {
        // Null means preserve the real IMSI, ICCID, GIDs, PNN/SPN, privileges and APN.
        // Empty strings are explicit fake values and can prevent IMS registration.
        invoke(setMethod, telephony, subId, code, null, null, null, null, null, null, null, null);
    }
    private static Path path(int subId) { return JsonIO.STATE.resolve("carrier-test-override-" + subId + ".json"); }
    private Map<String, Object> record(int subId, int slot, String code, String nativeCode, String phase) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("owner", OWNER); out.put("sub_id", subId); out.put("slot", slot);
        out.put("mccmnc", code); out.put("native_mccmnc", nativeCode);
        out.put("identity_schema", IDENTITY_SCHEMA); out.put("phase", phase);
        out.put("session", session); out.put("time_ms", System.currentTimeMillis());
        return out;
    }
    private static final class FileRecords implements RecordStore {
        public Map<String, Object> read(int subId) throws Exception {
            if (!Files.exists(path(subId))) return null;
            JSONObject json = JsonIO.read(path(subId));
            Map<String, Object> out = new LinkedHashMap<>();
            json.keys().forEachRemaining(key -> out.put(key, json.opt(key)));
            return out;
        }
        public void write(int subId, Map<String, Object> record) throws Exception {
            JsonIO.write(path(subId), new JSONObject(record));
        }
        public void delete(int subId) throws Exception { Files.deleteIfExists(path(subId)); }
    }
    private static Map<String, Object> result(int subId, int slot, String code, String phase, boolean accepted) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sub_id", subId); out.put("slot", slot); out.put("mccmnc", code); out.put("phase", phase);
        out.put("identity_schema", IDENTITY_SCHEMA);
        out.put("optional_identity_policy", "preserve_native");
        out.put("binder_accepted", accepted); out.put("readback_available", false); out.put("readback_verified", false);
        return out;
    }
    private static Exception asException(Throwable t) {
        Throwable actual = t;
        while (actual instanceof InvocationTargetException && actual.getCause() != null) actual = actual.getCause();
        return actual instanceof Exception ? (Exception) actual : new IllegalStateException(actual);
    }
    private static Object invoke(Method method, Object receiver, Object... args) throws Exception {
        try { return method.invoke(receiver, args); }
        catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new IllegalStateException("Telephony method failed: " + method.getName(), cause);
        }
    }
}
