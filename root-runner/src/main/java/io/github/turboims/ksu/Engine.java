package io.github.turboims.ksu;

import java.util.*;

/** No Context, Shizuku, shell delegation, hard-coded Binder transaction or system file edits. */
public final class Engine {
    public static final String MARKER = "turboims_ksu_session_string";
    public static final String LOADED = "carrier_config_applied_bool";
    public interface Store {
        Snapshot load(int subId) throws Exception;
        void save(int subId, Snapshot snapshot) throws Exception;
    }
    public interface Sleeper { void sleep() throws Exception; }
    public static final class Snapshot {
        public final String session;
        public final Map<String, Object> baseline, owned;
        public Snapshot(String session, Map<String, Object> baseline, Map<String, Object> owned) {
            this.session = session;
            this.baseline = new LinkedHashMap<>(baseline);
            this.owned = new LinkedHashMap<>(owned);
        }
    }
    public static final class Result {
        public final int subId, slot;
        public final String phase;
        public final boolean changed;
        public final List<String> unsupported, conflicts;
        public final Map<String, Object> effective;
        Result(CarrierBackend.Subscription sub, String phase, boolean changed,
               List<String> unsupported, List<String> conflicts, Map<String, Object> effective) {
            this.subId = sub.id; this.slot = sub.slot; this.phase = phase;
            this.changed = changed; this.unsupported = unsupported;
            this.conflicts = conflicts; this.effective = effective;
        }
    }

    private final CarrierBackend backend;
    private final Store store;
    private final String session;
    private final Sleeper sleeper;

    public Engine(CarrierBackend backend, Store store, String session, Sleeper sleeper) {
        this.backend = backend; this.store = store; this.session = session; this.sleeper = sleeper;
    }

    public Result reconcile(CarrierBackend.Subscription sub, Map<String, Object> requested,
                            boolean allowWrite) throws Exception {
        Map<String, Object> current = backend.read(sub.id);
        if (!Boolean.TRUE.equals(current.get(LOADED)))
            return new Result(sub, "waiting", false, List.of(), List.of(), current);
        Snapshot old = store.load(sub.id);
        boolean ours = old != null && session.equals(old.session)
                && session.equals(current.get(MARKER));
        Map<String, Object> baseline = new LinkedHashMap<>();
        Map<String, Object> previous = new LinkedHashMap<>();
        if (ours) {
            baseline.putAll(old.baseline);
            previous.putAll(old.owned);
        } else {
            for (String key : FeatureConfig.knownKeys())
                if (current.containsKey(key)) baseline.put(key, current.get(key));
        }
        Map<String, Object> desired = new LinkedHashMap<>();
        List<String> unsupported = new ArrayList<>(), conflicts = new ArrayList<>();
        for (var entry : requested.entrySet()) {
            if (!FeatureConfig.knownKeys().contains(entry.getKey()))
                throw new IllegalArgumentException("Unknown CarrierConfig key");
            if (!baseline.containsKey(entry.getKey())) {
                unsupported.add(entry.getKey()); continue;
            }
            desired.put(entry.getKey(), entry.getValue());
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        Map<String, Object> nextOwned = new LinkedHashMap<>();
        for (var entry : desired.entrySet()) {
            String key = entry.getKey();
            if (previous.containsKey(key)
                    && !FeatureConfig.same(current.get(key), previous.get(key))) {
                conflicts.add(key);
                nextOwned.put(key, previous.get(key));
                continue;
            }
            if (!FeatureConfig.same(current.get(key), entry.getValue()))
                payload.put(key, entry.getValue());
            if (previous.containsKey(key) || payload.containsKey(key))
                nextOwned.put(key, entry.getValue());
        }
        for (var entry : previous.entrySet()) {
            String key = entry.getKey();
            if (desired.containsKey(key)) continue;
            if (!FeatureConfig.same(current.get(key), entry.getValue())) {
                conflicts.add(key);
                nextOwned.put(key, entry.getValue());
                continue;
            }
            if (baseline.containsKey(key) && !FeatureConfig.same(current.get(key), baseline.get(key)))
                payload.put(key, baseline.get(key));
        }
        if (!allowWrite)
            return new Result(sub, "preview", false, unsupported, conflicts, current);
        if (!payload.isEmpty()) {
            // Snapshot BEFORE mutation; a crash/failure must still leave a recovery record.
            Map<String, Object> pending = new LinkedHashMap<>(previous);
            pending.putAll(nextOwned);
            // Includes restoration values if the process dies during asynchronous verification.
            for (String key : payload.keySet()) pending.put(key, payload.get(key));
            store.save(sub.id, new Snapshot(session, baseline, pending));
            payload.put(MARKER, session);
            backend.override(sub.id, payload);
            boolean verified = false;
            for (int i = 0; i < 25; i++) {
                sleeper.sleep();
                current = backend.read(sub.id);
                verified = true;
                for (var entry : payload.entrySet())
                    if (!FeatureConfig.same(current.get(entry.getKey()), entry.getValue())) {
                        verified = false; break;
                    }
                if (verified) break;
            }
            if (!verified) throw new IllegalStateException(
                    "CarrierConfig read-back mismatch for subId=" + sub.id);
        }
        if (ours || !payload.isEmpty())
            store.save(sub.id, new Snapshot(session, baseline, nextOwned));
        String phase = !conflicts.isEmpty() ? "conflict" :
                (!payload.isEmpty() ? (desired.isEmpty() ? "restored" : "verified") : "unchanged");
        return new Result(sub, phase, !payload.isEmpty(), unsupported, conflicts, current);
    }
}
