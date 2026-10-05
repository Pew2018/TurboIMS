package io.github.turboims.ksu;

import java.util.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class ConfigurationVerificationTest {
    static final String NR = ConfigurationVerification.NR_AVAILABILITY;
    static Map<String,Object> request() {
        Map<String,Object> result = new LinkedHashMap<>(FeatureConfigTest.config(true, FeatureConfig.Mode.ON).desired());
        result.put("sim_country_iso_override_string", "tw");
        result.put("carrier_name_override_bool", true);
        result.put("carrier_name_string", "Chunghwa Telecom");
        return result;
    }
    static Map<String,Object> observed() {
        Map<String,Object> current = request();
        current.put(Engine.MARKER, "boot-a"); current.put(Engine.LOADED, true);
        current.put(NR, new int[]{1});
        return current;
    }
    @Test public void huskyObservationKeepsSuccessfulComponentsAndExactNrDifference() {
        ConfigurationVerification v = new ConfigurationVerification(observed(), request(), "boot-a");
        assertEquals("configured_partial", v.phase);
        assertTrue(v.imsVerified); assertTrue(v.simConfigVerified);
        assertTrue(v.nrLimited); assertFalse(v.nrVerified); assertFalse(v.fullVerified);
        assertEquals(Set.of(NR), v.mismatches.keySet());
        assertArrayEquals(new int[]{1,2}, (int[]) v.mismatches.get(NR).get("expected"));
        assertArrayEquals(new int[]{1}, (int[]) v.mismatches.get(NR).get("actual"));
        assertTrue(ConfigurationVerification.stableRegistrationVerified(false, List.of(true)));
        assertEquals("verified", ConfigurationVerification.registrationState(false, List.of(true)));
    }
    @Test public void nonNrFailuresAreNotHiddenAndSimIsIndependent() {
        Map<String,Object> current = observed();
        current.put(EngineTest.KEY, false);
        ConfigurationVerification v = new ConfigurationVerification(current, request(), "boot-a");
        assertEquals("verification_failed", v.phase); assertFalse(v.imsVerified);
        assertTrue(v.simConfigVerified); assertFalse(v.nrLimited);
        current = observed(); current.put("carrier_name_string", "中華電信");
        v = new ConfigurationVerification(current, request(), "boot-a");
        assertTrue(v.imsVerified); assertFalse(v.simConfigVerified);
        assertEquals("verification_failed", v.phase);
        current = observed(); current.put("5g_nr_ssrsrp_thresholds_int_array", new int[]{-110,-90,-80,-65});
        v = new ConfigurationVerification(current, request(), "boot-a");
        assertEquals("verification_failed", v.phase); assertFalse(v.nrLimited);
    }
    @Test public void limitationRequiresLoadedMatchingNonNullOwner() {
        Map<String,Object> current = observed(); current.put(Engine.LOADED, false);
        assertEquals("carrier_config_reloaded", new ConfigurationVerification(current, request(), "boot-a").phase);
        current = observed(); current.put(Engine.MARKER, "foreign");
        assertEquals("verification_failed", new ConfigurationVerification(current, request(), "boot-a").phase);
        current.remove(Engine.MARKER);
        assertFalse(new ConfigurationVerification(current, request(), null).nrLimited);
    }
    @Test public void absentEmptyWrongTypeUnknownModesAndOffRequestsRemainStrict() {
        List<Object> invalid = Arrays.asList(null, new int[]{}, new int[]{0},
                new int[]{1,1}, new int[]{1,3}, new int[]{2,1}, "1");
        for (Object value : invalid) {
            Map<String,Object> current = observed();
            if (value == null) current.remove(NR); else current.put(NR, value);
            ConfigurationVerification v = new ConfigurationVerification(current, request(), "boot-a");
            assertEquals("verification_failed", v.phase); assertFalse(v.nrLimited);
        }
        Map<String,Object> requested = request(); requested.put(NR, new int[]{});
        assertEquals("verification_failed", new ConfigurationVerification(observed(), requested, "boot-a").phase);
        Map<String,Object> current = observed(); current.put(NR, new int[]{2});
        assertEquals("configured_partial", new ConfigurationVerification(current, request(), "boot-a").phase);
    }
    @Test public void exactMatchStillVerifiesAllComponents() {
        Map<String,Object> current = observed(); current.put(NR, new int[]{1,2});
        ConfigurationVerification v = new ConfigurationVerification(current, request(), "boot-a");
        assertEquals("verified", v.phase); assertTrue(v.fullVerified);
        assertTrue(v.nrVerified); assertFalse(v.nrLimited);
    }
    @Test public void liveProbeDoesNotClaimContinuousVerificationOrTreatItAsUnregistered() {
        assertFalse(ConfigurationVerification.stableRegistrationVerified(true, List.of(true)));
        assertEquals("observed_registered", ConfigurationVerification.registrationState(true, List.of(true)));
        assertFalse(ConfigurationVerification.stableRegistrationVerified(false, Collections.emptyList()));
        assertEquals("not_checked", ConfigurationVerification.registrationState(false, Collections.emptyList()));
        assertFalse(ConfigurationVerification.stableRegistrationVerified(false, List.of(true, false)));
        assertEquals("not_registered", ConfigurationVerification.registrationState(false, List.of(true, false)));
        assertFalse(ConfigurationVerification.stableRegistrationVerified(false, Arrays.asList(true, null)));
        assertEquals("unavailable", ConfigurationVerification.registrationState(false, Arrays.asList(true, null)));
    }
}
