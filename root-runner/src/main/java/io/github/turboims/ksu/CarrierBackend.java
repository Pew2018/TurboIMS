package io.github.turboims.ksu;

import java.util.*;

public interface CarrierBackend {
    final class Subscription {
        public final int id, slot;
        public Subscription(int id, int slot) { this.id = id; this.slot = slot; }
    }
    List<Subscription> subscriptions() throws Exception;
    Map<String, Object> read(int subId) throws Exception;
    void override(int subId, Map<String, Object> values) throws Exception;
}
