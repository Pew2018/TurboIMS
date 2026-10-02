package io.github.turboims.ksu;

/** Bounded boot readiness retries; only "waiting" is retryable. */
public final class AutoApply {
    public static final int MAX_ATTEMPTS = 12;
    public static final long RETRY_MILLIS = 5000;

    public interface Attempt<T> { T run() throws Exception; }
    public interface Phase<T> { String of(T result) throws Exception; }
    public interface Pause { void waitFor(long millis) throws Exception; }

    public static <T> T untilReady(Attempt<T> attempt, Phase<T> phase, Pause pause)
            throws Exception {
        T result = null;
        for (int count = 0; count < MAX_ATTEMPTS; count++) {
            result = attempt.run();
            if (!"waiting".equals(phase.of(result))) return result;
            if (count + 1 < MAX_ATTEMPTS) pause.waitFor(RETRY_MILLIS);
        }
        return result;
    }

    private AutoApply() {}
}
