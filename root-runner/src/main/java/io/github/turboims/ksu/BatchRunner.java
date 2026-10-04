package io.github.turboims.ksu;

import java.util.*;

/** Isolates subscriptions: an error on one SIM must not discard results for the others. */
public final class BatchRunner {
    public static final class Entry {
        public final CarrierBackend.Subscription sub;
        public final boolean selected;
        public final Engine.Result result;
        public final Exception error;
        Entry(CarrierBackend.Subscription sub, boolean selected, Engine.Result result, Exception error) {
            this.sub = sub; this.selected = selected; this.result = result; this.error = error;
        }
    }
    public static final class Report {
        public final List<Entry> entries;
        public final boolean ok, changed, verified, requiresManualRetry;
        public final String phase;
        Report(List<Entry> entries, boolean ok, boolean changed, boolean verified,
               boolean requiresManualRetry, String phase) {
            this.entries = entries; this.ok = ok; this.changed = changed;
            this.verified = verified; this.requiresManualRetry = requiresManualRetry; this.phase = phase;
        }
    }
    public static Report run(List<CarrierBackend.Subscription> subscriptions, FeatureConfig config,
                             Engine engine, boolean preview, boolean restore) {
        return run(subscriptions, config, engine, preview, restore, sub -> false);
    }

    /** Rebase authority is scoped per SIM after this module changes Carrier test identity. */
    public static Report run(List<CarrierBackend.Subscription> subscriptions, FeatureConfig config,
                             Engine engine, boolean preview, boolean restore,
                             java.util.function.Predicate<CarrierBackend.Subscription> knownModuleCarrierIdentityReload) {
        List<Entry> entries = new ArrayList<>();
        boolean selected = false, waiting = false, conflict = false, unsupported = false;
        boolean failed = false, verificationFailed = false, changed = false, verified = false, lost = false;
        for (CarrierBackend.Subscription sub : subscriptions) {
            boolean configured = config.enabled || config.hasSimProfiles();
            boolean target = !restore && config.selects(sub.slot) && configured;
            selected |= target;
            try {
                Engine.Result r = engine.reconcile(sub,
                        target ? config.desiredForSlot(sub.slot) : Collections.emptyMap(), !preview,
                        knownModuleCarrierIdentityReload.test(sub));
                entries.add(new Entry(sub, target, r, null));
                waiting |= r.phase.equals("waiting") && (target || restore);
                conflict |= !r.conflicts.isEmpty();
                lost |= r.phase.equals("ownership_lost");
                unsupported |= !r.unsupported.isEmpty();
                changed |= r.changed;
                verified |= r.phase.equals("verified") || r.phase.equals("restored")
                        || (!preview && target && r.phase.equals("unchanged")
                                && r.unsupported.isEmpty() && r.conflicts.isEmpty());
            } catch (Exception error) {
                failed = true;
                verificationFailed |= error instanceof Engine.VerificationException;
                entries.add(new Entry(sub, target, null, error));
            }
        }
        if ((config.enabled || config.hasSimProfiles()) && !selected && !restore) waiting = true;
        boolean ok = !(waiting || conflict || unsupported || failed);
        String phase = verificationFailed ? "verification_failed" : failed ? "error"
                : lost ? "ownership_lost" : conflict ? "conflict"
                : waiting ? "waiting" : unsupported ? "partial" : preview ? "probe"
                : (config.enabled || config.hasSimProfiles()) && !restore ? "active" : "paused";
        return new Report(entries, ok, changed, verified, failed || lost, phase);
    }
}
