package io.github.turboims.ksu;

import android.os.IBinder;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Carrier IMS-only telephony operations. Uses the device ITelephony Binder from
 * the existing KSU runner; no Shizuku or companion process is involved.
 */
public final class CarrierImsControl {
    public static final class Registration {
        public final boolean registered;
        public final String phase;
        public final String error;
        Registration(boolean registered, String phase, String error) {
            this.registered = registered;
            this.phase = phase;
            this.error = error;
        }
    }

    private final Object telephony;
    private final Method registeredMethod;
    private final Method resetMethod;
    private final String serviceSource;

    public CarrierImsControl() throws Exception {
        IBinder binder = frameworkTelephonyBinder();
        serviceSource = binder != null ? "telephony_framework" : "service_manager_phone";
        if (binder == null) {
            Class<?> sm = Class.forName("android.os.ServiceManager");
            binder = (IBinder) invoke(sm.getMethod("getService", String.class), null, "phone");
        }
        if (binder == null || !binder.pingBinder())
            throw new java.io.IOException("Telephony Binder service is unavailable");
        Class<?> api = Class.forName("com.android.internal.telephony.ITelephony");
        telephony = invoke(Class.forName(api.getName() + "$Stub")
                .getMethod("asInterface", IBinder.class), null, binder);
        if (telephony == null) throw new java.io.IOException("ITelephony is unavailable");
        registeredMethod = api.getMethod("isImsRegistered", int.class);
        resetMethod = api.getMethod("resetIms", int.class);
    }

    public String serviceSource() { return serviceSource; }

    static boolean isReadyForReset(String carrierConfigPhase) {
        return "verified".equals(carrierConfigPhase) || "unchanged".equals(carrierConfigPhase)
                || "restored".equals(carrierConfigPhase);
    }

    public boolean isRegistered(int subId) throws Exception {
        return Boolean.TRUE.equals(invoke(registeredMethod, telephony, subId));
    }

    public Registration resetAndAwait(int subId, int slot, int attempts, long intervalMs) {
        try {
            invoke(resetMethod, telephony, slot);
        } catch (Throwable error) {
            return new Registration(false, "ims_reset_failed", message(error));
        }
        for (int i = 0; i < attempts; i++) {
            try {
                if (isRegistered(subId))
                    return new Registration(true, "ims_registered", "");
            } catch (Throwable error) {
                return new Registration(false, "ims_status_unavailable", message(error));
            }
            if (i + 1 < attempts) {
                try { Thread.sleep(intervalMs); }
                catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return new Registration(false, "ims_poll_interrupted", "IMS polling was interrupted");
                }
            }
        }
        return new Registration(false, "ims_not_registered",
                "IMS did not report registered before the bounded polling deadline");
    }

    /**
     * Android 17's reference implementation resolves ITelephony through the
     * framework service registerer. Older vendor images may not expose it to this
     * process, so retain the established ServiceManager("phone") fallback.
     */
    private static IBinder frameworkTelephonyBinder() {
        try {
            Class<?> initializer = Class.forName("android.telephony.TelephonyFrameworkInitializer");
            Object manager = initializer.getMethod("getTelephonyServiceManager").invoke(null);
            if (manager == null) return null;
            Object registerer = manager.getClass().getMethod("getTelephonyServiceRegisterer")
                    .invoke(manager);
            if (registerer == null) return null;
            Object binder = registerer.getClass().getMethod("get").invoke(registerer);
            return binder instanceof IBinder && ((IBinder) binder).pingBinder()
                    ? (IBinder) binder : null;
        } catch (Throwable unavailable) {
            return null;
        }
    }

    private static String message(Throwable error) {
        Throwable actual = error;
        while ((actual instanceof InvocationTargetException) && actual.getCause() != null)
            actual = actual.getCause();
        String detail = actual.getMessage();
        return actual.getClass().getSimpleName() + (detail == null ? "" : ": " + detail);
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
