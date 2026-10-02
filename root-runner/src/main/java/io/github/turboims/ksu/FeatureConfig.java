package io.github.turboims.ksu;

import java.util.*;

/** Android-independent policy. DEFAULT means restore our previous effective baseline. */
public final class FeatureConfig {
    public static final List<String> FEATURES =
            List.of("volte", "vowifi", "vt", "vonr", "cross_sim", "ut", "5g_nr");
    public enum Mode { DEFAULT, ON, OFF }
    public final boolean enabled;
    public final String selection;
    public final int intervalSeconds;
    public final Map<String, Mode> modes;

    public FeatureConfig(boolean enabled, String selection, int intervalSeconds,
                         Map<String, Mode> modes) {
        if (!selection.equals("all") && !selection.matches("slot:[0-7]"))
            throw new IllegalArgumentException("SIM selection must be all or slot:0..7");
        if (intervalSeconds < 15 || intervalSeconds > 300)
            throw new IllegalArgumentException("Interval must be 15..300 seconds");
        if (!modes.keySet().equals(new HashSet<>(FEATURES)) || modes.containsValue(null))
            throw new IllegalArgumentException("Exactly seven feature modes are required");
        this.enabled = enabled;
        this.selection = selection;
        this.intervalSeconds = intervalSeconds;
        this.modes = Collections.unmodifiableMap(new LinkedHashMap<>(modes));
    }

    public boolean selects(int slot) {
        return selection.equals("all") || selection.equals("slot:" + slot);
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
        return Collections.unmodifiableSet(
                new LinkedHashSet<>(new FeatureConfig(true, "all", 30, modes).desired().keySet()));
    }

    public static boolean same(Object a, Object b) {
        if (a instanceof int[] && b instanceof int[]) return Arrays.equals((int[]) a, (int[]) b);
        return Objects.equals(a, b);
    }
}
