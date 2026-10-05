package io.github.turboims.ksu;

import android.os.Build;
import android.os.FileObserver;
import android.os.Process;
import android.os.SystemClock;
import android.system.Os;
import org.json.*;
import org.lsposed.hiddenapibypass.HiddenApiBypass;
import java.io.*;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class ModuleMain {
    private static Path module;
    private static String session;
    private static String actionName = "initializing";
    private static RunnerConfiguration.Snapshot activeConfiguration;
    private static final Path STATUS = JsonIO.STATE.resolve("status.json");
    private static final Path BLOCKED = JsonIO.STATE.resolve("blocked.json");

    public static void main(String[] args) {
        int code = 0;
        try {
            if (Os.getuid() != 0) throw new SecurityException("This runner must execute as uid 0");
            if (args.length < 2 || args.length > 3) throw new IllegalArgumentException("Invalid args");
            module = Paths.get(args[0]).toRealPath();
            if (!module.getFileName().toString().equals("turboims_next")
                    || !Set.of("/data/adb/modules", "/data/adb/modules_update")
                        .contains(module.getParent().toString()))
                throw new SecurityException("Unexpected module path");
            if (Build.VERSION.SDK_INT < 33 || Build.VERSION.SDK_INT > 37)
                throw new IllegalStateException("Supported runner range is Android 13..17 (SDK 33..37)");
            Files.createDirectories(JsonIO.STATE);
            Os.chmod(JsonIO.STATE.toString(), 0700);
            session = new String(Files.readAllBytes(Paths.get("/proc/sys/kernel/random/boot_id")),
                    StandardCharsets.UTF_8).trim();
            if (!Files.exists(JsonIO.CONFIG)) {
                Files.copy(module.resolve("default-config.json"), JsonIO.CONFIG);
                Os.chmod(JsonIO.CONFIG.toString(), 0600);
            }
            String action = args[1];
            actionName = action;
            if (Set.of("apply", "restore", "watch", "watch-periodic").contains(action))
                migrateIdentityPreferences();
            if (action.equals("watch") || action.equals("watch-periodic")) {
                try { watch(action.equals("watch")); }
                catch (IOException duplicate) {
                    if (!"Another runner operation is busy".equals(duplicate.getMessage()))
                        throw duplicate;
                }
                // app_process keeps ART/FileObserver threads alive after main returns.
                // Terminate the runner explicitly after all cleanup.
                System.exit(0);
                return;
            }
            JSONObject result;
            if (action.equals("status") || action.equals("export")) {
                result = status();
                if (action.equals("export")) {
                    Path log = JsonIO.STATE.resolve("runner.log");
                    result.put("log", Files.exists(log)
                            ? new String(Files.readAllBytes(log), StandardCharsets.UTF_8) : "");
                }
            } else if (action.equals("get-config")) result = JsonIO.config(JsonIO.config(JsonIO.read(JsonIO.CONFIG)));
            else if (action.equals("save")) {
                if (args.length != 3 || args[2].length() > 16384)
                    throw new IllegalArgumentException("Missing or oversized config");
                JSONObject incoming = new JSONObject(new String(
                        Base64.getDecoder().decode(args[2]), StandardCharsets.UTF_8));
                FeatureConfig config = JsonIO.config(incoming);
                // Never wait for registration polling to save user preferences.
                try (RunnerConfiguration.Locked ignored = lock("config.lock", true)) {
                    JsonIO.write(JsonIO.CONFIG, JsonIO.config(config));
                    result = new JSONObject().put("ok", true).put("saved", true)
                            .put("config", JsonIO.config(config));
                }
                if (config.periodicCheckEnabled) startWatcher();
            } else {
                try (RunnerConfiguration.Locked ignored = lock("operation.lock", true)) {
                    if (!Set.of("probe", "apply", "restore").contains(action))
                        throw new IllegalArgumentException("Unknown action: " + action);
                    if (action.equals("restore")) {
                        try (RunnerConfiguration.Locked configuration = lock("config.lock", true)) {
                            JSONObject config = JsonIO.read(JsonIO.CONFIG);
                            config.put("enabled", false);
                            config.put("periodic_check_enabled", false);
                            config.put("sim_profiles", new JSONObject());
                            JsonIO.write(JsonIO.CONFIG, JsonIO.config(JsonIO.config(config)));
                        }
                    }
                    result = runOnce(action.equals("probe"), action.equals("restore"),
                            action.equals("apply"));
                    if (!action.equals("probe")) publishResult(result, false);
                }
            }
            System.out.println(result.toString());
            if (result.has("ok") && !result.getBoolean("ok")) code = 2;
        } catch (Throwable e) {
            try {
                JSONObject result = error(e);
                System.out.println(result.toString());
                if (module != null && Files.isDirectory(JsonIO.STATE)) {
                    // A failed read-only probe/status or rejected save must not
                    // replace the most recent boot/apply result.
                    if (Set.of("apply", "restore", "watch", "watch-periodic").contains(actionName))
                        publishResult(result, false);
                    log("action=" + actionName + " ERROR " + result.optString("error"));
                }
            } catch (Throwable ignored) { System.err.println(e.toString()); }
            code = 1;
        }
        System.exit(code);
    }

    private static void migrateIdentityPreferences() throws Exception {
        try (RunnerConfiguration.Locked ignored = lock("config.lock", true)) {
            JSONObject saved = JsonIO.read(JsonIO.CONFIG);
            JSONObject profiles = saved.optJSONObject("sim_profiles");
            boolean legacy = false;
            if (profiles != null) {
                Iterator<String> slots = profiles.keys();
                while (slots.hasNext())
                    legacy |= !profiles.getJSONObject(slots.next()).has("carrier_test_enabled");
            }
            if (legacy) {
                JsonIO.write(JsonIO.CONFIG, JsonIO.config(JsonIO.config(saved)));
                log("Migrated legacy SIM display profiles: carrier test identity defaults off");
            }
        }
    }

    private static AndroidCarrierBackend backend() throws Exception {
        if (!HiddenApiBypass.addHiddenApiExemptions("Landroid/os/ServiceManager;",
                "Lcom/android/internal/telephony/", "Landroid/os/SystemProperties;",
                "Landroid/telephony/TelephonyFrameworkInitializer;",
                "Landroid/telephony/TelephonyServiceManager;"))
            throw new IllegalStateException("Hidden API access initialization failed");
        return new AndroidCarrierBackend();
    }

    private static JSONObject identity() throws Exception {
        String context = new String(Files.readAllBytes(Paths.get("/proc/self/attr/current")),
                StandardCharsets.UTF_8).replace("\u0000", "").trim();
        return new JSONObject().put("uid", Os.getuid()).put("pid", Process.myPid())
                .put("selinux_context", context).put("sdk", Build.VERSION.SDK_INT)
                .put("device", Build.DEVICE).put("session", session)
                .put("time_ms", System.currentTimeMillis()).put("action", actionName);
    }

    private static JSONObject runOnce(boolean preview, boolean restore, boolean forceApply) throws Exception {
        return runOnce(preview, restore, forceApply, false, new CarrierImsControl.Task());
    }

    private static JSONObject runOnce(boolean preview, boolean restore, boolean forceApply,
                                      boolean bootRecovery, CarrierImsControl.Task imsTask) throws Exception {
        RunnerConfiguration.Snapshot captured = new RunnerConfiguration.Snapshot(JsonIO.CONFIG);
        activeConfiguration = captured;
        imsTask.useConfiguration(captured.revision);
        try {
            return runConfigured(preview, restore, forceApply, bootRecovery, imsTask, captured);
        } catch (RunnerConfiguration.Superseded changed) {
            log("action=" + actionName + " operation_superseded");
            return identity().put("ok", false).put("phase", "superseded")
                    .put("configuration_revision", captured.revision)
                    .put("requires_manual_retry", false);
        }
    }

    private static JSONObject runConfigured(boolean preview, boolean restore, boolean forceApply,
                                            boolean bootRecovery, CarrierImsControl.Task imsTask,
                                            RunnerConfiguration.Snapshot captured) throws Exception {
        long started = SystemClock.elapsedRealtime();
        if (!preview) log("action=" + actionName + " run_started pid=" + Process.myPid());
        FeatureConfig config = JsonIO.config(new JSONObject(captured.text));
        // A user-triggered apply must cover IMS features even when boot automation
        // is off. Automatic boot/periodic passes keep the saved enabled state.
        FeatureConfig effective = forceApply && !restore && !preview
                ? new FeatureConfig(true, config.periodicCheckEnabled, config.selection,
                        config.intervalSeconds, config.modes, config.simProfiles, config.implementationMode) : config;
        AndroidCarrierBackend backend = backend();
        List<CarrierBackend.Subscription> subscriptions = backend.subscriptions();
        boolean carrierMode = "carrier_ims".equals(config.implementationMode);
        boolean observeRegistration = effective.enabled && !restore;
        JSONArray overrideResults = new JSONArray();
        CarrierTestOverrideControl overrideControl = null;
        if (!preview) {
            boolean hasOwnedOverride = subscriptions.stream()
                    .anyMatch(sub -> CarrierTestOverrideControl.hasRecord(sub.id));
            boolean hasExplicitTestIdentity = carrierMode && subscriptions.stream().anyMatch(sub -> {
                FeatureConfig.SimProfile profile = config.simProfiles.get(sub.slot);
                return config.selects(sub.slot) && profile != null
                        && !profile.requestedTestMccMnc().isEmpty();
            });
            // Resolve the Binder signature only when applying a requested test identity
            // or cleaning an override that this module previously recorded as its own.
            // An empty profile means use the SIM's native operator identity.
            if (hasExplicitTestIdentity || hasOwnedOverride)
                overrideControl = new CarrierTestOverrideControl(session);
        }
        Engine engine = new Engine(backend, new JsonIO(), session, () -> Thread.sleep(200),
                !preview && !restore && (bootRecovery || forceApply));
        // Check ownership/readiness without mutating CarrierConfig. Test identity
        // changes must precede the final write because they notify SIM registrants
        // and may reload carrier settings or change public SIM properties.
        BatchRunner.Report preflight = BatchRunner.run(subscriptions, effective, engine, true, restore);
        boolean testIdentityChanged = false;
        Set<Integer> refreshSimIdentity = new HashSet<>();
        JSONArray results = new JSONArray();
        boolean imsFailure = false;
        boolean imsUnregistered = false;
        boolean imsServiceWaiting = false;
        boolean imsTerminalFailure = false;
        boolean simIdentityPending = false;
        boolean identityCleanupRequiresReboot = false;
        Map<Integer, String> overrideErrors = new HashMap<>();
        Map<Integer, String> carrierConfigErrors = new HashMap<>();
        for (BatchRunner.Entry entry : preflight.entries) {
            if (entry.error != null)
                carrierConfigErrors.put(entry.sub.id, String.valueOf(entry.error.getMessage()));
            else if (entry.result != null
                    && (entry.result.phase.equals("waiting") || !entry.result.conflicts.isEmpty()))
                carrierConfigErrors.put(entry.sub.id, entry.result.phase);
            if (!preview && entry.selected && !carrierConfigErrors.containsKey(entry.sub.id)
                    && !Engine.simIdentityMatches(backend.simIdentity(entry.sub),
                            effective.desiredForSlot(entry.sub.slot)))
                refreshSimIdentity.add(entry.sub.id);
        }
        boolean configured = config.enabled || config.hasSimProfiles();
        if (!preview && overrideControl != null) {
            for (CarrierBackend.Subscription sub : subscriptions) {
                captured.requireCurrent();
                if (carrierConfigErrors.containsKey(sub.id)) {
                    overrideResults.put(new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                            .put("phase", "skipped_carrier_config_failed")
                            .put("error", carrierConfigErrors.get(sub.id)));
                    continue;
                }
                try {
                    FeatureConfig.SimProfile profile = config.simProfiles.get(sub.slot);
                    String requestedMccMnc = profile == null ? "" : profile.requestedTestMccMnc();
                    boolean targetRequested = !requestedMccMnc.isEmpty();
                    if (CarrierTestOverrideControl.hasRecord(sub.id)
                            && (restore || !carrierMode || !configured
                                    || !config.selects(sub.slot) || !targetRequested)) {
                        Map<String, Object> cleared = overrideControl.clearOwned(
                                sub.id, sub.slot, backend.simOperatorNumeric(sub));
                        overrideResults.put(new JSONObject(cleared));
                        boolean clearedNow = cleared.get("phase").equals("cleared_owned")
                                || cleared.get("phase").equals("restored_native_identity_fallback");
                        testIdentityChanged |= clearedNow;
                        if (clearedNow) refreshSimIdentity.add(sub.id);
                    } else if (!restore && carrierMode && configured && config.selects(sub.slot)
                            && targetRequested) {
                        Map<String, Object> applied = overrideControl.apply(
                                sub.id, sub.slot, requestedMccMnc, backend.simOperatorNumeric(sub),
                                backend.activeSubscriptionMccMnc(sub));
                        overrideResults.put(new JSONObject(applied));
                        testIdentityChanged |= applied.get("phase").equals("binder_accepted");
                        if (applied.get("phase").equals("binder_accepted")) refreshSimIdentity.add(sub.id);
                    } else if (!restore && carrierMode && configured && config.selects(sub.slot)
                            && !targetRequested) {
                        overrideResults.put(new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                                .put("mccmnc", "").put("phase", "not_requested_native_identity")
                                .put("binder_accepted", false).put("readback_available", false)
                                .put("readback_verified", false));
                    }
                } catch (Throwable error) {
                    String detail = String.valueOf(error.getMessage());
                    boolean needsReboot = error instanceof CarrierTestOverrideControl.CleanupRequiresReboot;
                    identityCleanupRequiresReboot |= needsReboot;
                    overrideErrors.put(sub.id, detail);
                    overrideResults.put(new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                            .put("phase", needsReboot ? "carrier_test_cleanup_requires_reboot" : "apply_failed")
                            .put("requires_reboot", needsReboot).put("binder_accepted", false)
                            .put("error", detail));
                    log("subId=" + sub.id + " carrier test override ERROR " + detail);
                }
            }
        } else if (!preview && carrierMode && configured) {
            for (CarrierBackend.Subscription sub : subscriptions) {
                FeatureConfig.SimProfile profile = config.simProfiles.get(sub.slot);
                if (config.selects(sub.slot) && (profile == null || profile.requestedTestMccMnc().isEmpty())) {
                    overrideResults.put(new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                            .put("mccmnc", "").put("phase", "not_requested_native_identity")
                            .put("binder_accepted", false).put("readback_available", false)
                            .put("readback_verified", false));
                }
            }
        }
        // Binder acceptance is not a carrier reload completion signal. Give the
        // queued SIM notifications a bounded settling interval, then read fresh
        // CarrierConfig in the write pass; an unloaded bundle returns waiting.
        if (testIdentityChanged) configurationPause(captured, 5000L);
        captured.requireCurrent();
        BatchRunner.Report report = preview ? preflight
                : BatchRunner.run(subscriptions, effective, engine, false, restore, refreshSimIdentity);
        boolean postResetReload = false;
        boolean postResetMismatch = false;
        boolean nrLimited = false;
        boolean anySelected = false;
        boolean allConfigVerified = true, allImsConfigVerified = true;
        boolean allSimProfilesVerified = true, allNrVerified = true;
        List<Boolean> registrationObservations = new ArrayList<>();
        boolean imsOverrideFailure = !overrideErrors.isEmpty();
        JSONArray imsResults = new JSONArray();
        CarrierImsControl imsControl = null;
        Exception imsInitError = null;
        if (observeRegistration) {
            try { imsControl = new CarrierImsControl(carrierMode); }
            catch (Exception error) { imsInitError = error; }
        }
        for (BatchRunner.Entry entry : report.entries) {
            captured.requireCurrent();
            CarrierBackend.Subscription sub = entry.sub;
            JSONObject row = new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                    .put("selected", entry.selected);
            // These are public operator codes, not IMSI, ICCID or a phone number.
            row.put("sim_operator_numeric", backend.simOperatorNumeric(sub))
                    .put("network_operator_numeric", backend.networkOperatorNumeric(sub));
            try { row.put("subscription_mccmnc", backend.activeSubscriptionMccMnc(sub)); }
            catch (Exception unavailable) {
                row.put("subscription_mccmnc_error", String.valueOf(unavailable.getMessage()));
            }
            if (entry.error != null) {
                row.put("phase", entry.error instanceof Engine.VerificationException
                        ? "verification_failed" : "error")
                        .put("changed", false).put("write_state_unknown", !preview)
                        .put("error", String.valueOf(entry.error.getMessage()))
                        .put("type", entry.error.getClass().getName())
                        .put("unsupported", new JSONArray()).put("conflicts", new JSONArray());
                if (!preview) log("subId=" + sub.id + " ERROR " + entry.error);
            } else {
                Engine.Result r = entry.result;
                row.put("phase", r.phase).put("changed", r.changed)
                        .put("unsupported", new JSONArray(r.unsupported))
                        .put("conflicts", new JSONArray(r.conflicts))
                        .put("effective", JsonIO.values(r.effective))
                        .put("carrier_config_at_write_verification", JsonIO.values(r.effective));
                if (!preview && (r.changed || !r.conflicts.isEmpty()))
                    log("subId=" + sub.id + " phase=" + r.phase
                            + " conflicts=" + r.conflicts + " unsupported=" + r.unsupported);
            }
            long observationStarted = SystemClock.elapsedRealtime();
            if (observeRegistration && entry.selected) {
                if (!preview) log("action=" + actionName + " subId=" + sub.id
                        + " ims_observation_started");
                JSONObject imsRow = new JSONObject().put("sub_id", sub.id).put("slot", sub.slot);
                try {
                    if (entry.error != null) {
                        imsFailure = true;
                        imsRow.put("phase", "carrier_config_failed")
                                .put("registered", JSONObject.NULL)
                                .put("error", String.valueOf(entry.error.getMessage()));
                    } else if (overrideErrors.containsKey(sub.id)) {
                        imsFailure = true;
                        imsRow.put("phase", "carrier_test_override_failed")
                                .put("registered", JSONObject.NULL)
                                .put("error", overrideErrors.get(sub.id));
                    } else if (!preview
                            && (entry.result == null
                            || !CarrierImsControl.isReadyForReset(entry.result.phase)
                            || !entry.result.unsupported.isEmpty()
                            || !entry.result.conflicts.isEmpty())) {
                        String configPhase = entry.result == null ? "unknown" : entry.result.phase;
                        imsRow.put("phase", "carrier_config_not_ready")
                                .put("registered", JSONObject.NULL)
                                .put("error", "CarrierConfig is not ready for IMS observation: " + configPhase);
                    } else {
                        if (imsControl == null) {
                            if (imsInitError != null) throw imsInitError;
                            throw new IllegalStateException("Carrier IMS telephony methods are unavailable in this KSU runtime");
                        }
                        CarrierImsControl.Registration registration;
                        if (preview) {
                            boolean registered = imsControl.isRegistered(sub.id);
                            registration = new CarrierImsControl.Registration(registered,
                                    registered ? "ims_registered" : "ims_not_registered", "");
                        } else {
                            registration = imsTask.observe(imsControl, sub.id, sub.slot, 20, 1000L, carrierMode,
                                    captured::isCurrent);
                        }
                        imsRow.put("phase", registration.phase)
                                .put("registered", registration.registered)
                                .put("service_source", imsControl.serviceSource())
                                .put("reset_accepted_this_attempt", registration.resetAccepted);
                        if (!registration.error.isEmpty()) imsRow.put("error", registration.error);
                        if (!registration.registered) {
                            imsFailure = true;
                            imsUnregistered |= registration.phase.equals("ims_not_registered");
                            imsServiceWaiting |= registration.phase.equals("waiting");
                            imsTerminalFailure |= !AutoApply.isRetryablePhase(registration.phase);
                        }
                    }
                    row.put("ims", imsRow);
                } catch (Throwable error) {
                    imsFailure = true;
                    boolean waiting = error instanceof Exception
                            && AutoApply.isFrameworkNotReady((Exception) error);
                    imsServiceWaiting |= waiting;
                    imsTerminalFailure |= !waiting;
                    imsRow.put("phase", waiting ? "waiting" : "ims_status_unavailable")
                            .put("registered", JSONObject.NULL)
                            .put("error", String.valueOf(error.getMessage()));
                    row.put("ims", imsRow);
                }
                captured.requireCurrent();
                imsRow.put("observation_duration_ms",
                        SystemClock.elapsedRealtime() - observationStarted);
                imsResults.put(imsRow);
                if (!preview) log("action=" + actionName + " subId=" + sub.id
                        + " ims_observation_finished phase=" + imsRow.optString("phase")
                        + " reset_accepted=" + imsRow.optBoolean("reset_accepted_this_attempt"));
            }
            ConfigurationVerification verification = null;
            boolean visibleSimVerified = false;
            if (entry.selected) {
                anySelected = true;
                Map<String, String> visible = backend.simIdentity(sub);
                visibleSimVerified = Engine.simIdentityMatches(visible, effective.desiredForSlot(sub.slot));
                row.put("sim_properties", new JSONObject(visible));
            }
            if (entry.selected && entry.error == null
                    && entry.result != null && entry.result.conflicts.isEmpty()
                    && entry.result.unsupported.isEmpty()
                    && (preview && "preview".equals(entry.result.phase)
                            || CarrierImsControl.isReadyForReset(entry.result.phase))) {
                // Re-read AFTER test identity changes and IMS reset. A result from
                // before either operation must not be reported as final success.
                if (!preview && carrierMode) configurationPause(captured, 2000L);
                try {
                    Map<String, Object> latest = backend.read(sub.id);
                    row.put("effective", JsonIO.values(latest))
                            .put("verification_stage", preview ? "read_only_observation" : carrierMode
                                    ? "after_ims_observation" : "final_readback");
                    Map<String, Map<String, Object>> mismatches = Engine.readbackMismatches(
                            latest, effective.desiredForSlot(sub.slot));
                    JSONObject differences = new JSONObject();
                    for (var mismatch : mismatches.entrySet()) {
                        JSONObject values = JsonIO.values(mismatch.getValue());
                        if (mismatch.getValue().get("actual") == null)
                            values.put("actual", JSONObject.NULL);
                        differences.put(mismatch.getKey(), values);
                    }
                    row.put("verification_mismatches", differences)
                            .put("expected_owner_marker", entry.result.effective.get(Engine.MARKER))
                            .put("observed_owner_marker", latest.containsKey(Engine.MARKER)
                                    ? latest.get(Engine.MARKER) : JSONObject.NULL);
                    if (!preview && !mismatches.isEmpty())
                        log("action=" + actionName + " subId=" + sub.id
                                + " final_readback_mismatches=" + differences);
                    verification = new ConfigurationVerification(latest,
                            effective.desiredForSlot(sub.slot), entry.result.effective.get(Engine.MARKER));
                    String readbackPhase = verification.phase;
                    row.put("configuration_phase", readbackPhase);
                    nrLimited |= verification.nrLimited;
                    if (!preview) {
                        postResetReload |= readbackPhase.equals("carrier_config_reloaded");
                        postResetMismatch |= readbackPhase.equals("verification_failed");
                        if (!readbackPhase.equals("verified")) row.put("phase", readbackPhase);
                    }
                    Map<String, String> visible = backend.simIdentity(sub);
                    visibleSimVerified = Engine.simIdentityMatches(visible,
                            effective.desiredForSlot(sub.slot));
                    row.put("sim_properties", new JSONObject(visible));
                    if (!preview && verification.simConfigVerified && !visibleSimVerified) {
                        simIdentityPending = true;
                        row.put("phase", "sim_identity_pending");
                    }
                } catch (Exception error) {
                    boolean waiting = AutoApply.isFrameworkNotReady(error);
                    postResetReload |= !preview && waiting;
                    postResetMismatch |= !preview && !waiting;
                    row.put("phase", waiting ? "carrier_config_reloaded" : "verification_failed")
                            .put("error", String.valueOf(error.getMessage()));
                }
            }
            if (entry.selected) {
                boolean simVerified = verification != null
                        && verification.simConfigVerified && visibleSimVerified;
                row.put("ims_configuration_verified", verification != null && verification.imsVerified)
                        .put("sim_profiles_verified", simVerified)
                        .put("nr_configuration_verified", verification != null && verification.nrVerified)
                        .put("configuration_partial", verification != null && verification.nrLimited);
                allConfigVerified &= verification != null && verification.fullVerified;
                allImsConfigVerified &= verification != null && verification.imsVerified;
                allSimProfilesVerified &= simVerified;
                allNrVerified &= verification != null && verification.nrVerified;
                if (observeRegistration) {
                    JSONObject observation = row.optJSONObject("ims");
                    registrationObservations.add(observation == null || observation.isNull("registered")
                            ? null : observation.optBoolean("registered"));
                }
            }
            results.put(row);
        }
        captured.requireCurrent();
        boolean configurationApplied = !preview && report.ok && !imsOverrideFailure
                && !postResetReload && !postResetMismatch && !simIdentityPending && !nrLimited;
        boolean ok = report.ok && !imsFailure && !imsOverrideFailure
                && !postResetReload && !postResetMismatch && !simIdentityPending;
        String phase = AutoApply.resultPhase(report.phase,
                identityCleanupRequiresReboot ? "carrier_test_cleanup_requires_reboot" : "",
                postResetMismatch ? "verification_failed" : "",
                imsOverrideFailure ? "carrier_test_override_failed" : "",
                imsTerminalFailure ? "ims_status_unavailable" : "",
                postResetReload ? "carrier_config_reloaded" : "",
                imsServiceWaiting ? "waiting" : "",
                simIdentityPending ? "sim_identity_pending" : "",
                imsUnregistered ? "ims_not_registered" : "",
                nrLimited ? "configured_partial" : "");
        if (!preview) log("action=" + actionName + " run_finished pid=" + Process.myPid()
                + " phase=" + phase + " duration_ms=" + (SystemClock.elapsedRealtime() - started));
        return identity().put("ok", ok).put("phase", phase)
                .put("configuration_revision", captured.revision)
                .put("configuration_applied", configurationApplied)
                .put("configuration_partial", nrLimited)
                .put("ims_configuration_verified", anySelected && allImsConfigVerified)
                .put("nr_configuration_verified", anySelected && allNrVerified)
                .put("ims_registration_state", ConfigurationVerification.registrationState(
                        preview, registrationObservations))
                .put("duration_ms", SystemClock.elapsedRealtime() - started)
                .put("changed", report.changed).put("write_readback_verified",
                        !preview && (anySelected ? allConfigVerified : report.verified)
                                && !postResetReload && !postResetMismatch)
                .put("sim_profiles_verified",
                        anySelected && allSimProfilesVerified)
                .put("requires_manual_retry",
                        !AutoApply.isRetryablePhase(phase)
                                && (report.requiresManualRetry || imsFailure
                                        || imsOverrideFailure || postResetMismatch))
                .put("requires_reboot", identityCleanupRequiresReboot)
                .put("implementation_mode", config.implementationMode)
                .put("ims_results", imsResults)
                .put("ims_registration_verified", ConfigurationVerification.stableRegistrationVerified(
                        preview, registrationObservations))
                .put("carrier_ims_results", carrierMode ? imsResults : new JSONArray())
                .put("carrier_test_override_results", overrideResults)
                .put("config", JsonIO.config(config)).put("subscriptions", results)
                .put("binder", new JSONObject(backend.capabilities()));
    }

    /**
     * Read-only SIM status for the Settings card.
     * New bottom-layer feature: this path only reads active subscriptions and
     * public telephony properties; it is deliberately separate from apply/restore.
     */
    private static JSONArray simCards() {
        JSONArray cards = new JSONArray();
        try {
            AndroidCarrierBackend backend = backend();
            for (CarrierBackend.Subscription sub : backend.subscriptions()) {
                JSONObject card = new JSONObject().put("slot", sub.slot).put("sub_id", sub.id);
                try {
                    Map<String, String> identity = backend.simIdentity(sub);
                    card.put("country_iso", identity.getOrDefault("country_iso", ""));
                    card.put("carrier_name", identity.getOrDefault("carrier_name", ""));
                    card.put("phase", "ready");
                } catch (Throwable error) {
                    card.put("phase", "unavailable").put("error", String.valueOf(error.getMessage()));
                }
                cards.put(card);
            }
        } catch (Throwable error) {
            // Status must remain usable when telephony is still booting.
        }
        return cards;
    }

    private static JSONObject status() throws Exception {
        JSONObject result = identity().put("ok", true)
                .put("config", JsonIO.config(JsonIO.config(JsonIO.read(JsonIO.CONFIG))))
                .put("sim_cards", simCards());
        JSONObject last = Files.exists(STATUS) ? JsonIO.read(STATUS) : null;
        if (last != null && session.equals(last.optString("session"))) result.put("status", last);
        else {
            result.put("status", new JSONObject().put("phase", "not_started"));
            if (last != null) result.put("previous_status", last);
        }
        if (Files.exists(BLOCKED)) {
            JSONObject blocked = JsonIO.read(BLOCKED);
            if (session.equals(blocked.optString("session"))) result.put("blocked", blocked);
        }
        Path pid = JsonIO.STATE.resolve("watcher.json");
        if (Files.exists(pid)) {
            JSONObject info = JsonIO.read(pid);
            int watcherPid = info.optInt("pid", -1);
            boolean alive = session.equals(info.optString("session")) && watcherPid > 0
                    && Files.isDirectory(Paths.get("/proc/" + watcherPid));
            if (!alive && "running".equals(info.optString("mode")))
                info.put("recorded_mode", "running").put("mode", "interrupted");
            result.put("watcher", info.put("alive", alive));
        }
        return result;
    }

    private static void startWatcher() throws Exception {
        // Always launch a candidate. If an old worker is exiting during this save,
        // the candidate waits for its lock instead of losing the new schedule.
        Path log = JsonIO.STATE.resolve("launcher.log");
        new ProcessBuilder("/system/bin/sh", module.resolve("control.sh").toString(), "watch-periodic")
                .redirectOutput(ProcessBuilder.Redirect.appendTo(log.toFile()))
                .redirectError(ProcessBuilder.Redirect.appendTo(log.toFile()))
                .start();
    }

    private static JSONObject automaticAttempt(boolean bootRecovery,
                                               CarrierImsControl.Task imsTask) throws Exception {
        try (RunnerConfiguration.Locked operation = lock("operation.lock", true)) {
            JSONObject result;
            try {
                result = runOnce(false, false, false, bootRecovery, imsTask);
            } catch (Exception error) {
                if (!AutoApply.isFrameworkNotReady(error)) throw error;
                result = identity().put("ok", false).put("phase", "waiting")
                        .put("requires_manual_retry", false)
                        .put("configuration_revision", activeConfiguration.revision)
                        .put("error", String.valueOf(error.getMessage()));
            }
            if (!publishResult(result, true))
                return identity().put("ok", false).put("phase", "superseded")
                        .put("requires_manual_retry", false);
            return result;
        }
    }

    private static JSONObject boundedApply(boolean bootOnly) throws Exception {
        CarrierImsControl.Task imsTask = new CarrierImsControl.Task();
        JSONObject result = AutoApply.untilReady(() -> {
            FeatureConfig config = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
            if (!installedAndEnabled() || (bootOnly && !config.enabled && !config.hasSimProfiles())
                    || (!bootOnly && !config.periodicCheckEnabled))
                return identity().put("ok", true).put("phase", "paused");
            if (Files.exists(BLOCKED)) return JsonIO.read(BLOCKED);
            return automaticAttempt(bootOnly, imsTask);
        }, ModuleMain::automaticPhase, Thread::sleep);
        String finalPhase = automaticPhase(result);
        if (AutoApply.isRetryablePhase(finalPhase)) {
            result.put("phase", "retry_timeout").put("retry_reason", finalPhase)
                    .put("ok", false).put("requires_manual_retry", false);
            publishResult(result, false);
            log("Automatic retry timed out: " + finalPhase);
        }
        return result;
    }

    private static void watch(boolean bootPass) throws Exception {
        try (RunnerConfiguration.Locked daemon = lock("daemon.lock", !bootPass)) {
            Path marker = JsonIO.STATE.resolve("watcher.json");
            JsonIO.write(marker, new JSONObject().put("pid", Process.myPid())
                    .put("session", session).put("mode", "running"));
            if (Files.exists(BLOCKED) && !session.equals(JsonIO.read(BLOCKED).optString("session")))
                Files.delete(BLOCKED);
            log("Automatic task started, sdk=" + Build.VERSION.SDK_INT);
            FeatureConfig boot = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
            if (bootPass && (boot.enabled || boot.hasSimProfiles()) && !Files.exists(BLOCKED)) boundedApply(true);
            // The normal boot path is one-shot. Do not create an inotify/FileObserver
            // thread unless the user explicitly enabled periodic compatibility checks.
            FeatureConfig afterBoot = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
            if (!afterBoot.periodicCheckEnabled || Files.exists(BLOCKED)) {
                JsonIO.write(marker, new JSONObject().put("pid", -1)
                        .put("session", session).put("mode", "completed"));
                return;
            }
            final Object changed = new Object();
            final long[] generation = {0};
            // Config is atomically replaced; observe the directory's MOVED_TO event.
            // No one-second file polling or wake lock is held during timed waits.
            FileObserver observer = new FileObserver(JsonIO.STATE.toString(),
                    FileObserver.MOVED_TO | FileObserver.CLOSE_WRITE) {
                @Override public void onEvent(int event, String path) {
                    if ("config.json".equals(path)) {
                        synchronized (changed) { generation[0]++; changed.notifyAll(); }
                    }
                }
            };
            observer.startWatching();
            try {
                while (installedAndEnabled()) {
                    long seen;
                    synchronized (changed) { seen = generation[0]; }
                    FeatureConfig config = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
                    if (!config.periodicCheckEnabled || Files.exists(BLOCKED)) break;
                    boolean updated;
                    synchronized (changed) {
                        long end = SystemClock.elapsedRealtime() + config.intervalSeconds * 1000L;
                        long remaining;
                        while (generation[0] == seen
                                && (remaining = end - SystemClock.elapsedRealtime()) > 0)
                            changed.wait(remaining);
                        updated = generation[0] != seen;
                    }
                    if (updated) continue; // A saved interval starts a fresh wait.
                    config = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
                    if (!config.periodicCheckEnabled || Files.exists(BLOCKED)) break;
                    boundedApply(false);
                }
            } catch (Exception e) {
                JSONObject result = error(e);
                publishResult(result, true);
                log("Automatic task stopped: " + result.optString("error"));
            } finally {
                observer.stopWatching();
                // A completed or disabled task NEVER restores an applied override.
                JsonIO.write(marker, new JSONObject().put("pid", -1)
                        .put("session", session).put("mode", "completed"));
            }
        }
    }

    private static boolean installedAndEnabled() {
        return Files.exists(module.resolve("module.prop"))
                && !Files.exists(module.resolve("disable")) && !Files.exists(module.resolve("remove"));
    }

    private static JSONObject error(Throwable e) throws Exception {
        JSONObject result = new JSONObject().put("ok", false).put("phase", "error")
                .put("type", e.getClass().getName()).put("error", String.valueOf(e.getMessage()))
                .put("uid", Os.getuid()).put("sdk", Build.VERSION.SDK_INT).put("session", session)
                .put("time_ms", System.currentTimeMillis());
        if (activeConfiguration != null)
            result.put("configuration_revision", activeConfiguration.revision);
        return result;
    }

    private static void log(String message) throws Exception {
        Path path = JsonIO.STATE.resolve("runner.log");
        if (Files.exists(path) && Files.size(path) > 262144)
            Files.move(path, JsonIO.STATE.resolve("runner.previous.log"),
                    StandardCopyOption.REPLACE_EXISTING);
        Files.write(path, (System.currentTimeMillis() + " " + message + "\n")
                .getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        Os.chmod(path.toString(), 0600);
    }

    private static String automaticPhase(JSONObject result) {
        return AutoApply.automaticPhase(result.optString("phase"),
                result.optBoolean("configuration_applied"));
    }

    private static void configurationPause(RunnerConfiguration.Snapshot captured, long millis)
            throws Exception {
        while (millis > 0) {
            captured.requireCurrent();
            long interval = Math.min(millis, 200L);
            Thread.sleep(interval);
            millis -= interval;
        }
        captured.requireCurrent();
    }

    /** Serialize only config publication, never the telephony observation deadline. */
    private static boolean publishResult(JSONObject result, boolean blockFailure) throws Exception {
        if ("superseded".equals(result.optString("phase"))) return false;
        return RunnerConfiguration.publish(JsonIO.CONFIG, JsonIO.STATE.resolve("config.lock"),
                result.optString("configuration_revision"), () -> {
            JsonIO.write(STATUS, result);
            if (result.optBoolean("ok") || result.optBoolean("configuration_applied")
                    && "ims_not_registered".equals(result.optString("phase")))
                Files.deleteIfExists(BLOCKED);
            if (blockFailure && !AutoApply.isRetryablePhase(result.optString("phase"))
                    && (result.optBoolean("requires_manual_retry") || !result.optBoolean("ok")))
                JsonIO.write(BLOCKED, result);
        });
    }

    private static RunnerConfiguration.Locked lock(String name, boolean wait) throws Exception {
        // An apply of an unchanged saved config may still need to wait for the
        // current bounded observation; saves use their own short lock.
        return RunnerConfiguration.lock(JsonIO.STATE.resolve(name),
                wait ? ("operation.lock".equals(name) ? 600 : 100) : 1);
    }
}
