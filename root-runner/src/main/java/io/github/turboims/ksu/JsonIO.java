package io.github.turboims.ksu;

import android.system.Os;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class JsonIO implements Engine.Store {
    public static final Path STATE = Paths.get("/data/adb/turboims-next");
    public static final Path CONFIG = STATE.resolve("config.json");

    static JSONObject read(Path path) throws Exception {
        return new JSONObject(new String(Files.readAllBytes(path), StandardCharsets.UTF_8));
    }
    static void write(Path path, JSONObject object) throws Exception {
        Path tmp = path.resolveSibling(path.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.write(tmp, (object.toString(2) + "\n").getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            Os.chmod(tmp.toString(), 0600);
            try { Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally { Files.deleteIfExists(tmp); }
    }

    static JSONObject values(Map<String, Object> map) throws Exception {
        JSONObject result = new JSONObject();
        for (var entry : map.entrySet()) {
            Object value = entry.getValue();
            if (value instanceof int[]) {
                JSONArray array = new JSONArray();
                for (int n : (int[]) value) array.put(n);
                result.put(entry.getKey(), array);
            } else result.put(entry.getKey(), value);
        }
        return result;
    }
    static Map<String, Object> values(JSONObject obj) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        Iterator<String> keys = obj.keys();
        while (keys.hasNext()) {
            String key = keys.next(); Object value = obj.get(key);
            if (!FeatureConfig.knownKeys().contains(key) && !key.equals(Engine.MARKER)
                    && !key.equals(Engine.LOADED))
                throw new IllegalArgumentException("Unexpected saved CarrierConfig key");
            if (value instanceof JSONArray) {
                JSONArray a = (JSONArray) value; int[] ints = new int[a.length()];
                for (int i = 0; i < ints.length; i++) ints[i] = a.getInt(i);
                value = ints;
            } else if (value instanceof Number) value = ((Number) value).intValue();
            if (!(value instanceof Boolean || value instanceof Integer
                    || value instanceof int[] || value instanceof String))
                throw new IllegalArgumentException("Invalid saved value");
            result.put(key, value);
        }
        return result;
    }

    static FeatureConfig config(JSONObject obj) throws Exception {
        Set<String> keys = new HashSet<>();
        obj.keys().forEachRemaining(keys::add);
        Set<String> required = Set.of("schema", "enabled", "selection", "interval_seconds", "features");
        if (!keys.containsAll(required)
                || !keys.stream().allMatch(k -> required.contains(k)
                    || k.equals("periodic_check_enabled") || k.equals("sim_profiles") || k.equals("implementation_mode")))
            throw new IllegalArgumentException("Unexpected configuration fields");
        if (!(obj.get("schema") instanceof Integer) || obj.getInt("schema") != 1)
            throw new IllegalArgumentException("Unsupported config schema");
        if (!(obj.get("enabled") instanceof Boolean) || !(obj.get("selection") instanceof String)
                || !(obj.get("interval_seconds") instanceof Integer))
            throw new IllegalArgumentException("Invalid config field types");
        JSONObject features = obj.getJSONObject("features");
        Map<String, FeatureConfig.Mode> modes = new LinkedHashMap<>();
        Iterator<String> names = features.keys();
        while (names.hasNext()) {
            String name = names.next();
            Object value = features.get(name);
            if (!(value instanceof String)) throw new IllegalArgumentException("Invalid feature mode");
            String mode = (String) value;
            if (!Set.of("default", "on", "off").contains(mode))
                throw new IllegalArgumentException("Mode must be default, on or off");
            modes.put(name, FeatureConfig.Mode.valueOf(mode.toUpperCase(Locale.ROOT)));
        }
        int interval = obj.getInt("interval_seconds");
        if (!obj.has("periodic_check_enabled") && interval <= 300) interval = 1800;
        if (obj.has("periodic_check_enabled")
                && !(obj.get("periodic_check_enabled") instanceof Boolean))
            throw new IllegalArgumentException("Invalid periodic check switch");
        Map<Integer, FeatureConfig.SimProfile> profiles = new LinkedHashMap<>();
        if (obj.has("sim_profiles")) {
            JSONObject simProfiles = obj.getJSONObject("sim_profiles");
            Iterator<String> slots = simProfiles.keys();
            while (slots.hasNext()) {
                String slot = slots.next();
                int index;
                try { index = Integer.parseInt(slot); }
                catch (NumberFormatException e) { throw new IllegalArgumentException("Invalid SIM profile slot"); }
                JSONObject profile = simProfiles.getJSONObject(slot);
                profiles.put(index, new FeatureConfig.SimProfile(
                        profile.optString("country_iso", ""), profile.optString("carrier_name", ""),
                        profile.optString("carrier_test_mccmnc", "")));
            }
        }
        return new FeatureConfig(obj.getBoolean("enabled"),
                obj.optBoolean("periodic_check_enabled", false), obj.getString("selection"),
                interval, modes, profiles, obj.optString("implementation_mode", "turboims"));
    }
    static JSONObject config(FeatureConfig config) throws Exception {
        JSONObject modes = new JSONObject();
        for (String name : FeatureConfig.FEATURES)
            modes.put(name, config.modes.get(name).name().toLowerCase(Locale.ROOT));
        JSONObject profiles = new JSONObject();
        for (var entry : config.simProfiles.entrySet()) {
            profiles.put(String.valueOf(entry.getKey()), new JSONObject()
                    .put("country_iso", entry.getValue().countryIso)
                    .put("carrier_name", entry.getValue().carrierName)
                    .put("carrier_test_mccmnc", entry.getValue().carrierTestMccMnc));
        }
        return new JSONObject().put("schema", 1).put("enabled", config.enabled)
                .put("periodic_check_enabled", config.periodicCheckEnabled)
                .put("selection", config.selection).put("interval_seconds", config.intervalSeconds)
                .put("features", modes).put("sim_profiles", profiles)
                .put("implementation_mode", config.implementationMode);
    }

    @Override public Engine.Snapshot load(int subId) throws Exception {
        Path path = STATE.resolve("snapshot-" + subId + ".json");
        if (!Files.exists(path)) return null;
        JSONObject obj = read(path);
        return new Engine.Snapshot(obj.getString("session"), values(obj.getJSONObject("baseline")),
                values(obj.getJSONObject("owned")),
                obj.has("pending") ? values(obj.getJSONObject("pending")) : Collections.emptyMap());
    }
    @Override public void save(int subId, Engine.Snapshot snapshot) throws Exception {
        write(STATE.resolve("snapshot-" + subId + ".json"),
                new JSONObject().put("session", snapshot.session)
                        .put("baseline", values(snapshot.baseline)).put("owned", values(snapshot.owned))
                        .put("pending", values(snapshot.pending)));
    }
}
