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
            Class<?>[] p = method.getParameterTypes();
            if (method.getName().equals("setCarrierTestOverride") && p.length == 10
                    && p[0] == int.class && p[1] == String.class
                    && p[2] == String.class && p[3] == String.class && p[4] == String.class
                    && p[5] == String.class && p[6] == String.class && p[7] == String.class
                    && p[8].isArray() && p[9].isArray()) { found = method; break; }
        }
        if (found == null) throw new NoSuchMethodException("ITelephony.setCarrierTestOverride signature unavailable");
        setMethod = found;
        Method clear;
        try { clear = api.getMethod("clearCarrierTestOverride", int.class); }
        catch (NoSuchMethodException e) { clear = null; }
        clearMethod = clear;
    }

    public static boolean hasRecord(int subId) {
        return Files.exists(JsonIO.STATE.resolve("carrier-test-override-" + subId + ".json"));
    }

    public Map<String, Object> apply(int subId, int slot, String mccmnc) throws Exception {
        if (mccmnc == null || !mccmnc.matches("[0-9]{5,6}"))
            throw new IllegalArgumentException("Carrier test MCC/MNC must contain 5 or 6 digits");
        Path path = path(subId);
        JSONObject old = Files.exists(path) ? JsonIO.read(path) : null;
        String prior = null;
        if (old != null) {
            if (!OWNER.equals(old.optString("owner")) || old.optInt("slot", -1) != slot)
                throw new IllegalStateException("Carrier test override ownership/slot conflict");
            if (!"applied".equals(old.optString("phase")))
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

    public Map<String, Object> clearOwned(int subId, int slot) throws Exception {
        Path path = path(subId);
        if (!Files.exists(path)) return result(subId, slot, "", "not_owned", true);
        JSONObject saved = JsonIO.read(path);
        if (!OWNER.equals(saved.optString("owner")) || saved.optInt("slot", -1) != slot)
            throw new IllegalStateException("Carrier test override ownership/slot conflict; refusing to clear");
        if (!"applied".equals(saved.optString("phase")))
            throw new IllegalStateException("Carrier test override ownership is uncertain; refusing to clear");
        if (clearMethod == null)
            throw new NoSuchMethodException("ITelephony.clearCarrierTestOverride is unavailable; refusing unsafe fallback");
        invoke(clearMethod, telephony, subId);
        Files.deleteIfExists(path);
        return result(subId, slot, saved.optString("mccmnc", ""), "cleared_owned", true);
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
