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
    private static final Path STATUS = JsonIO.STATE.resolve("status.json");
    private static final Path BLOCKED = JsonIO.STATE.resolve("blocked.json");
    private static final Path UNINSTALL_RECOVERY = JsonIO.STATE.resolve("uninstall-restore.json");

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
            } else if (action.equals("get-config")) result = JsonIO.read(JsonIO.CONFIG);
            else {
                try (Locked ignored = lock("operation.lock", true)) {
                    if (action.equals("save")) {
                        if (args.length != 3 || args[2].length() > 16384)
                            throw new IllegalArgumentException("Missing or oversized config");
                        JSONObject incoming = new JSONObject(new String(
                                Base64.getDecoder().decode(args[2]), StandardCharsets.UTF_8));
                        FeatureConfig config = JsonIO.config(incoming);
                        JsonIO.write(JsonIO.CONFIG, JsonIO.config(config));
                        if (config.periodicCheckEnabled) startWatcher();
                        result = new JSONObject().put("ok", true).put("saved", true)
                                .put("config", JsonIO.config(config));
                    } else if (Set.of("probe", "apply", "restore").contains(action)) {
                        if (action.equals("restore")) {
                            JSONObject config = JsonIO.read(JsonIO.CONFIG);
                            config.put("enabled", false);
                            config.put("periodic_check_enabled", false);
                            config.put("sim_profiles", new JSONObject());
                            JsonIO.write(JsonIO.CONFIG, JsonIO.config(JsonIO.config(config)));
                        }
                        result = runOnce(action.equals("probe"), action.equals("restore"),
                                action.equals("apply"));
                        if (!action.equals("probe")) {
                            JsonIO.write(STATUS, result);
                            if (result.getBoolean("ok")) {
                                Files.deleteIfExists(BLOCKED);
                                Files.deleteIfExists(UNINSTALL_RECOVERY);
                            }
                        }
                    } else throw new IllegalArgumentException("Unknown action: " + action);
                }
            }
            System.out.println(result.toString());
            if (result.has("ok") && !result.getBoolean("ok")) code = 2;
        } catch (Throwable e) {
            try {
                JSONObject result = error(e);
                System.out.println(result.toString());
                if (module != null && Files.isDirectory(JsonIO.STATE)) {
                    JsonIO.write(STATUS, result);
                    log("ERROR " + result.optString("error"));
                }
            } catch (Throwable ignored) { System.err.println(e.toString()); }
            code = 1;
        }
        System.exit(code);
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
                .put("time_ms", System.currentTimeMillis());
    }

    private static JSONObject runOnce(boolean preview, boolean restore, boolean forceApply) throws Exception {
        FeatureConfig config = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
        // A user-triggered apply must cover IMS features even when boot automation
        // is off. Automatic boot/periodic passes keep the saved enabled state.
        FeatureConfig effective = forceApply && !restore && !preview
                ? new FeatureConfig(true, config.periodicCheckEnabled, config.selection,
                        config.intervalSeconds, config.modes, config.simProfiles, config.implementationMode) : config;
        AndroidCarrierBackend backend = backend();
        List<CarrierBackend.Subscription> subscriptions = backend.subscriptions();
        boolean carrierMode = "carrier_ims".equals(config.implementationMode);
        CarrierTestOverrideControl overrideControl = null;
        if (!preview) {
            boolean hasOwnedOverride = subscriptions.stream()
                    .anyMatch(sub -> CarrierTestOverrideControl.hasRecord(sub.id));
            boolean hasExplicitTestIdentity = carrierMode && subscriptions.stream().anyMatch(sub -> {
                FeatureConfig.SimProfile profile = config.simProfiles.get(sub.slot);
                return config.selects(sub.slot) && profile != null
                        && !profile.carrierTestMccMnc.trim().isEmpty();
            });
            // Resolve the Binder signature only when applying a requested test identity
            // or cleaning an override that this module previously recorded as its own.
            // An empty profile means use the SIM's native operator identity.
            if (hasExplicitTestIdentity || hasOwnedOverride)
                overrideControl = new CarrierTestOverrideControl(session);
        }
        Engine engine = new Engine(backend, new JsonIO(), session, () -> Thread.sleep(200));
        JSONArray overrideResults = new JSONArray();
        Map<Integer, String> overrideErrors = new HashMap<>();
        Set<Integer> knownModuleCarrierIdentityReload = new HashSet<>();
        boolean carrierIdentityChanged = false;
        boolean configured = effective.enabled || effective.hasSimProfiles();

        // Set or clear our carrier-test identity before applying CarrierConfig:
        // Android may asynchronously load a partial native profile after this call.
        if (!preview && overrideControl != null) {
            for (CarrierBackend.Subscription sub : subscriptions) {
                try {
                    FeatureConfig.SimProfile profile = effective.simProfiles.get(sub.slot);
                    String code = profile == null ? "" : profile.carrierTestMccMnc.trim();
                    boolean wantsCode = !code.isEmpty();
                    boolean selected = !restore && carrierMode && configured && config.selects(sub.slot);
                    if (CarrierTestOverrideControl.hasRecord(sub.id)
                            && (restore || !carrierMode || !configured
                                    || !config.selects(sub.slot) || !wantsCode)) {
                        overrideResults.put(new JSONObject(overrideControl.clearOwned(
                                sub.id, sub.slot, backend.activeSubscriptionMccMnc(sub))));
                        knownModuleCarrierIdentityReload.add(sub.id);
                        carrierIdentityChanged = true;
                    } else if (selected && wantsCode) {
                        Map<String, Object> result = overrideControl.apply(sub.id, sub.slot, code);
                        overrideResults.put(new JSONObject(result));
                        if (overrideControl.isCurrentSessionOwned(sub.id, sub.slot, code))
                            knownModuleCarrierIdentityReload.add(sub.id);
                        if ("binder_accepted".equals(result.get("phase")))
                            carrierIdentityChanged = true;
                    } else if (selected) {
                        overrideResults.put(nativeIdentityResult(sub));
                    }
                } catch (Throwable error) {
                    String detail = String.valueOf(error.getMessage());
                    overrideErrors.put(sub.id, detail);
                    overrideResults.put(new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                            .put("phase", "apply_failed").put("binder_accepted", false)
                            .put("request_accepted", false)
                            .put("effective_identity_verification", "unavailable").put("error", detail));
                    log("subId=" + sub.id + " carrier test override ERROR " + detail);
                }
            }
        } else if (!preview && carrierMode && configured) {
            for (CarrierBackend.Subscription sub : subscriptions) {
                FeatureConfig.SimProfile profile = effective.simProfiles.get(sub.slot);
                if (config.selects(sub.slot) && (profile == null || profile.carrierTestMccMnc.trim().isEmpty()))
                    overrideResults.put(nativeIdentityResult(sub));
            }
        }
        if (carrierIdentityChanged) awaitCarrierIdentityReload(backend, knownModuleCarrierIdentityReload);
        BatchRunner.Report report = BatchRunner.run(subscriptions, effective, engine, preview, restore,
                knownModuleCarrierIdentityReload::contains);
        JSONArray results = new JSONArray();
        boolean imsFailure = false;
        boolean imsUnregistered = false;
        Map<Integer, String> carrierConfigErrors = new HashMap<>();
        for (BatchRunner.Entry entry : report.entries) {
            if (entry.selected && entry.error != null)
                carrierConfigErrors.put(entry.sub.id, String.valueOf(entry.error.getMessage()));
        }
        boolean imsFailure = false;
        boolean imsUnregistered = false;
        for (BatchRunner.Entry entry : report.entries) {
            if (entry.selected && entry.error != null)
                carrierConfigErrors.put(entry.sub.id, String.valueOf(entry.error.getMessage()));
        }
        boolean imsOverrideFailure = !overrideErrors.isEmpty();
        JSONArray imsResults = new JSONArray();
        CarrierImsControl imsControl = null;
        if (carrierMode) {
            try { imsControl = new CarrierImsControl(); }
            catch (Throwable ignored) { /* Per-SIM result below reports the capability error. */ }
        }
        for (BatchRunner.Entry entry : report.entries) {
            CarrierBackend.Subscription sub = entry.sub;
            JSONObject row = new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                    .put("selected", entry.selected);
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
                        .put("effective", JsonIO.values(r.effective));
                if (!preview && (r.changed || !r.conflicts.isEmpty()))
                    log("subId=" + sub.id + " phase=" + r.phase
                            + " conflicts=" + r.conflicts + " unsupported=" + r.unsupported);
            }
            if (carrierMode && (entry.selected || restore)) {
                JSONObject imsRow = new JSONObject().put("sub_id", sub.id).put("slot", sub.slot);
                try {
                    if (!restore && entry.selected && entry.error != null) {
                        imsFailure = true;
                        imsRow.put("phase", "carrier_config_failed")
                                .put("registered", JSONObject.NULL)
                                .put("error", String.valueOf(entry.error.getMessage()));
                    } else if (!restore && entry.selected && overrideErrors.containsKey(sub.id)) {
                        imsFailure = true;
                        imsRow.put("phase", "carrier_test_override_failed")
                                .put("registered", JSONObject.NULL)
                                .put("error", overrideErrors.get(sub.id));
                    } else if (!preview && entry.selected
                            && (entry.result == null
                            || !CarrierImsControl.isReadyForReset(entry.result.phase)
                            || !entry.result.unsupported.isEmpty()
                            || !entry.result.conflicts.isEmpty())) {
                        String configPhase = entry.result == null ? "unknown" : entry.result.phase;
                        imsRow.put("phase", "carrier_config_not_ready")
                                .put("registered", JSONObject.NULL)
                                .put("error", "CarrierConfig is not ready for IMS reset: " + configPhase);
                    } else {
                        if (imsControl == null) throw new IllegalStateException(
                                "Carrier IMS telephony methods are unavailable in this KSU runtime");
                        CarrierImsControl.Registration registration;
                        if (preview) {
                            boolean registered = imsControl.isRegistered(sub.id);
                            registration = new CarrierImsControl.Registration(registered,
                                    registered ? "ims_registered" : "ims_not_registered", "");
                        } else {
                            registration = imsControl.resetAndAwait(sub.id, sub.slot, 20, 1000L,
                                    CarrierImsControl.settleDelayMillis(entry.result.phase, entry.result.changed));
                        }
                        imsRow.put("phase", registration.phase)
                                .put("registered", registration.registered)
                                .put("service_source", imsControl.serviceSource());
                        if (!registration.error.isEmpty()) imsRow.put("error", registration.error);
                        if (!registration.registered) {
                            imsFailure = true;
                            imsUnregistered |= registration.phase.equals("ims_not_registered");
                        }
                    }
                    row.put("ims", imsRow);
                } catch (Throwable error) {
                    imsFailure = true;
                    imsRow.put("phase", "ims_status_unavailable")
                            .put("registered", JSONObject.NULL)
                            .put("error", String.valueOf(error.getMessage()));
                    row.put("ims", imsRow);
                }
                imsResults.put(imsRow);
            }
            results.put(row);
        }
        boolean ok = report.ok && !imsFailure && !imsOverrideFailure;
        String phase = report.phase;
        if (imsOverrideFailure && report.ok)
            phase = "carrier_test_override_failed";
        else if (carrierMode && imsFailure && report.ok)
            phase = imsUnregistered ? "ims_not_registered" : "ims_status_unavailable";
        return identity().put("ok", ok).put("phase", phase)
                .put("changed", report.changed).put("write_readback_verified", report.verified)
                .put("requires_manual_retry", report.requiresManualRetry || imsFailure || imsOverrideFailure)
                .put("implementation_mode", config.implementationMode)
                .put("carrier_ims_results", imsResults)
                .put("carrier_test_override_results", overrideResults)
                .put("config", JsonIO.config(config)).put("subscriptions", results)
                .put("binder", new JSONObject(backend.capabilities()));
    }

    private static JSONObject nativeIdentityResult(CarrierBackend.Subscription sub) {
        return new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                .put("mccmnc", "").put("phase", "not_requested_native_identity")
                .put("binder_accepted", false).put("request_accepted", false)
                .put("effective_identity_verification", "not_requested")
                .put("readback_available", false).put("readback_verified", false);
    }

    private static void awaitCarrierIdentityReload(AndroidCarrierBackend backend,
                                                   Set<Integer> affectedSubIds)
            throws InterruptedException {
        if (affectedSubIds.isEmpty()) return;
        // CarrierConfig can say LOADED while the selected profile is still rebuilding.
        // Keep the settling window bounded so boot cannot stall indefinitely.
        for (int attempt = 0; attempt < 12; attempt++) {
            for (int subId : affectedSubIds) {
                try { backend.read(subId); }
                catch (Throwable error) {
                    log("CarrierConfig settling read failed for subId=" + subId + ": "
                            + String.valueOf(error.getMessage()));
                }
            }
            if (attempt + 1 < 12) Thread.sleep(250);
        }
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
        if (Files.exists(UNINSTALL_RECOVERY))
            result.put("uninstall_recovery", JsonIO.read(UNINSTALL_RECOVERY));
        Path pid = JsonIO.STATE.resolve("watcher.json");
        if (Files.exists(pid)) {
            JSONObject info = JsonIO.read(pid);
            int watcherPid = info.optInt("pid", -1);
            boolean alive = session.equals(info.optString("session")) && watcherPid > 0
                    && Files.isDirectory(Paths.get("/proc/" + watcherPid));
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

    private static JSONObject automaticAttempt() throws Exception {
        try (Locked operation = lock("operation.lock", true)) {
            JSONObject result = runOnce(false, false, false);
            JsonIO.write(STATUS, result);
            String phase = result.optString("phase");
            // An IMS stack can still be re-registering immediately after reset. Keep
            // this bounded retry path alive; all other failed/uncertain writes remain
            // blocked for explicit inspection instead of being retried blindly.
            if (!AutoApply.isRetryablePhase(phase)
                    && (result.optBoolean("requires_manual_retry")
                    || !result.optBoolean("ok")))
                JsonIO.write(BLOCKED, result);
            return result;
        }
    }

    private static JSONObject boundedApply(boolean bootOnly) throws Exception {
        JSONObject result = AutoApply.untilReady(() -> {
            FeatureConfig config = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
            if (!installedAndEnabled() || (bootOnly && !config.enabled && !config.hasSimProfiles())
                    || (!bootOnly && !config.periodicCheckEnabled))
                return identity().put("ok", true).put("phase", "paused");
            if (Files.exists(BLOCKED)) return JsonIO.read(BLOCKED);
            return automaticAttempt();
        }, value -> value.optString("phase"), Thread::sleep);
        String finalPhase = result.optString("phase");
        if (AutoApply.isRetryablePhase(finalPhase)) {
            result.put("phase", "retry_timeout").put("retry_reason", finalPhase)
                    .put("ok", false).put("requires_manual_retry", false);
            JsonIO.write(STATUS, result);
            log("Automatic retry timed out: " + finalPhase);
        }
        return result;
    }

    private static void watch(boolean bootPass) throws Exception {
        try (Locked daemon = lock("daemon.lock", !bootPass)) {
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
                JsonIO.write(STATUS, result);
                JsonIO.write(BLOCKED, result);
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
        return new JSONObject().put("ok", false).put("phase", "error")
                .put("type", e.getClass().getName()).put("error", String.valueOf(e.getMessage()))
                .put("uid", Os.getuid()).put("sdk", Build.VERSION.SDK_INT).put("session", session)
                .put("time_ms", System.currentTimeMillis());
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

    private static Locked lock(String name, boolean wait) throws Exception {
        FileChannel channel = FileChannel.open(JsonIO.STATE.resolve(name),
                StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        int tries = wait ? 100 : 1;
        try {
            for (int i = 0; i < tries; i++) {
                FileLock lock = channel.tryLock();
                if (lock != null) return new Locked(channel, lock);
                Thread.sleep(100);
            }
            throw new IOException("Another runner operation is busy");
        } catch (Exception e) { channel.close(); throw e; }
    }
    private static final class Locked implements AutoCloseable {
        final FileChannel channel; final FileLock lock;
        Locked(FileChannel channel, FileLock lock) { this.channel = channel; this.lock = lock; }
        @Override public void close() throws Exception { lock.release(); channel.close(); }
    }
}
