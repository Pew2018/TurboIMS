package io.github.turboims.ksu;

import org.junit.Test;
import java.lang.reflect.Method;
import static org.junit.Assert.*;

public class CarrierTestOverrideControlTest {
    private interface ModernTelephony {
        void setCarrierTestOverride(int subId, String mccmnc, String imsi, String iccid,
                String gid1, String gid2, String plmn, String spn,
                String carrierPrivilegeRules, String apn);
    }

    private interface LegacyTelephony {
        void setCarrierTestOverride(int subId, String mccmnc, String imsi, String iccid,
                String gid1, String gid2, String plmn, String spn,
                int[] carrierIds, int[] specificCarrierIds);
    }

    private interface UnsupportedTelephony {
        void setCarrierTestOverride(int subId, String mccmnc, String imsi, String iccid,
                String gid1, String gid2, String plmn, String spn,
                String carrierPrivilegeRules, int apn);
    }

    @Test public void matchesCurrentStringSignature() throws Exception {
        Method method = ModernTelephony.class.getMethod("setCarrierTestOverride",
                int.class, String.class, String.class, String.class, String.class,
                String.class, String.class, String.class, String.class, String.class);
        assertTrue(CarrierTestOverrideControl.supportsCarrierTestOverrideSignature(method));
    }

    @Test public void preservesLegacyArraySignatureCompatibility() throws Exception {
        Method method = LegacyTelephony.class.getMethod("setCarrierTestOverride",
                int.class, String.class, String.class, String.class, String.class,
                String.class, String.class, String.class, int[].class, int[].class);
        assertTrue(CarrierTestOverrideControl.supportsCarrierTestOverrideSignature(method));
    }

    @Test public void acceptsOnlyWellFormedCarrierTestMccMnc() {
        assertTrue(CarrierTestOverrideControl.isValidMccMnc("46692"));
        assertTrue(CarrierTestOverrideControl.isValidMccMnc("310260"));
        assertFalse(CarrierTestOverrideControl.isValidMccMnc(""));
        assertFalse(CarrierTestOverrideControl.isValidMccMnc("4669"));
        assertFalse(CarrierTestOverrideControl.isValidMccMnc("46A92"));
    }

    @Test public void resolvesStringMccAndMncWithoutDroppingLeadingZeroes() {
        assertEquals("46607", AndroidCarrierBackend.normalizeMccMnc("466", "07"));
        assertEquals("310260", AndroidCarrierBackend.normalizeMccMnc("310", "260"));
        assertEquals("", AndroidCarrierBackend.normalizeMccMnc("46", "92"));
        assertEquals("", AndroidCarrierBackend.normalizeMccMnc("466", "9"));
    }

    @Test public void countryOverridePreservesPhysicalSimMnc() {
        assertEquals("46601",
                CarrierTestOverrideControl.preserveNativeMnc("46692", "46001"));
        assertEquals("310260",
                CarrierTestOverrideControl.preserveNativeMnc("310999", "460260"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void countryOverrideRejectsUnavailableNativeIdentity() {
        CarrierTestOverrideControl.preserveNativeMnc("46692", "");
    }

    @Test public void rejectsUnrelatedOverload() throws Exception {
        Method method = UnsupportedTelephony.class.getMethod("setCarrierTestOverride",
                int.class, String.class, String.class, String.class, String.class,
                String.class, String.class, String.class, String.class, int.class);
        assertFalse(CarrierTestOverrideControl.supportsCarrierTestOverrideSignature(method));
    }
}
