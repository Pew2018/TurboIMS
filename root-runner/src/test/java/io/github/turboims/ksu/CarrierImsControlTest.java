package io.github.turboims.ksu;

import org.junit.Test;

import static org.junit.Assert.*;

public class CarrierImsControlTest {
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
    @Test public void changedVerifiedConfigGetsFrameworkSettleWindow() {
        assertEquals(1500L, CarrierImsControl.settleDelayMillis("verified", true));
        assertEquals(1500L, CarrierImsControl.settleDelayMillis("unchanged", true));
        assertEquals(1500L, CarrierImsControl.settleDelayMillis("restored", true));
        assertEquals(0L, CarrierImsControl.settleDelayMillis("verified", false));
    }

}
