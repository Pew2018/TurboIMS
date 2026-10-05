package io.github.turboims.ksu;

import org.junit.Test;

import static org.junit.Assert.*;

public class CarrierImsControlTest {
    @Test public void newConfigurationGetsItsOwnResetAfterSupersedingOldTask() {
        FakeOps f = new FakeOps(); f.readyAfter = 1;
        CarrierImsControl c = new CarrierImsControl(f);
        CarrierImsControl.Task task = new CarrierImsControl.Task();
        task.useConfiguration("old");
        assertTrue(task.observe(c, 17, 0, 20, 1000, millis -> {}).registered);
        task.useConfiguration("old");
        assertTrue(task.observe(c, 17, 0, 20, 1000, millis -> {}).registered);
        assertEquals(1, f.resets);
        task.useConfiguration("new");
        assertTrue(task.observe(c, 17, 0, 20, 1000, millis -> {}).registered);
        assertEquals(2, f.resets);
    }

    @Test public void resetRunsOnlyAfterVerifiedCarrierConfigState() {
        assertTrue(CarrierImsControl.isReadyForReset("verified"));
        assertTrue(CarrierImsControl.isReadyForReset("unchanged"));
        assertTrue(CarrierImsControl.isReadyForReset("restored"));
        assertFalse(CarrierImsControl.isReadyForReset("waiting"));
        assertFalse(CarrierImsControl.isReadyForReset("conflict"));
        assertFalse(CarrierImsControl.isReadyForReset("ownership_lost"));
        assertFalse(CarrierImsControl.isReadyForReset("partial"));
        assertFalse(CarrierImsControl.isReadyForReset(null));
    }

    static class FakeOps implements CarrierImsControl.Operations {
        int resets, reads, readyAfter = 25;
        boolean failReset, failRead;
        final java.util.List<Integer> slots = new java.util.ArrayList<>();
        public void reset(int slot) throws Exception {
            resets++; slots.add(slot);
            if (failReset) { failReset = false;
                throw new java.io.IOException("Telephony Binder service is unavailable"); }
        }
        public boolean isRegistered(int subId) throws Exception {
            reads++;
            if (failRead) { failRead = false;
                throw new java.io.IOException("Telephony Binder service is unavailable"); }
            return reads >= readyAfter;
        }
    }

    @Test public void slowRegistrationGetsOneResetAcrossAutomaticRetries() {
        FakeOps f = new FakeOps();
        CarrierImsControl c = new CarrierImsControl(f);
        CarrierImsControl.Task task = new CarrierImsControl.Task();
        assertEquals("ims_not_registered", task.observe(c, 17, 0, 20, 1000, millis -> {}).phase);
        assertEquals("ims_registered", task.observe(c, 17, 0, 20, 1000, millis -> {}).phase);
        assertEquals(1, f.resets);
        assertEquals(26, f.reads);
    }

    @Test public void unacceptedResetDoesNotConsumeTheTaskBudget() {
        FakeOps f = new FakeOps(); f.failReset = true; f.readyAfter = 1;
        CarrierImsControl c = new CarrierImsControl(f);
        CarrierImsControl.Task task = new CarrierImsControl.Task();
        CarrierImsControl.Registration first = task.observe(c, 17, 0, 20, 1000, millis -> {});
        assertEquals("waiting", first.phase); assertFalse(first.resetAccepted);
        assertEquals("ims_registered", task.observe(c, 17, 0, 20, 1000, millis -> {}).phase);
        assertEquals(2, f.resets);
    }

    @Test public void temporaryReadFailureAfterAcceptedResetDoesNotRepeatReset() {
        FakeOps f = new FakeOps(); f.failRead = true; f.readyAfter = 1;
        CarrierImsControl c = new CarrierImsControl(f);
        CarrierImsControl.Task task = new CarrierImsControl.Task();
        CarrierImsControl.Registration first = task.observe(c, 17, 0, 20, 1000, millis -> {});
        assertEquals("waiting", first.phase); assertTrue(first.resetAccepted);
        assertEquals("ims_registered", task.observe(c, 17, 0, 20, 1000, millis -> {}).phase);
        assertEquals(1, f.resets);
    }

    @Test public void singleStaleRegisteredSampleIsNotFinalSuccess() {
        final boolean[] observations = {true, false, false, true, true};
        final java.util.concurrent.atomic.AtomicInteger reads = new java.util.concurrent.atomic.AtomicInteger();
        CarrierImsControl c = new CarrierImsControl(new CarrierImsControl.Operations() {
            public void reset(int slot) {}
            public boolean isRegistered(int subId) { return observations[reads.getAndIncrement()]; }
        });
        CarrierImsControl.Registration result = new CarrierImsControl.Task()
                .observe(c, 17, 0, 5, 1000, millis -> {});
        assertTrue(result.registered); assertEquals(5, reads.get());
    }

    @Test public void eachSimGetsItsOwnResetBudgetAndSlot() {
        FakeOps f = new FakeOps(); f.readyAfter = 1;
        CarrierImsControl c = new CarrierImsControl(f);
        CarrierImsControl.Task task = new CarrierImsControl.Task();
        assertTrue(task.observe(c, 17, 0, 20, 1000, millis -> {}).registered);
        assertTrue(task.observe(c, 41, 1, 20, 1000, millis -> {}).registered);
        assertTrue(task.observe(c, 17, 0, 20, 1000, millis -> {}).registered);
        assertEquals(java.util.List.of(0,1), f.slots);
    }

}
