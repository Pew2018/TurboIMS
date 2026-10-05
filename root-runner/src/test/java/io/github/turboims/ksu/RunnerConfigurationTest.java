package io.github.turboims.ksu;

import java.nio.file.*;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class RunnerConfigurationTest {
    @Rule public final TemporaryFolder directory = new TemporaryFolder();
    private Path file(String name) { return directory.getRoot().toPath().resolve(name); }

    private void save(String text) throws Exception {
        try (RunnerConfiguration.Locked ignored =
                RunnerConfiguration.lock(file("config.lock"), true)) {
            Path replacement = file("config.tmp");
            Files.writeString(replacement, text);
            Files.move(replacement, file("config.json"), StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        }
    }

    @Test public void modeCanBeSavedWhileRegistrationHoldsOperationLock() throws Exception {
        save("{\"implementation_mode\":\"carrier_ims\"}");
        RunnerConfiguration.Snapshot old = new RunnerConfiguration.Snapshot(file("config.json"));
        CarrierImsControlTest.FakeOps ops = new CarrierImsControlTest.FakeOps();
        final int[] pauses = {0};
        CarrierImsControl.Registration observed;
        try (RunnerConfiguration.Locked operation =
                RunnerConfiguration.lock(file("operation.lock"), false)) {
            observed = new CarrierImsControl.Task().observe(new CarrierImsControl(ops),
                    1, 0, 20, 1000, millis -> {
                        // Save after the first post-reset sample, while the runner
                        // still owns operation.lock and is waiting for registration.
                        if (++pauses[0] == 2) {
                            try { save("{\"implementation_mode\":\"turboims\"}"); }
                            catch (Exception error) { throw new AssertionError(error); }
                        }
                    }, old::isCurrent);
        }
        assertEquals("superseded", observed.phase);
        assertTrue(observed.resetAccepted);
        assertEquals(1, ops.resets);
        assertEquals(1, ops.reads);
        assertTrue(Files.readString(file("config.json")).contains("turboims"));
        // The next manual apply can acquire the operation lock immediately.
        try (RunnerConfiguration.Locked next =
                RunnerConfiguration.lock(file("operation.lock"), false)) {
            assertFalse(old.isCurrent());
        }
    }

    @Test public void supersededTaskCannotResetImsOrPublishOverNewConfig() throws Exception {
        save("carrier_ims");
        RunnerConfiguration.Snapshot old = new RunnerConfiguration.Snapshot(file("config.json"));
        save("turboims");
        CarrierImsControlTest.FakeOps ops = new CarrierImsControlTest.FakeOps();
        CarrierImsControl.Registration observed = new CarrierImsControl.Task()
                .observe(new CarrierImsControl(ops), 1, 0, 20, 1000, millis -> {}, old::isCurrent);
        assertEquals("superseded", observed.phase);
        assertFalse(observed.resetAccepted);
        assertEquals(0, ops.resets);
        assertEquals(0, ops.reads);
        Files.writeString(file("status.json"), "new status");
        assertFalse(RunnerConfiguration.publish(file("config.json"), file("config.lock"),
                old.revision, () -> Files.writeString(file("status.json"), "old failure")));
        assertEquals("new status", Files.readString(file("status.json")));
        RunnerConfiguration.Snapshot current = new RunnerConfiguration.Snapshot(file("config.json"));
        assertTrue(RunnerConfiguration.publish(file("config.json"), file("config.lock"),
                current.revision, () -> Files.writeString(file("status.json"), "new applied")));
        assertEquals("new applied", Files.readString(file("status.json")));
    }

    @Test public void operationLockStillSerializesTelephonyMutations() throws Exception {
        try (RunnerConfiguration.Locked first =
                RunnerConfiguration.lock(file("operation.lock"), false)) {
            try {
                RunnerConfiguration.lock(file("operation.lock"), false).close();
                fail("Concurrent telephony operation was allowed");
            } catch (java.io.IOException expected) {
                assertEquals("Another runner operation is busy", expected.getMessage());
            }
            // A short config publication remains available during that operation.
            save("turboims");
        }
    }

    @Test public void snapshotParsesTheSameBytesUsedForRevision() throws Exception {
        save("before");
        RunnerConfiguration.Snapshot captured = new RunnerConfiguration.Snapshot(file("config.json"));
        save("after");
        assertEquals("before", captured.text);
        assertFalse(captured.isCurrent());
        try { captured.requireCurrent(); fail("Old snapshot remained current"); }
        catch (RunnerConfiguration.Superseded expected) { }
    }
}
