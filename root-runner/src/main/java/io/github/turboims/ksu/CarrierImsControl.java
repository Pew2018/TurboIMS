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

    /**
     * CarrierConfig can already be unchanged while IMS is still using the previous
     * framework state (for example after a boot-time carrier reload). A reset that
     * follows a verified/unchanged/restored state therefore still needs a short
     * settle window whenever the caller knows that registration must be retried.
     */
    static long settleDelayMillis(String carrierConfigPhase, boolean needsReset) {
        return needsReset && isReadyForReset(carrierConfigPhase) ? 1500L : 0L;
    }

    public boolean isRegistered(int subId) throws Exception {
        return Boolean.TRUE.equals(invoke(registeredMethod, telephony, subId));
    }

    public Registration resetAndAwait(int subId, int slot, int attempts, long intervalMs) {
        return resetAndAwait(subId, slot, attempts, intervalMs, 0L);
    }

    public Registration resetAndAwait(int subId, int slot, int attempts, long intervalMs,
                                      long settleDelayMillis) {
        long settle = Math.max(0L, Math.min(5000L, settleDelayMillis));
        if (settle > 0L) {
            try { Thread.sleep(settle); }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return new Registration(false, "ims_settle_interrupted",
                        "CarrierConfig settle wait was interrupted");
            }
        }
        try {
            invoke(resetMethod, telephony, slot);
        } catch (Throwable error) {
            return new Registration(false, "ims_reset_failed", message(error));
        }
        return awaitRegistered(subId, attempts, intervalMs);
    }

    /** Wait without resetting again after final CarrierConfig reconciliation. */
    public Registration awaitRegistered(int subId, int attempts, long intervalMs) {
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
        // The framework registerer can be published shortly after carrier_config/isub.
        // Retry it before falling back to ServiceManager("phone"); the reference
        // Carrier IMS implementation uses this binder path on Android 16/17.
        for (int attempt = 0; attempt < 8; attempt++) {
            try {
                Class<?> initializer = Class.forName("android.telephony.TelephonyFrameworkInitializer");
                Object manager = initializer.getMethod("getTelephonyServiceManager").invoke(null);
                if (manager != null) {
                    Object registerer = manager.getClass().getMethod("getTelephonyServiceRegisterer")
                            .invoke(manager);
                    if (registerer != null) {
                        Method getter;
                        try {
                            getter = registerer.getClass().getMethod("get");
                        } catch (NoSuchMethodException hiddenGetter) {
                            getter = registerer.getClass().getDeclaredMethod("get");
                            getter.setAccessible(true);
                        }
                        Object binder = getter.invoke(registerer);
                        if (binder instanceof IBinder && ((IBinder) binder).pingBinder())
                            return (IBinder) binder;
                    }
                }
            } catch (Throwable unavailable) {
                // Hidden API or a not-yet-published registerer: retry below.
            }
            if (attempt + 1 < 8) {
                try { Thread.sleep(250L); }
                catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        return null;
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
