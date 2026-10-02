package io.github.turboims.ksu;

import java.util.*;

/** Android-independent policy. DEFAULT means restore our previous effective baseline. */
public final class FeatureConfig {
    public static final List<String> FEATURES =
            List.of("volte", "vowifi", "vt", "vonr", "cross_sim", "ut", "5g_nr");
    public enum Mode { DEFAULT, ON, OFF }
    public final boolean enabled;
    public final boolean periodicCheckEnabled;
    public final String selection;
    public final int intervalSeconds;
    public final Map<String, Mode> modes;
    public final Map<Integer, SimProfile> simProfiles;
    public static final class SimProfile {
        public final String countryIso; public final String carrierName;
        public SimProfile(String countryIso, String carrierName) {
            String iso = countryIso == null ? "" : countryIso.trim().toLowerCase(Locale.ROOT);
            if (!iso.isEmpty() && !iso.matches("[a-z]{2}")) throw new IllegalArgumentException("SIM country ISO must be two letters");
            String name = carrierName == null ? "" : carrierName.trim();
            if (name.length() > 128) throw new IllegalArgumentException("Carrier name is too long");
            this.countryIso = iso; this.carrierName = name;
        }
        public boolean isEmpty() { return countryIso.isEmpty() && carrierName.isEmpty(); }
    }
    public FeatureConfig(boolean enabled, String selection, int intervalSeconds, Map<String, Mode> modes) {
        this(enabled, false, selection, intervalSeconds, modes, Collections.emptyMap());
    }
    public FeatureConfig(boolean enabled, boolean periodicCheckEnabled, String selection, int intervalSeconds, Map<String, Mode> modes) {
        this(enabled, periodicCheckEnabled, selection, intervalSeconds, modes, Collections.emptyMap());
    }
    public FeatureConfig(boolean enabled, boolean periodicCheckEnabled, String selection, int intervalSeconds, Map<String, Mode> modes, Map<Integer, SimProfile> simProfiles) {
        if (!selection.equals("all") && !selection.matches("slot:[0-7]"))
            throw new IllegalArgumentException("SIM selection must be all or slot:0..7");
        if (!Set.of(600, 1800, 3600, 7200).contains(intervalSeconds))
            throw new IllegalArgumentException("Interval must be 10, 30, 60 or 120 minutes");
        if (!modes.keySet().equals(new HashSet<>(FEATURES)) || modes.containsValue(null))
            throw new IllegalArgumentException("Exactly seven feature modes are required");
        this.enabled = enabled;
        this.periodicCheckEnabled = periodicCheckEnabled;
        this.selection = selection;
        this.intervalSeconds = intervalSeconds;
        this.modes = Collections.unmodifiableMap(new LinkedHashMap<>(modes));
        Map<Integer, SimProfile> profiles = new LinkedHashMap<>();
        for (var entry : simProfiles.entrySet()) {
            if (entry.getKey() == null || entry.getKey() < 0 || entry.getKey() > 7) throw new IllegalArgumentException("SIM slot must be 0..7");
            if (entry.getValue() == null || entry.getValue().isEmpty()) continue;
            profiles.put(entry.getKey(), entry.getValue());
        }
        this.simProfiles = Collections.unmodifiableMap(profiles);
    }

    public boolean selects(int slot) {
        return selection.equals("all") || selection.equals("slot:" + slot);
    }

    public boolean hasSimProfiles() { return !simProfiles.isEmpty(); }
    public Map<String, Object> desiredForSlot(int slot) {
        Map<String, Object> out = desired(); SimProfile profile = simProfiles.get(slot);
        if (profile != null) {
            if (!profile.countryIso.isEmpty()) out.put("sim_country_iso_override_string", profile.countryIso);
            if (!profile.carrierName.isEmpty()) { out.put("carrier_name_override_bool", true); out.put("carrier_name_string", profile.carrierName); }
        }
        return out;
    }
    public Map<String, Object> desired() {
        Map<String, Object> out = new LinkedHashMap<>();
        if (!enabled) return out;
        for (String feature : FEATURES) {
            Mode mode = modes.get(feature);
            if (mode == Mode.DEFAULT) continue;
            boolean on = mode == Mode.ON;
            switch (feature) {
                case "volte":
                    bool(out, "carrier_volte_available_bool", on);
                    bool(out, "editable_enhanced_4g_lte_bool", on);
                    bool(out, "hide_enhanced_4g_lte_bool", !on);
                    bool(out, "hide_lte_plus_data_icon_bool", !on);
                    break;
                case "vowifi":
                    bool(out, "carrier_wfc_ims_available_bool", on);
                    bool(out, "carrier_wfc_supports_wifi_only_bool", on);
                    bool(out, "editable_wfc_mode_bool", on);
                    bool(out, "editable_wfc_roaming_mode_bool", on);
                    bool(out, "show_wifi_calling_icon_in_status_bar_bool", on);
                    if (on) out.put("wfc_spn_format_idx_int", 6);
                    break;
                case "vt": bool(out, "carrier_vt_available_bool", on); break;
                case "vonr":
                    bool(out, "vonr_enabled_bool", on);
                    bool(out, "vonr_setting_visibility_bool", on);
                    break;
                case "cross_sim":
                    bool(out, "carrier_cross_sim_ims_available_bool", on);
                    bool(out, "enable_cross_sim_calling_on_opportunistic_data_bool", on);
                    break;
                case "ut": bool(out, "carrier_supports_ss_over_ut_bool", on); break;
                case "5g_nr":
                    out.put("carrier_nr_availabilities_int_array",
                            on ? new int[]{1, 2} : new int[]{});
                    if (on) out.put("5g_nr_ssrsrp_thresholds_int_array",
                            new int[]{-128, -118, -108, -98});
                    break;
                default: throw new IllegalStateException(feature);
            }
        }
        return out;
    }

    private static void bool(Map<String, Object> out, String key, boolean value) {
        out.put(key, value);
    }

    public static Set<String> knownKeys() {
        Map<String, Mode> modes = new LinkedHashMap<>();
        for (String name : FEATURES) modes.put(name, Mode.ON);
        Set<String> keys = new LinkedHashSet<>(new FeatureConfig(true, "all", 1800, modes).desired().keySet());
        keys.add("sim_country_iso_override_string"); keys.add("carrier_name_override_bool"); keys.add("carrier_name_string");
        return Collections.unmodifiableSet(keys);
    }

    public static boolean same(Object a, Object b) {
        if (a instanceof int[] && b instanceof int[]) return Arrays.equals((int[]) a, (int[]) b);
        return Objects.equals(a, b);
    }
}
