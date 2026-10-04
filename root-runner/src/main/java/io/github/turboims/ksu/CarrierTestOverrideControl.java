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

    public CarrierTestOverrideControl(String session) throws Exception {
        this.session = session;
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

    public Map<String, Object> apply(int subId, int slot, String mccmnc) throws Exception {
        if (!isValidMccMnc(mccmnc))
            throw new IllegalArgumentException("Carrier test MCC/MNC must contain 5 or 6 digits");
        Path path = path(subId);
        JSONObject old = Files.exists(path) ? JsonIO.read(path) : null;
        String prior = null;
        if (old != null) {
            if (!OWNER.equals(old.optString("owner")) || old.optInt("slot", -1) != slot)
                throw new IllegalStateException("Carrier test override ownership/slot conflict");
            String oldPhase = old.optString("phase");
            if (!"applied".equals(oldPhase) && !"restored_fallback".equals(oldPhase))
                throw new IllegalStateException("Previous Carrier test override state is uncertain; inspect diagnostics before retry");
            prior = old.optString("mccmnc", "");
            if (mccmnc.equals(prior) && session.equals(old.optString("session")))
                return result(subId, slot, mccmnc, "already_owned", true);
        }
        JsonIO.write(path, record(subId, slot, mccmnc, "pending"));
        try {
            set(subId, mccmnc);
            JsonIO.write(path, record(subId, slot, mccmnc, "applied"));
            return result(subId, slot, mccmnc, "binder_accepted", true);
        } catch (Throwable error) {
            if (prior != null) {
                try { set(subId, prior); JsonIO.write(path, old); }
                catch (Throwable rollback) {
                    error.addSuppressed(rollback);
                    JsonIO.write(path, record(subId, slot, mccmnc, "uncertain"));
                }
            } else JsonIO.write(path, record(subId, slot, mccmnc, "uncertain"));
            throw asException(error);
        }
    }

    public Map<String, Object> clearOwned(int subId, int slot, String nativeMccMnc) throws Exception {
        Path path = path(subId);
        if (!Files.exists(path)) return result(subId, slot, "", "not_owned", true);
        JSONObject saved = JsonIO.read(path);
        if (!OWNER.equals(saved.optString("owner")) || saved.optInt("slot", -1) != slot)
            throw new IllegalStateException("Carrier test override ownership/slot conflict; refusing to clear");
        String savedPhase = saved.optString("phase");
        if (!"applied".equals(savedPhase) && !"restored_fallback".equals(savedPhase))
            throw new IllegalStateException("Carrier test override ownership is uncertain; refusing to clear");
        String previousCode = saved.optString("mccmnc", "");
        if (clearMethod != null) {
            invoke(clearMethod, telephony, subId);
            Files.deleteIfExists(path);
            return result(subId, slot, previousCode, "cleared_owned", true);
        }

        // Android 16 builds may not expose clearCarrierTestOverride. Mirror the
        // reference implementation only when this module's ownership record proves
        // that the current override is ours, and only with the active subscription's
        // real MCC/MNC supplied by AndroidCarrierBackend's ISub SubscriptionInfo.
        if (!isValidMccMnc(nativeMccMnc))
            throw new IllegalStateException("clearCarrierTestOverride unavailable and active SIM MCC/MNC could not be read; retaining owned override state");
        set(subId, nativeMccMnc);
        JsonIO.write(path, record(subId, slot, nativeMccMnc, "restored_fallback"));
        return result(subId, slot, nativeMccMnc, "restored_native_identity_fallback", true);
    }

    static boolean isValidMccMnc(String mccmnc) {
        return mccmnc != null && mccmnc.matches("[0-9]{5,6}");
    }

    /**
     * The reference Carrier IMS implementation changes only the country MCC and
     * preserves the physical SIM's MNC. Replacing the full MCC/MNC (for example,
     * 46001 -> 46692) selects a foreign carrier identity and can prevent the real
     * operator's IMS credentials from registering.
     */
    static String preserveNativeMnc(String requestedMccMnc, String nativeMccMnc) {
        if (!isValidMccMnc(requestedMccMnc))
            throw new IllegalArgumentException("Requested Carrier test MCC/MNC is invalid");
        if (!isValidMccMnc(nativeMccMnc))
            throw new IllegalArgumentException("Native SIM MCC/MNC is unavailable");
        return requestedMccMnc.substring(0, 3) + nativeMccMnc.substring(3);
    }

    private void set(int subId, String code) throws Exception {
        invoke(setMethod, telephony, subId, code, "", "", "", "", "", "", null, null);
    }
    private Path path(int subId) { return JsonIO.STATE.resolve("carrier-test-override-" + subId + ".json"); }
    private JSONObject record(int subId, int slot, String code, String phase) throws Exception {
        return new JSONObject().put("owner", OWNER).put("sub_id", subId).put("slot", slot)
                .put("mccmnc", code).put("phase", phase).put("session", session)
                .put("time_ms", System.currentTimeMillis());
    }
    private static Map<String, Object> result(int subId, int slot, String code, String phase, boolean accepted) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sub_id", subId); out.put("slot", slot); out.put("mccmnc", code); out.put("phase", phase);
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
