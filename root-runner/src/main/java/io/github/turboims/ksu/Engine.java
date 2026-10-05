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
        public final String session, pendingSession;
        public final Map<String, Object> baseline, owned, pending;
        public Snapshot(String session, Map<String, Object> baseline, Map<String, Object> owned) {
            this(session, baseline, owned, Collections.emptyMap());
        }
        public Snapshot(String session, Map<String, Object> baseline, Map<String, Object> owned,
                        Map<String, Object> pending) {
            this(session, baseline, owned, pending, session);
        }
        public Snapshot(String session, Map<String, Object> baseline, Map<String, Object> owned,
                        Map<String, Object> pending, String pendingSession) {
            this.session = session;
            this.pendingSession = pending.isEmpty() ? "" : pendingSession;
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
    private final boolean reapplyAfterReset;

    public Engine(CarrierBackend backend, Store store, String session, Sleeper sleeper) {
        this(backend, store, session, sleeper, false);
    }

    /** Only boot/application paths may reapply a saved request after a markerless reset. */
    public Engine(CarrierBackend backend, Store store, String session, Sleeper sleeper,
                  boolean reapplyAfterReset) {
        this.backend = backend; this.store = store; this.session = session; this.sleeper = sleeper;
        this.reapplyAfterReset = reapplyAfterReset;
    }

    private boolean canRebaseAfterCarrierReload(Map<String, Object> current,
                                                Snapshot old, Map<String, Object> requested) {
        // A different TurboIMS session still owns the visible override. Never
        // reclaim it merely because the persisted snapshot belongs to this process.
        if (current.containsKey(MARKER) || !old.pending.isEmpty() || old.owned.isEmpty())
            return false;
        // Native values often equal previously requested booleans/arrays by chance.
        // Their equality cannot prove a nonpersistent override survived a reboot.
        // Explicit application may acquire a fresh baseline only when the owner
        // marker is absent and the previous transaction was fully verified.
        // Restore/preview/periodic paths keep the conservative ownership rules.
        if (reapplyAfterReset && !requested.isEmpty()) return true;
        for (var entry : old.owned.entrySet()) {
            if (FeatureConfig.same(current.get(entry.getKey()), entry.getValue()))
                return false;
        }
        return true;
    }

    private static boolean isSimIdentityKey(String key) {
        return key.equals("sim_country_iso_override_string")
                || key.equals("carrier_name_override_bool") || key.equals("carrier_name_string");
    }

    static boolean simIdentityMatches(Map<String, String> actual, Map<String, Object> requested) {
        Object iso = requested.get("sim_country_iso_override_string");
        Object carrier = requested.get("carrier_name_string");
        return (!(iso instanceof String) || ((String) iso).isEmpty()
                        || ((String) iso).equalsIgnoreCase(actual.get("country_iso")))
                && (!(carrier instanceof String) || ((String) carrier).isEmpty()
                        || carrier.equals(actual.get("carrier_name")));
    }

    /** Classify fresh final read-back without writing or resolving ownership. */
    static String readbackPhase(Map<String, Object> current, Map<String, Object> requested) {
        return readbackPhase(current, requested, current.get(MARKER));
    }
    static String readbackPhase(Map<String, Object> current, Map<String, Object> requested,
                                Object verifiedMarker) {
        return new ConfigurationVerification(current, requested, verifiedMarker).phase;
    }

    /** Only requested public CarrierConfig keys; never SIM subscriber identifiers. */
    static Map<String, Map<String, Object>> readbackMismatches(
            Map<String, Object> current, Map<String, Object> requested) {
        Map<String, Map<String, Object>> mismatches = new LinkedHashMap<>();
        for (var entry : requested.entrySet()) {
            if (FeatureConfig.same(current.get(entry.getKey()), entry.getValue())) continue;
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("expected", entry.getValue());
            values.put("actual", current.get(entry.getKey()));
            mismatches.put(entry.getKey(), values);
        }
        return mismatches;
    }

    public Result reconcile(CarrierBackend.Subscription sub, Map<String, Object> requested,
                            boolean allowWrite) throws Exception {
        return reconcile(sub, requested, allowWrite, false);
    }

    public Result reconcile(CarrierBackend.Subscription sub, Map<String, Object> requested,
                            boolean allowWrite, boolean refreshSimIdentity) throws Exception {
        Map<String, Object> current = backend.read(sub.id);
        if (!Boolean.TRUE.equals(current.get(LOADED)))
            return new Result(sub, "waiting", false, List.of(), List.of(), current);
        Snapshot old = store.load(sub.id);
        // A non-persistent CarrierConfig override can survive long enough to be
        // observed after reboot. Its marker is paired with the persisted snapshot,
        // not with the current boot ID, so ownership remains explicit across boots.
        boolean ours = old != null && (old.session.equals(current.get(MARKER))
                || (!old.pending.isEmpty() && old.pendingSession.equals(current.get(MARKER))));
        if (!ours && current.containsKey(MARKER))
            return new Result(sub, "ownership_lost", false, List.of(), List.of(MARKER), current);
        Map<String, Object> baseline = new LinkedHashMap<>();
        Map<String, Object> previous = new LinkedHashMap<>();
        if (ours) {
            baseline.putAll(old.baseline);
            previous.putAll(old.owned);
            // Resolve an interrupted transaction from observed values. The last verified
            // ownership must survive a Binder failure before mutation.
            for (var entry : old.pending.entrySet()) {
                String key = entry.getKey();
                if (FeatureConfig.same(current.get(key), entry.getValue())
                        || ConfigurationVerification.isNrAvailabilityLimited(
                                key, entry.getValue(), current.get(key))) {
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
                if (!lost.isEmpty() && !canRebaseAfterCarrierReload(current, old, requested))
                    return new Result(sub, "ownership_lost", false, List.of(), lost, current);
                // A markerless reset invalidates the old baseline. Boot/explicit
                // apply reacquires the loaded baseline even if some native values
                // coincide with owned values. Other paths remain conservative.
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
            boolean limitedOwned = previous.containsKey(key)
                    && ConfigurationVerification.isNrAvailabilityLimited(
                            key, previous.get(key), current.get(key));
            boolean unchangedLimitedRequest = limitedOwned
                    && FeatureConfig.same(entry.getValue(), previous.get(key));
            boolean returnedToBaseline = limitedOwned
                    && FeatureConfig.same(current.get(key), baseline.get(key));
            if (previous.containsKey(key)
                    && !FeatureConfig.same(current.get(key), previous.get(key))
                    && !unchangedLimitedRequest && !returnedToBaseline) {
                conflicts.add(key);
                nextOwned.put(key, previous.get(key));
                continue;
            }
            // Keep the observed limitation and its original request visible. Do not
            // repeatedly rewrite NR during boot registration retries or periodic checks.
            if ((!FeatureConfig.same(current.get(key), entry.getValue()) && !unchangedLimitedRequest)
                    || (refreshSimIdentity && isSimIdentityKey(key)))
                payload.put(key, entry.getValue());
            if (previous.containsKey(key) || payload.containsKey(key))
                nextOwned.put(key, entry.getValue());
        }
        for (var entry : previous.entrySet()) {
            String key = entry.getKey();
            if (desired.containsKey(key)) continue;
            if (!FeatureConfig.same(current.get(key), entry.getValue())) {
                // Already at the recorded baseline: release our limited NR claim
                // without a write. Never use a newly observed value as a baseline.
                if (ConfigurationVerification.isNrAvailabilityLimited(
                        key, entry.getValue(), current.get(key))
                        && FeatureConfig.same(current.get(key), baseline.get(key))) continue;
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
            // Keep the last verified token until the Binder write is known to
            // have switched it. Pending writes can be recovered with either token.
            String priorToken = ours ? String.valueOf(current.get(MARKER)) : session;
            store.save(sub.id, new Snapshot(priorToken, baseline, previous, payload, session));
            payload.put(MARKER, session);
            backend.override(sub.id, payload);
            boolean verified = false;
            int limitedSamples = 0;
            for (int i = 0; i < 25; i++) {
                sleeper.sleep();
                current = backend.read(sub.id);
                verified = Boolean.TRUE.equals(current.get(LOADED))
                        && session.equals(current.get(MARKER));
                boolean limited = false;
                for (var entry : payload.entrySet()) {
                    if (FeatureConfig.same(current.get(entry.getKey()), entry.getValue())) continue;
                    if (ConfigurationVerification.isNrAvailabilityLimited(
                            entry.getKey(), entry.getValue(), current.get(entry.getKey()))) {
                        limited = true;
                    } else { verified = false; break; }
                }
                limitedSamples = verified && limited ? limitedSamples + 1 : 0;
                if (verified && (!limited || limitedSamples >= 3)) break;
                verified = false;
            }
            if (!verified) throw new VerificationException(
                    "CarrierConfig read-back mismatch for subId=" + sub.id);
        }
        if (ours || !payload.isEmpty()) {
            // Keep the stored owner token aligned with the marker that is actually
            // present. A changed payload writes this boot's marker; an unchanged
            // cross-boot reconciliation deliberately retains the prior marker.
            String ownerToken = !payload.isEmpty() ? session : String.valueOf(current.get(MARKER));
            store.save(sub.id, new Snapshot(ownerToken, baseline, nextOwned));
        }
        boolean nrLimited = new ConfigurationVerification(
                current, desired, current.get(MARKER)).nrLimited;
        String phase = !conflicts.isEmpty() ? "conflict" : nrLimited ? "configured_partial" :
                (!payload.isEmpty() ? (desired.isEmpty() ? "restored" : "verified") : "unchanged");
        return new Result(sub, phase, !payload.isEmpty(), unsupported, conflicts, current);
    }
}
