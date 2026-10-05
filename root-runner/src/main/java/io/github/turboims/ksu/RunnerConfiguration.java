package io.github.turboims.ksu;

import java.io.IOException;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.Arrays;

/** Configuration saves never acquire the long-running telephony operation lock. */
final class RunnerConfiguration {
    static final class Superseded extends IOException {
        Superseded() { super("Saved configuration changed during this operation"); }
    }

    static final class Snapshot {
        private final Path path;
        private final byte[] bytes;
        final String text;
        final String revision;
        Snapshot(Path path) throws Exception {
            this.path = path;
            bytes = Files.readAllBytes(path);
            text = new String(bytes, StandardCharsets.UTF_8);
            StringBuilder hash = new StringBuilder();
            for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes))
                hash.append(Character.forDigit((value & 255) >>> 4, 16))
                    .append(Character.forDigit(value & 15, 16));
            revision = hash.toString();
        }
        boolean isCurrent() throws IOException {
            return Arrays.equals(bytes, Files.readAllBytes(path));
        }
        void requireCurrent() throws IOException {
            if (!isCurrent()) throw new Superseded();
        }
    }

    interface Publication { void commit() throws Exception; }

    /** A save and an old task's result cannot cross this revision check. */
    static boolean publish(Path config, Path configurationLock, String revision,
                           Publication publication) throws Exception {
        try (Locked ignored = lock(configurationLock, true)) {
            if (revision.isEmpty() || !revision.equals(new Snapshot(config).revision)) return false;
            publication.commit();
            return true;
        }
    }

    static Locked lock(Path path, boolean wait) throws Exception {
        return lock(path, wait ? 100 : 1);
    }

    static Locked lock(Path path, int tries) throws Exception {
        FileChannel channel = FileChannel.open(path,
                StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        try {
            for (int i = 0; i < tries; i++) {
                FileLock held = null;
                try { held = channel.tryLock(); }
                catch (OverlappingFileLockException busyInThisProcess) { /* Same JVM tests. */ }
                if (held != null) return new Locked(channel, held);
                if (i + 1 < tries) Thread.sleep(100);
            }
            throw new IOException("Another runner operation is busy");
        } catch (Exception error) {
            channel.close();
            throw error;
        }
    }

    static final class Locked implements AutoCloseable {
        private final FileChannel channel;
        private final FileLock held;
        Locked(FileChannel channel, FileLock held) { this.channel = channel; this.held = held; }
        @Override public void close() throws IOException {
            try { held.release(); } finally { channel.close(); }
        }
    }
    private RunnerConfiguration() {}
}
