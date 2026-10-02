package io.github.turboims.ksu;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class SimProfileTest {
    private static Map<String, FeatureConfig.Mode> modes() {
        Map<String, FeatureConfig.Mode> modes = new LinkedHashMap<>();
        for (String name : FeatureConfig.FEATURES) modes.put(name, FeatureConfig.Mode.DEFAULT);
        return modes;
    }

    @Test public void simProfileProducesCountryAndCarrierKeysWithoutEnablingIms() {
        Map<Integer, FeatureConfig.SimProfile> profiles = Map.of(0,
                new FeatureConfig.SimProfile("JP", "NTT docomo"));
        FeatureConfig config = new FeatureConfig(false, false, "all", 1800, modes(), profiles);
        Map<String,Object> desired = config.desiredForSlot(0);
        assertEquals("jp", desired.get("sim_country_iso_override_string"));
        assertEquals(true, desired.get("carrier_name_override_bool"));
        assertEquals("NTT docomo", desired.get("carrier_name_string"));
        assertFalse(desired.containsKey("carrier_volte_available_bool"));
    }

    @Test public void emptySimProfileIsIgnored() {
        FeatureConfig config = new FeatureConfig(false, false, "all", 1800, modes(),
                Map.of(1, new FeatureConfig.SimProfile("", "")));
        assertFalse(config.hasSimProfiles());
        assertTrue(config.desiredForSlot(1).isEmpty());
    }

    @Test(expected=IllegalArgumentException.class)
    public void rejectsInvalidCountryCode() {
        new FeatureConfig.SimProfile("JPN", "");
    }

    @Test public void profilesAreIndependentBySlot() {
        Map<Integer, FeatureConfig.SimProfile> profiles = Map.of(
                0, new FeatureConfig.SimProfile("JP", ""),
                1, new FeatureConfig.SimProfile("US", ""));
        FeatureConfig config = new FeatureConfig(false, false, "all", 1800, modes(), profiles);
        assertEquals("jp", config.desiredForSlot(0).get("sim_country_iso_override_string"));
        assertEquals("us", config.desiredForSlot(1).get("sim_country_iso_override_string"));
    }
}
