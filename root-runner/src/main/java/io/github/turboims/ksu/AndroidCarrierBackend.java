package io.github.turboims.ksu;

import android.os.IBinder;
import android.os.PersistableBundle;
import java.lang.reflect.*;
import java.util.*;

public final class AndroidCarrierBackend implements CarrierBackend {
    private final Class<?> serviceManager, carrierType, subType;
    private final Method reader, writer, activeIds, slotIndex;
    private final String[] requestedKeys;

    public AndroidCarrierBackend() throws Exception {
        serviceManager = Class.forName("android.os.ServiceManager");
        carrierType = Class.forName("com.android.internal.telephony.ICarrierConfigLoader");
        subType = Class.forName("com.android.internal.telephony.ISub");
        Method found;
        try {
            found = carrierType.getMethod("getConfigSubsetForSubIdWithFeature",
                    int.class, String.class, String.class, String[].class);
        } catch (NoSuchMethodException e) {
            found = carrierType.getMethod("getConfigForSubIdWithFeature",
                    int.class, String.class, String.class);
        }
        reader = found;
        writer = carrierType.getMethod("overrideConfig", int.class,
                PersistableBundle.class, boolean.class);
        activeIds = subType.getMethod("getActiveSubIdList", boolean.class);
        slotIndex = subType.getMethod("getSlotIndex", int.class);
        Set<String> keys = new LinkedHashSet<>(FeatureConfig.knownKeys());
        keys.add(Engine.MARKER); keys.add(Engine.LOADED);
        requestedKeys = keys.toArray(new String[0]);
    }

    private Object service(String name, Class<?> iface) throws Exception {
        IBinder binder = (IBinder) invoke(serviceManager.getMethod("getService", String.class),
                null, name);
        if (binder == null || !binder.pingBinder())
            throw new java.io.IOException("Binder service not ready: " + name);
        return invoke(Class.forName(iface.getName() + "$Stub")
                .getMethod("asInterface", IBinder.class), null, binder);
    }

    static Object invoke(Method method, Object receiver, Object... args) throws Exception {
        try { return method.invoke(receiver, args); }
        catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new IllegalStateException("Platform method failed: " + method.getName(), cause);
        }
    }

    public Map<String, Object> capabilities() throws Exception {
        service("carrier_config", carrierType); service("isub", subType);
        return Map.of("carrier_config", true, "isub", true,
                "read_method", reader.getName(), "override_method", writer.toGenericString(),
                "probe_is_read_only", true);
    }

    @Override public List<Subscription> subscriptions() throws Exception {
        Object sub = service("isub", subType);
        int[] ids = (int[]) invoke(activeIds, sub, false);
        List<Subscription> result = new ArrayList<>();
        if (ids != null) for (int id : ids) {
            int slot = (int) invoke(slotIndex, sub, id);
            if (id > 0 && slot >= 0) result.add(new Subscription(id, slot));
        }
        result.sort(Comparator.comparingInt(s -> s.slot));
        return result;
    }

    @Override public Map<String, Object> read(int subId) throws Exception {
        Object carrier = service("carrier_config", carrierType);
        PersistableBundle bundle = (PersistableBundle) (reader.getParameterCount() == 4
                ? invoke(reader, carrier, subId, "android", null, requestedKeys)
                : invoke(reader, carrier, subId, "android", null));
        if (bundle == null || bundle.isEmpty())
            throw new SecurityException("CarrierConfig read returned an empty bundle");
        Map<String, Object> result = new LinkedHashMap<>();
        for (String key : requestedKeys)
            if (bundle.containsKey(key)) result.put(key, bundle.get(key));
        return result;
    }

    @Override public void override(int subId, Map<String, Object> values) throws Exception {
        if (values.isEmpty()) return;
        PersistableBundle bundle = new PersistableBundle();
        for (var entry : values.entrySet()) {
            String key = entry.getKey(); Object value = entry.getValue();
            if (!FeatureConfig.knownKeys().contains(key) && !key.equals(Engine.MARKER))
                throw new IllegalArgumentException("Refusing unknown override key");
            if (value instanceof Boolean) bundle.putBoolean(key, (boolean) value);
            else if (value instanceof Integer) bundle.putInt(key, (int) value);
            else if (value instanceof int[]) bundle.putIntArray(key, (int[]) value);
            else if (value instanceof String && (key.equals(Engine.MARKER) || key.equals("sim_country_iso_override_string") || key.equals("carrier_name_string")))
                bundle.putString(key, (String) value);
            else throw new IllegalArgumentException("Unsupported value type: " + key);
        }
        // Keep all writes nonpersistent. NEVER pass null (would erase others' overrides).
        invoke(writer, service("carrier_config", carrierType), subId, bundle, false);
    }
}
