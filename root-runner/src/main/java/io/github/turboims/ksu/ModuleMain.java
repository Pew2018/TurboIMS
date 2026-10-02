package io.github.turboims.ksu;

import android.os.Build;
import android.os.Process;
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
            if (Build.VERSION.SDK_INT < 33 || Build.VERSION.SDK_INT > 36)
                throw new IllegalStateException("Initial support is Android 13..16 (SDK 33..36)");
            Files.createDirectories(JsonIO.STATE);
            Os.chmod(JsonIO.STATE.toString(), 0700);
            session = new String(Files.readAllBytes(Paths.get("/proc/sys/kernel/random/boot_id")),
                    StandardCharsets.UTF_8).trim();
            if (!Files.exists(JsonIO.CONFIG)) {
                Files.copy(module.resolve("default-config.json"), JsonIO.CONFIG);
                Os.chmod(JsonIO.CONFIG.toString(), 0600);
            }
            String action = args[1];
            if (action.equals("watch")) { watch(); return; }
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
                        result = new JSONObject().put("ok", true).put("saved", true)
                                .put("config", JsonIO.config(config));
                    } else if (Set.of("probe", "apply", "restore").contains(action)) {
                        if (action.equals("restore")) {
                            JSONObject config = JsonIO.read(JsonIO.CONFIG);
                            config.put("enabled", false);
                            JsonIO.write(JsonIO.CONFIG, JsonIO.config(JsonIO.config(config)));
                        }
                        result = runOnce(action.equals("probe"), action.equals("restore"));
                        if (!action.equals("probe")) {
                            JsonIO.write(STATUS, result);
                            if (result.getBoolean("ok")) Files.deleteIfExists(BLOCKED);
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
                "Lcom/android/internal/telephony/", "Landroid/os/SystemProperties;"))
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

    private static JSONObject runOnce(boolean preview, boolean restore) throws Exception {
        FeatureConfig config = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
        AndroidCarrierBackend backend = backend();
        Engine engine = new Engine(backend, new JsonIO(), session, () -> Thread.sleep(200));
        List<CarrierBackend.Subscription> subscriptions = backend.subscriptions();
        BatchRunner.Report report = BatchRunner.run(subscriptions, config, engine, preview, restore);
        JSONArray results = new JSONArray();
        for (BatchRunner.Entry entry : report.entries) {
            CarrierBackend.Subscription sub = entry.sub;
            JSONObject row = new JSONObject().put("sub_id", sub.id).put("slot", sub.slot)
                    .put("selected", entry.selected);
            if (entry.error != null) {
                row.put("phase", "error").put("changed", false).put("write_state_unknown", !preview)
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
            results.put(row);
        }
        return identity().put("ok", report.ok).put("phase", report.phase)
                .put("changed", report.changed).put("write_readback_verified", report.verified)
                .put("requires_manual_retry", report.requiresManualRetry)
                .put("config", JsonIO.config(config)).put("subscriptions", results)
                .put("binder", new JSONObject(backend.capabilities()));
    }

    private static JSONObject status() throws Exception {
        JSONObject result = identity().put("ok", true)
                .put("config", JsonIO.config(JsonIO.config(JsonIO.read(JsonIO.CONFIG))));
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
            result.put("watcher", info.put("alive", alive));
        }
        return result;
    }

    private static void watch() throws Exception {
        try (Locked daemon = lock("daemon.lock", false)) {
            JsonIO.write(JsonIO.STATE.resolve("watcher.json"),
                    new JSONObject().put("pid", Process.myPid()).put("session", session));
            if (Files.exists(BLOCKED) && !session.equals(JsonIO.read(BLOCKED).optString("session")))
                Files.delete(BLOCKED);
            log("Watcher started, sdk=" + Build.VERSION.SDK_INT + ", uid=" + Os.getuid());
            try {
                while (installedAndEnabled()) {
                    int seconds = 30;
                    try {
                        FeatureConfig config = JsonIO.config(JsonIO.read(JsonIO.CONFIG));
                        seconds = config.intervalSeconds;
                        if (!Files.exists(BLOCKED)) {
                            try (Locked operation = lock("operation.lock", true)) {
                                JSONObject result = runOnce(false, false);
                                JsonIO.write(STATUS, result);
                                if (result.optBoolean("requires_manual_retry"))
                                    JsonIO.write(BLOCKED, result);
                                if (result.optString("phase").equals("waiting")) seconds = 5;
                            }
                        }
                    } catch (Exception e) {
                        JSONObject result = error(e);
                        JsonIO.write(STATUS, result);
                        log("ERROR " + result.optString("error"));
                        if (e instanceof SecurityException || e instanceof ReflectiveOperationException
                                || e instanceof IllegalStateException
                                || e instanceof IllegalArgumentException) {
                            // Permission/ABI/verification failures stop automatic writes.
                            JsonIO.write(BLOCKED, result.put("session", session));
                        }
                        seconds = 15;
                    }
                    long stamp = Files.getLastModifiedTime(JsonIO.CONFIG).toMillis();
                    for (int i = 0; i < seconds && installedAndEnabled(); i++) {
                        Thread.sleep(1000);
                        if (Files.getLastModifiedTime(JsonIO.CONFIG).toMillis() != stamp) break;
                    }
                }
            } finally {
                // Best effort, narrow restore on live disable/uninstall; reboot clears nonpersistent
                // overrides even if this process is forcibly killed by the module manager.
                try (Locked operation = lock("operation.lock", true)) {
                    JsonIO.write(STATUS, runOnce(false, true));
                } catch (Exception e) { log("Exit restore failed: " + e); }
                JsonIO.write(JsonIO.STATE.resolve("watcher.json"),
                        new JSONObject().put("pid", -1).put("session", session));
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
