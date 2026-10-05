package io.github.turboims.ksu;

/** Bounded boot retries for framework readiness and configuration verification. */
public final class AutoApply {
    public static final int MAX_ATTEMPTS = 12;
    public static final long RETRY_MILLIS = 5000;

    public interface Attempt<T> { T run() throws Exception; }
    public interface Phase<T> { String of(T result) throws Exception; }
    public interface Pause { void waitFor(long millis) throws Exception; }

    public static boolean isRetryablePhase(String value) {
        return "waiting".equals(value) || "ims_not_registered".equals(value)
                || "carrier_config_reloaded".equals(value) || "sim_identity_pending".equals(value);
    }

    /** Retry registration observation; Engine/Task prevent repeated writes and accepted resets. */
    static String automaticPhase(String phase, boolean configurationApplied) {
        if ("superseded".equals(phase)) return "waiting";
        return phase;
    }

    static boolean isFrameworkNotReady(Exception error) {
        if ("android.os.DeadObjectException".equals(error.getClass().getName())) return true;
        if (!(error instanceof java.io.IOException)) return false;
        String message = error.getMessage();
        return "Binder service not ready: isub".equals(message)
                || "Binder service not ready: carrier_config".equals(message)
                || "Telephony Binder service is unavailable".equals(message)
                || "ITelephony is unavailable".equals(message);
    }

    /** A transient result from one SIM cannot hide a terminal error on another. */
    static String resultPhase(String carrierPhase, String... observations) {
        if (!isRetryablePhase(carrierPhase)
                && !java.util.Set.of("active", "paused", "probe", "configured_partial").contains(carrierPhase))
            return carrierPhase;
        for (String phase : observations)
            if (!phase.isEmpty() && !phase.equals("configured_partial")
                    && !isRetryablePhase(phase)) return phase;
        for (String phase : observations)
            if (!phase.isEmpty() && !phase.equals("configured_partial")) return phase;
        for (String phase : observations)
            if (phase.equals("configured_partial")) return phase;
        return carrierPhase;
    }

    public static <T> T untilReady(Attempt<T> attempt, Phase<T> phase, Pause pause)
            throws Exception {
        T result = null;
        for (int count = 0; count < MAX_ATTEMPTS; count++) {
            result = attempt.run();
            if (!isRetryablePhase(phase.of(result))) return result;
            if (count + 1 < MAX_ATTEMPTS) pause.waitFor(RETRY_MILLIS);
        }
        return result;
    }

    private AutoApply() {}
}
