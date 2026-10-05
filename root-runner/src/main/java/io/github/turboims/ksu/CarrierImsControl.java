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
        public final boolean resetAccepted;
        Registration(boolean registered, String phase, String error) {
            this(registered, phase, error, false);
        }
        Registration(boolean registered, String phase, String error, boolean resetAccepted) {
            this.registered = registered;
            this.phase = phase;
            this.error = error;
            this.resetAccepted = resetAccepted;
        }
    }

    interface Operations {
        boolean isRegistered(int subId) throws Exception;
        void reset(int slot) throws Exception;
    }
    interface Pause { void waitFor(long millis) throws InterruptedException; }
    interface CurrentConfig { boolean isCurrent() throws Exception; }
    private final Operations operations;
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
        Object telephony = invoke(Class.forName(api.getName() + "$Stub")
                .getMethod("asInterface", IBinder.class), null, binder);
        if (telephony == null) throw new java.io.IOException("ITelephony is unavailable");
        Method registeredMethod = api.getMethod("isImsRegistered", int.class);
        Method resetMethod = api.getMethod("resetIms", int.class);
        operations = new Operations() {
            @Override public boolean isRegistered(int subId) throws Exception {
                return Boolean.TRUE.equals(invoke(registeredMethod, telephony, subId));
            }
            @Override public void reset(int slot) throws Exception {
                invoke(resetMethod, telephony, slot);
            }
        };
    }

    CarrierImsControl(Operations operations) {
        this.operations = operations;
        this.serviceSource = "injected";
    }

    /** One accepted reset per subscription within a bounded boot/manual task. */
    public static final class Task {
        private final java.util.Set<Integer> resetSubscriptions = new java.util.HashSet<>();
        private String configurationRevision = "";
        void useConfiguration(String revision) {
            if (!revision.equals(configurationRevision)) {
                resetSubscriptions.clear();
                configurationRevision = revision;
            }
        }
        public Registration observe(CarrierImsControl control, int subId, int slot,
                                    int attempts, long intervalMs) {
            return observe(control, subId, slot, attempts, intervalMs, Thread::sleep);
        }
        Registration observe(CarrierImsControl control, int subId, int slot,
                             int attempts, long intervalMs, Pause pause) {
            return observe(control, subId, slot, attempts, intervalMs, pause, () -> true);
        }
        Registration observe(CarrierImsControl control, int subId, int slot,
                             int attempts, long intervalMs, CurrentConfig current) {
            return observe(control, subId, slot, attempts, intervalMs, Thread::sleep, current);
        }
        Registration observe(CarrierImsControl control, int subId, int slot,
                             int attempts, long intervalMs, Pause pause, CurrentConfig current) {
            Registration result = control.observe(subId, slot, attempts, intervalMs,
                    !resetSubscriptions.contains(subId), pause, current);
            if (result.resetAccepted) resetSubscriptions.add(subId);
            return result;
        }
    }

    public String serviceSource() { return serviceSource; }

    static boolean isReadyForReset(String carrierConfigPhase) {
        return "verified".equals(carrierConfigPhase) || "unchanged".equals(carrierConfigPhase)
                || "restored".equals(carrierConfigPhase);
    }

    public boolean isRegistered(int subId) throws Exception {
        return operations.isRegistered(subId);
    }

    private Registration observe(int subId, int slot, int attempts, long intervalMs,
                                 boolean reset, Pause pause, CurrentConfig current) {
        boolean resetAccepted = false;
        if (reset) {
            try {
                if (!current.isCurrent())
                    return new Registration(false, "superseded", "", false);
                operations.reset(slot);
                resetAccepted = true;
                // The Binder call queues a reset. Do not immediately accept the
                // pre-reset registration bit as evidence of the final state.
                pause.waitFor(intervalMs);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new Registration(false, "ims_poll_interrupted", message(error), resetAccepted);
            } catch (Exception error) {
                return new Registration(false, AutoApply.isFrameworkNotReady(error)
                        ? "waiting" : "ims_reset_failed", message(error), resetAccepted);
            }
        }
        int consecutive = 0;
        for (int i = 0; i < attempts; i++) {
            try {
                if (!current.isCurrent())
                    return new Registration(false, "superseded", "", resetAccepted);
                consecutive = isRegistered(subId) ? consecutive + 1 : 0;
                if (consecutive >= 2)
                    return new Registration(true, "ims_registered", "", resetAccepted);
            } catch (Exception error) {
                return new Registration(false, AutoApply.isFrameworkNotReady(error)
                        ? "waiting" : "ims_status_unavailable", message(error), resetAccepted);
            }
            if (i + 1 < attempts) {
                try { pause.waitFor(intervalMs); }
                catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return new Registration(false, "ims_poll_interrupted",
                            "IMS polling was interrupted", resetAccepted);
                }
            }
        }
        return new Registration(false, "ims_not_registered",
                "IMS did not report stable registration before the bounded polling deadline",
                resetAccepted);
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
