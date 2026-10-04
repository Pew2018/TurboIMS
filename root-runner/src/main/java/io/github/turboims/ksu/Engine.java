package io.github.turboims.ksu;

import java.util.*;

/** No Context, Shizuku, shell delegation, hard-coded Binder transaction or system file edits. */
public final class Engine {
    public static final String MARKER = "turboims_ksu_session_string";
    public static final String LOADED = "carrier_config_applied_bool";
    public static final class VerificationException extends IllegalStateException {
        public VerificationException(String message) { super(message); }
    }
    public interface Store {
        Snapshot load(int subId) throws Exception;
        void save(int subId, Snapshot snapshot) throws Exception;
    }
    public interface Sleeper { void sleep() throws Exception; }
    public static final class Snapshot {
        public final String session;
        public final Map<String, Object> baseline, owned, pending;
        public Snapshot(String session, Map<String, Object> baseline, Map<String, Object> owned) {
            this(session, baseline, owned, Collections.emptyMap());
        }
        public Snapshot(String session, Map<String, Object> baseline, Map<String, Object> owned,
                        Map<String, Object> pending) {
            this.session = session;
            this.baseline = new LinkedHashMap<>(baseline);
            this.owned = new LinkedHashMap<>(owned);
            this.pending = new LinkedHashMap<>(pending);
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

    private static boolean canRebaseAfterCarrierReload(Map<String, Object> current,
                                                       Snapshot old,
                                                       boolean knownModuleCarrierIdentityReload) {
        // A different TurboIMS session still owns the visible override. Never
        // reclaim it merely because the persisted snapshot belongs to this process.
        if (current.containsKey(MARKER) || !old.pending.isEmpty() || old.owned.isEmpty())
            return false;
        // Android can reload a partial carrier profile after this module changes
        // Carrier test identity. This exception remains limited to that matching
        // module-owned operation in the same boot; foreign marker loss is blocked.
        if (knownModuleCarrierIdentityReload) return true;
        for (var entry : old.owned.entrySet()) {
            if (FeatureConfig.same(current.get(entry.getKey()), entry.getValue()))
                return false;
        }
        return true;
    }

    public Result reconcile(CarrierBackend.Subscription sub, Map<String, Object> requested,
                            boolean allowWrite) throws Exception {
        return reconcile(sub, requested, allowWrite, false);
    }

    public Result reconcile(CarrierBackend.Subscription sub, Map<String, Object> requested,
                            boolean allowWrite, boolean knownModuleCarrierIdentityReload) throws Exception {
        Map<String, Object> current = backend.read(sub.id);
        if (!Boolean.TRUE.equals(current.get(LOADED)))
            return new Result(sub, "waiting", false, List.of(), List.of(), current);
        Snapshot old = store.load(sub.id);
        // A non-persistent CarrierConfig override can survive long enough to be
        // observed after reboot. Its marker is paired with the persisted snapshot,
        // not with the current boot ID, so ownership remains explicit across boots.
        boolean ours = old != null && old.session.equals(current.get(MARKER));
        Map<String, Object> baseline = new LinkedHashMap<>();
        Map<String, Object> previous = new LinkedHashMap<>();
        if (ours) {
            baseline.putAll(old.baseline);
            previous.putAll(old.owned);
            // Resolve an interrupted transaction from observed values. The last verified
            // ownership must survive a Binder failure before mutation.
            for (var entry : old.pending.entrySet()) {
                String key = entry.getKey();
                if (FeatureConfig.same(current.get(key), entry.getValue())) {
                    previous.put(key, entry.getValue());
                } else if (previous.containsKey(key)
                        && FeatureConfig.same(current.get(key), previous.get(key))) {
                    // The attempted mutation did not happen; retain the verified ownership.
                } else if (!previous.containsKey(key)
                        && FeatureConfig.same(current.get(key), baseline.get(key))) {
                    // First write did not happen; do not invent ownership.
                } else {
                    // Unknown value: preserve a claim for conflict detection, never overwrite.
                    previous.put(key, entry.getValue());
                }
            }
        } else {
            if (old != null && (!old.owned.isEmpty() || !old.pending.isEmpty())) {
                Set<String> tracked = new LinkedHashSet<>(old.owned.keySet());
                tracked.addAll(old.pending.keySet());
                List<String> lost = new ArrayList<>();
                for (String key : tracked)
                    if (!FeatureConfig.same(current.get(key), old.baseline.get(key))) lost.add(key);
                if (!lost.isEmpty() && !canRebaseAfterCarrierReload(current, old,
                        knownModuleCarrierIdentityReload))
                    return new Result(sub, "ownership_lost", false, List.of(), lost, current);
                // A reload can discard the complete non-persistent override and also
                // change the carrier's native baseline. Rebase only when the marker
                // is gone, no previous owned value remains, and there is no ambiguous
                // interrupted write. Any partial or unknown ownership stays blocked.
            }
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
            store.save(sub.id, new Snapshot(session, baseline, previous, payload));
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
            if (!verified) throw new VerificationException(
                    "CarrierConfig read-back mismatch for subId=" + sub.id);
        }
        if (ours || !payload.isEmpty()) {
            // Keep the stored owner token aligned with the marker that is actually
            // present. A changed payload writes this boot's marker; an unchanged
            // cross-boot reconciliation deliberately retains the prior marker.
            String ownerToken = !payload.isEmpty() ? session : old.session;
            store.save(sub.id, new Snapshot(ownerToken, baseline, nextOwned));
        }
        String phase = !conflicts.isEmpty() ? "conflict" :
                (!payload.isEmpty() ? (desired.isEmpty() ? "restored" : "verified") : "unchanged");
        return new Result(sub, phase, !payload.isEmpty(), unsupported, conflicts, current);
    }
}
