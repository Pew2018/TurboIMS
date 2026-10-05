package io.github.turboims.ksu;
import org.junit.Test;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class AutoApplyTest {
    @Test public void verifiedConfigurationDoesNotRetryAbsentRegistration() throws Exception {
        int[] passes = {0};
        String observed = AutoApply.untilReady(() -> {
            passes[0]++;
            return "ims_not_registered";
        }, phase -> AutoApply.automaticPhase(phase, true),
                millis -> fail("Verified configuration must not repeat registration waiting"));
        assertEquals("ims_not_registered", observed);
        assertEquals(1, passes[0]);
    }

    @Test public void readinessAndVerificationStillUseBoundedRetries() {
        assertEquals("waiting", AutoApply.automaticPhase("waiting", true));
        assertEquals("waiting", AutoApply.automaticPhase("superseded", false));
        assertEquals("sim_identity_pending", AutoApply.automaticPhase("sim_identity_pending", false));
        assertEquals("carrier_config_reloaded", AutoApply.automaticPhase("carrier_config_reloaded", false));
        assertEquals("ims_not_registered", AutoApply.automaticPhase("ims_not_registered", false));
        assertEquals("verification_failed", AutoApply.automaticPhase("verification_failed", true));
        assertEquals("ims_status_unavailable", AutoApply.automaticPhase("ims_status_unavailable", true));
    }

    @Test public void postResetReloadRetriesBeforeReportingSuccess() throws Exception {
        AtomicInteger runs = new AtomicInteger(), waits = new AtomicInteger();
        assertEquals("active", AutoApply.untilReady(
                () -> runs.incrementAndGet() == 1 ? "carrier_config_reloaded" : "active",
                result -> result, delay -> waits.incrementAndGet()));
        assertEquals(2, runs.get());
        assertEquals(1, waits.get());
        assertFalse(AutoApply.isRetryablePhase("ownership_lost"));
        assertFalse(AutoApply.isRetryablePhase("verification_failed"));
    }

    @Test public void onlyKnownServiceReadinessErrorsAreRetryable() {
        assertTrue(AutoApply.isFrameworkNotReady(new java.io.IOException("Binder service not ready: isub")));
        assertTrue(AutoApply.isFrameworkNotReady(new java.io.IOException("Binder service not ready: carrier_config")));
        assertTrue(AutoApply.isFrameworkNotReady(new java.io.IOException("Telephony Binder service is unavailable")));
        assertFalse(AutoApply.isFrameworkNotReady(new SecurityException("Binder service not ready: isub")));
        assertFalse(AutoApply.isFrameworkNotReady(new java.io.IOException("disk failure")));
    }

    @Test public void successExitsWithoutPeriodicRetry() throws Exception {
        AtomicInteger runs = new AtomicInteger(), waits = new AtomicInteger();
        String phase = AutoApply.untilReady(() -> {
            runs.incrementAndGet(); return "active";
        }, result -> result, delay -> waits.incrementAndGet());
        assertEquals("active", phase);
        assertEquals(1, runs.get()); assertEquals(0, waits.get());
    }
    @Test public void retryableReadinessIsBounded() throws Exception {
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
    @Test public void imsRegistrationCanSettleAcrossBoundedRetries() throws Exception {
        AtomicInteger runs = new AtomicInteger(), waits = new AtomicInteger();
        String phase = AutoApply.untilReady(() -> {
            return runs.incrementAndGet() < 3 ? "ims_not_registered" : "active";
        }, result -> result, delay -> waits.incrementAndGet());
        assertEquals("active", phase);
        assertEquals(3, runs.get()); assertEquals(2, waits.get());
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

    @Test public void transientRegistrationCannotMaskTerminalSimFailure() {
        assertEquals("verification_failed",
                AutoApply.resultPhase("waiting", "ims_not_registered", "verification_failed"));
        assertEquals("carrier_test_override_failed",
                AutoApply.resultPhase("active", "waiting", "carrier_test_override_failed"));
        assertEquals("ownership_lost",
                AutoApply.resultPhase("ownership_lost", "waiting", "ims_not_registered"));
        assertEquals("waiting", AutoApply.resultPhase("active", "waiting", "ims_not_registered"));
        assertEquals("active", AutoApply.resultPhase("active", "", ""));
    }

    @Test public void visibleSimPropertiesCanSettleWithoutPermanentBlock() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        assertEquals("active", AutoApply.untilReady(
                () -> calls.incrementAndGet() < 3 ? "sim_identity_pending" : "active",
                phase -> phase, millis -> {}));
        assertEquals(3, calls.get());
    }

}
