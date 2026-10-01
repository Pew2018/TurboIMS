package io.github.turboims.ksu;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class FeatureConfigTest {
    static FeatureConfig config(boolean enabled, FeatureConfig.Mode mode) {
        Map<String, FeatureConfig.Mode> modes = new LinkedHashMap<>();
        for (String name : FeatureConfig.FEATURES) modes.put(name, mode);
        return new FeatureConfig(enabled, "all", 30, modes);
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
        FeatureConfig one=new FeatureConfig(true,"slot:0",30,c.modes);
        assertTrue(one.selects(0)); assertFalse(one.selects(1));
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsBadSelection() {
        new FeatureConfig(true,"subId:1",30,config(true,FeatureConfig.Mode.ON).modes);
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsFastPolling() {
        new FeatureConfig(true,"all",1,config(true,FeatureConfig.Mode.ON).modes);
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsMissingFeatures() {
        new FeatureConfig(true,"all",30,Map.of());
    }
}
