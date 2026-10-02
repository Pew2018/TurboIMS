package io.github.turboims.ksu;
import org.junit.Test;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class AutoApplyTest {
    @Test public void successExitsWithoutPeriodicRetry() throws Exception {
        AtomicInteger runs = new AtomicInteger(), waits = new AtomicInteger();
        String phase = AutoApply.untilReady(() -> {
            runs.incrementAndGet(); return "active";
        }, result -> result, delay -> waits.incrementAndGet());
        assertEquals("active", phase);
        assertEquals(1, runs.get()); assertEquals(0, waits.get());
    }
    @Test public void onlyReadinessIsRetriedAndItIsBounded() throws Exception {
        AtomicInteger runs = new AtomicInteger(), waits = new AtomicInteger();
        String phase = AutoApply.untilReady(() -> {
            runs.incrementAndGet(); return "waiting";
        }, result -> result, delay -> {
            assertEquals(5000, delay);
            waits.incrementAndGet();
        });
        assertEquals("waiting", phase);
        assertEquals(12, runs.get()); assertEquals(11, waits.get());
    }
    @Test public void verificationFailureStopsImmediately() throws Exception {
        AtomicInteger runs = new AtomicInteger();
        assertEquals("error", AutoApply.untilReady(() -> {
            runs.incrementAndGet(); return "error";
        }, result -> result, delay -> fail("no retry on verification error")));
        assertEquals(1, runs.get());
    }
    @Test public void alreadyVerifiedSimIsNotWrittenAgainOnNextAttempt() throws Exception {
        BatchRunnerTest.Fake fake = new BatchRunnerTest.Fake();
        fake.values.put(Engine.LOADED, false);
        AtomicInteger attempt = new AtomicInteger();
        String phase = AutoApply.untilReady(() -> {
            if (attempt.incrementAndGet() == 2) fake.values.put(Engine.LOADED, true);
            return fake.run(false).phase;
        }, result -> result, delay -> {});
        assertEquals("active", phase);
        assertEquals(1, fake.writes);
        assertEquals(1, fake.second.writes);
    }
}
