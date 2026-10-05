package io.github.turboims.ksu;

import java.util.*;

/** Read-only component verification. A reduced NR request is reported, never claimed as fulfilled. */
final class ConfigurationVerification {
    static final String NR_AVAILABILITY = "carrier_nr_availabilities_int_array";
    static final Set<String> NR_KEYS = Set.of(NR_AVAILABILITY, "5g_nr_ssrsrp_thresholds_int_array");
    static final Set<String> SIM_KEYS = Set.of("sim_country_iso_override_string",
            "carrier_name_override_bool", "carrier_name_string");
    final Map<String, Map<String, Object>> mismatches;
    final boolean ownerVerified, fullVerified, imsVerified, simConfigVerified, nrVerified, nrLimited;
    final String phase;

    ConfigurationVerification(Map<String, Object> current, Map<String, Object> requested,
                              Object expectedOwner) {
        boolean loaded = Boolean.TRUE.equals(current.get(Engine.LOADED));
        boolean markerMatches = FeatureConfig.same(current.get(Engine.MARKER), expectedOwner);
        ownerVerified = loaded && markerMatches;
        mismatches = Engine.readbackMismatches(current, requested);
        boolean ims = true, sim = true, nr = true;
        boolean limitedOnly = !mismatches.isEmpty();
        for (var entry : mismatches.entrySet()) {
            String key = entry.getKey();
            if (SIM_KEYS.contains(key)) sim = false;
            else if (NR_KEYS.contains(key)) nr = false;
            else ims = false;
            limitedOnly &= isNrAvailabilityLimited(key,
                    entry.getValue().get("expected"), entry.getValue().get("actual"));
        }
        imsVerified = ownerVerified && ims;
        simConfigVerified = ownerVerified && sim;
        nrVerified = ownerVerified && nr;
        fullVerified = ownerVerified && mismatches.isEmpty();
        // A native baseline without our marker is not evidence of an attempted NR override.
        nrLimited = ownerVerified && expectedOwner != null && limitedOnly;
        phase = !loaded ? "carrier_config_reloaded"
                : !markerMatches ? (current.containsKey(Engine.MARKER)
                        ? "verification_failed" : "carrier_config_reloaded")
                : fullVerified ? "verified" : nrLimited ? "configured_partial"
                : current.containsKey(Engine.MARKER) ? "verification_failed" : "carrier_config_reloaded";
    }

    /** Only the observed enable-both request with a nonempty, valid single-mode readback. */
    static boolean isNrAvailabilityLimited(String key, Object expected, Object actual) {
        return NR_AVAILABILITY.equals(key) && expected instanceof int[] && actual instanceof int[]
                && Arrays.equals((int[]) expected, new int[]{1, 2})
                && ((int[]) actual).length == 1
                && (((int[]) actual)[0] == 1 || ((int[]) actual)[0] == 2);
    }

    static boolean stableRegistrationVerified(boolean preview, List<Boolean> observations) {
        return !preview && !observations.isEmpty()
                && observations.stream().allMatch(Boolean.TRUE::equals);
    }

    static String registrationState(boolean preview, List<Boolean> observations) {
        if (observations.isEmpty()) return "not_checked";
        if (observations.stream().anyMatch(Objects::isNull)) return "unavailable";
        if (observations.contains(false)) return "not_registered";
        return preview ? "observed_registered" : "verified";
    }
}
