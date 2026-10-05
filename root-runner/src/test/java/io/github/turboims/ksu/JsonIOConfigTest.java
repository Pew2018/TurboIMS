package io.github.turboims.ksu;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class JsonIOConfigTest {
    private JSONObject saved() throws Exception {
        return new JSONObject("{\"schema\":1,\"enabled\":true,\"selection\":\"all\","
                + "\"interval_seconds\":600,\"periodic_check_enabled\":false,"
                + "\"implementation_mode\":\"carrier_ims\","
                + "\"features\":{\"volte\":\"on\",\"vowifi\":\"on\",\"vt\":\"on\","
                + "\"vonr\":\"on\",\"cross_sim\":\"on\",\"ut\":\"on\",\"5g_nr\":\"on\"},"
                + "\"sim_profiles\":{\"0\":{\"country_iso\":\"tw\","
                + "\"carrier_name\":\"Chunghwa Telecom\",\"carrier_test_mccmnc\":\"46692\"}}}");
    }
    @Test public void upgradePreservesDisplayAndBootPreferencesButDisablesLegacyTestIdentity() throws Exception {
        FeatureConfig config=JsonIO.config(saved());
        FeatureConfig.SimProfile p=config.simProfiles.get(0);
        assertEquals("tw",p.countryIso); assertEquals("Chunghwa Telecom",p.carrierName);
        assertEquals("46692",p.carrierTestMccMnc); assertFalse(p.carrierTestEnabled);
        assertTrue(config.enabled); assertFalse(config.periodicCheckEnabled);
        assertEquals(600,config.intervalSeconds); assertEquals("carrier_ims",config.implementationMode);
        JSONObject migrated=JsonIO.config(config);
        assertFalse(migrated.getJSONObject("sim_profiles").getJSONObject("0").getBoolean("carrier_test_enabled"));
        assertEquals("",JsonIO.config(migrated).simProfiles.get(0).requestedTestMccMnc());
    }
    @Test public void newExplicitTestOptInSurvivesRoundTrip() throws Exception {
        JSONObject input=saved();
        input.getJSONObject("sim_profiles").getJSONObject("0").put("carrier_test_enabled",true);
        FeatureConfig config=JsonIO.config(JsonIO.config(JsonIO.config(input)));
        assertEquals("46692",config.simProfiles.get(0).requestedTestMccMnc());
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsStringInsteadOfTestOptInBoolean() throws Exception {
        JSONObject input=saved();
        input.getJSONObject("sim_profiles").getJSONObject("0").put("carrier_test_enabled","true");
        JsonIO.config(input);
    }
    @Test public void clearingCountryAndNameKeepsNativeIdentityInEitherMode() throws Exception {
        for (String mode:new String[]{"turboims","carrier_ims"}) {
            JSONObject input=saved().put("implementation_mode",mode);
            input.put("sim_profiles",new JSONObject());
            FeatureConfig config=JsonIO.config(JsonIO.config(JsonIO.config(input)));
            assertFalse(config.hasSimProfiles());
            assertTrue(config.desiredForSlot(0).containsKey("carrier_volte_available_bool"));
            assertFalse(config.desiredForSlot(0).containsKey("sim_country_iso_override_string"));
        }
    }
}
