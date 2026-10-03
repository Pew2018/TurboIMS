package io.github.turboims.ksu;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class FeatureConfigTest {
    static FeatureConfig config(boolean enabled, FeatureConfig.Mode mode) {
        Map<String, FeatureConfig.Mode> modes = new LinkedHashMap<>();
        for (String name : FeatureConfig.FEATURES) modes.put(name, mode);
        return new FeatureConfig(enabled, "all", 1800, modes);
    }
    @Test public void separateScheduleDefaultsOff() {
        FeatureConfig c = config(true, FeatureConfig.Mode.ON);
        assertFalse(c.periodicCheckEnabled);
        assertEquals(1800, c.intervalSeconds);
        FeatureConfig scheduled = new FeatureConfig(false, true, "all", 600, c.modes);
        assertTrue(scheduled.periodicCheckEnabled);
    }
    @Test public void supportsAllScheduledIntervals() {
        for (int seconds : new int[]{600,1800,3600,7200})
            assertEquals(seconds, new FeatureConfig(true, true, "all", seconds,
                    config(true, FeatureConfig.Mode.ON).modes).intervalSeconds);
    }
    @Test public void implementationModeDefaultsToTurboIms() {
        assertEquals("turboims", config(true, FeatureConfig.Mode.ON).implementationMode);
    }
    @Test public void carrierTestMccMncIsValidatedAndPreserved() {
        FeatureConfig base = config(true, FeatureConfig.Mode.ON);
        FeatureConfig carrier = new FeatureConfig(true, false, "all", 1800, base.modes,
                Map.of(0, new FeatureConfig.SimProfile("tw", "Chunghwa Telecom", "46692")), "carrier_ims");
        assertEquals("46692", carrier.simProfiles.get(0).carrierTestMccMnc);
    }
    @Test public void legacyTaiwanChunghwaProfileDerivesTestPlmn() {
        FeatureConfig.SimProfile profile = new FeatureConfig.SimProfile("TW", "Chunghwa Telecom");
        assertEquals("46692", profile.carrierTestMccMnc);
    }
    @Test public void explicitTestPlmnTakesPrecedence() {
        FeatureConfig.SimProfile profile = new FeatureConfig.SimProfile("TW", "Chunghwa Telecom", "46601");
        assertEquals("46601", profile.carrierTestMccMnc);
    }
    @Test public void doesNotGuessPlmnForOtherCarriersOrCountries() {
        assertEquals("", new FeatureConfig.SimProfile("tw", "FarEasTone").carrierTestMccMnc);
        assertEquals("", new FeatureConfig.SimProfile("cn", "Chunghwa Telecom").carrierTestMccMnc);
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsMalformedCarrierTestMccMnc() {
        new FeatureConfig.SimProfile("tw", "Chunghwa Telecom", "4609");
    }
    @Test public void carrierImsModeCanBeSelected() {
        FeatureConfig base = config(true, FeatureConfig.Mode.ON);
        FeatureConfig carrier = new FeatureConfig(true, false, "all", 1800, base.modes,
                Collections.emptyMap(), "carrier_ims");
        assertEquals("carrier_ims", carrier.implementationMode);
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsUnknownImplementationMode() {
        FeatureConfig base = config(true, FeatureConfig.Mode.ON);
        new FeatureConfig(true, false, "all", 1800, base.modes,
                Collections.emptyMap(), "unknown");
    }
    @Test public void sevenFeatures() { assertEquals(7, FeatureConfig.FEATURES.size()); }
    @Test public void pausedDoesNotRequestOverrides() {
        assertTrue(config(false, FeatureConfig.Mode.ON).desired().isEmpty());
    }
    @Test public void defaultDoesNotRequestOverrides() {
        assertTrue(config(true, FeatureConfig.Mode.DEFAULT).desired().isEmpty());
    }
    @Test public void volteOnMatchesOriginal() {
        Map<String,Object> m = config(true, FeatureConfig.Mode.ON).desired();
        assertEquals(true,m.get("carrier_volte_available_bool"));
        assertEquals(false,m.get("hide_enhanced_4g_lte_bool"));
    }
    @Test public void volteOffIsExplicit() {
        Map<String,Object> m = config(true, FeatureConfig.Mode.OFF).desired();
        assertEquals(false,m.get("carrier_volte_available_bool"));
        assertEquals(true,m.get("hide_enhanced_4g_lte_bool"));
    }
    @Test public void wfcFormatIsSix() {
        assertEquals(6,config(true,FeatureConfig.Mode.ON).desired().get("wfc_spn_format_idx_int"));
    }
    @Test public void wfcOffOmitsFormatSoEngineRestoresIt() {
        assertFalse(config(true,FeatureConfig.Mode.OFF).desired().containsKey("wfc_spn_format_idx_int"));
    }
    @Test public void includesWfcRoamingMode() {
        assertEquals(true,config(true,FeatureConfig.Mode.ON).desired().get("editable_wfc_roaming_mode_bool"));
    }
    @Test public void vtKey() {
        assertEquals(true,config(true,FeatureConfig.Mode.ON).desired().get("carrier_vt_available_bool"));
    }
    @Test public void vonrKeys() {
        assertEquals(true,config(true,FeatureConfig.Mode.ON).desired().get("vonr_setting_visibility_bool"));
    }
    @Test public void crossSimKeys() {
        assertEquals(true,config(true,FeatureConfig.Mode.ON).desired()
                .get("enable_cross_sim_calling_on_opportunistic_data_bool"));
    }
    @Test public void utKey() {
        assertEquals(true,config(true,FeatureConfig.Mode.ON).desired()
                .get("carrier_supports_ss_over_ut_bool"));
    }
    @Test public void nrAvailability() {
        assertArrayEquals(new int[]{1,2},(int[])config(true,FeatureConfig.Mode.ON).desired()
                .get("carrier_nr_availabilities_int_array"));
    }
    @Test public void nrThresholds() {
        assertArrayEquals(new int[]{-128,-118,-108,-98},(int[])config(true,FeatureConfig.Mode.ON).desired()
                .get("5g_nr_ssrsrp_thresholds_int_array"));
    }
    @Test public void nrOffIsExplicit() {
        assertArrayEquals(new int[]{},(int[])config(true,FeatureConfig.Mode.OFF).desired()
                .get("carrier_nr_availabilities_int_array"));
    }
    @Test public void arrayEqualityUsesContents() {
        assertTrue(FeatureConfig.same(new int[]{1,2}, new int[]{1,2}));
        assertFalse(FeatureConfig.same(new int[]{1},new int[]{2}));
    }
    @Test public void slotSelectionNotSubId() {
        FeatureConfig c=config(true,FeatureConfig.Mode.ON);
        FeatureConfig one=new FeatureConfig(true,"slot:0",1800,c.modes);
        assertTrue(one.selects(0)); assertFalse(one.selects(1));
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsBadSelection() {
        new FeatureConfig(true,"subId:1",1800,config(true,FeatureConfig.Mode.ON).modes);
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsFastPolling() {
        new FeatureConfig(true,"all",1,config(true,FeatureConfig.Mode.ON).modes);
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsMissingFeatures() {
        new FeatureConfig(true,"all",1800,Map.of());
    }
}
