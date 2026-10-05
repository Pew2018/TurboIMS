package io.github.turboims.ksu;

import android.os.IBinder;
import android.os.PersistableBundle;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

public final class AndroidCarrierBackend implements CarrierBackend {
    private final Class<?> serviceManager, carrierType, subType;
    private final Method reader, writer, activeIds, slotIndex;
    private final String[] requestedKeys;
    private static final long SIM_REFRESH_TIMEOUT_MS = 15000L;
    private static final long SIM_REFRESH_POLL_MS = 250L;

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

    /**
     * SIM status feature added for the Settings status card.
     * This is read-only: it observes the framework's public SIM properties and
     * never changes CarrierConfig or the saved configuration.
     */
    public Map<String, String> simIdentity(CarrierBackend.Subscription sub) {
        Map<String, String> result = new LinkedHashMap<>();
        result.put("country_iso", propertyAtSlot("gsm.sim.operator.iso-country", sub.slot).toUpperCase(Locale.ROOT));
        result.put("carrier_name", propertyAtSlot("gsm.sim.operator.alpha", sub.slot));
        return result;
    }

    public String simOperatorNumeric(CarrierBackend.Subscription sub) {
        return propertyAtSlot("gsm.sim.operator.numeric", sub.slot);
    }

    public String networkOperatorNumeric(CarrierBackend.Subscription sub) {
        return propertyAtSlot("gsm.operator.numeric", sub.slot);
    }

    /**
     * Read the current ISub subscription code for diagnostics. Carrier test reloads
     * can change this database value, so it is NOT a reliable native restoration
     * source after an override. Only capture a baseline before our first test write.
     */
    public String activeSubscriptionMccMnc(CarrierBackend.Subscription subscription) throws Exception {
        Object sub = service("isub", subType);
        Method infoMethod = null;
        for (Method method : subType.getMethods()) {
            Class<?>[] parameters = method.getParameterTypes();
            if (!method.getName().equals("getActiveSubscriptionInfo")
                    || parameters.length < 1 || parameters[0] != int.class) continue;
            boolean supported = true;
            for (int i = 1; i < parameters.length; i++)
                if (parameters[i] != String.class && parameters[i] != boolean.class) supported = false;
            if (supported && (infoMethod == null || parameters.length > infoMethod.getParameterCount()))
                infoMethod = method;
        }
        if (infoMethod == null)
            throw new NoSuchMethodException("ISub.getActiveSubscriptionInfo signature unavailable");
        Class<?>[] parameters = infoMethod.getParameterTypes();
        Object[] args = new Object[parameters.length];
        args[0] = subscription.id;
        boolean packageAssigned = false;
        for (int i = 1; i < parameters.length; i++) {
            if (parameters[i] == String.class && !packageAssigned) {
                args[i] = "android";
                packageAssigned = true;
            } else if (parameters[i] == boolean.class) {
                args[i] = false;
            } else {
                args[i] = null;
            }
        }
        Object info = invoke(infoMethod, sub, args);
        if (info == null)
            throw new java.io.IOException("No active SubscriptionInfo for subId=" + subscription.id);
        String mcc = readString(info, "getMccString");
        String mnc = readString(info, "getMncString");
        if (mcc == null || mcc.isEmpty()) mcc = readNumeric(info, "getMcc", 3);
        if (mnc == null || mnc.isEmpty()) mnc = readNumeric(info, "getMnc", 2);
        String combined = normalizeMccMnc(mcc, mnc);
        if (combined.isEmpty())
            throw new java.io.IOException("Active SIM MCC/MNC is unavailable for subId=" + subscription.id);
        return combined;
    }

    static String normalizeMccMnc(String mcc, String mnc) {
        String cleanMcc = mcc == null ? "" : mcc.replaceAll("[^0-9]", "");
        String cleanMnc = mnc == null ? "" : mnc.replaceAll("[^0-9]", "");
        if (cleanMcc.length() != 3 || (cleanMnc.length() != 2 && cleanMnc.length() != 3)) return "";
        return cleanMcc + cleanMnc;
    }

    private static String readString(Object target, String methodName) {
        try {
            Object value = target.getClass().getMethod(methodName).invoke(target);
            return value == null ? "" : String.valueOf(value).trim();
        } catch (Throwable unavailable) {
            return "";
        }
    }

    private static String readNumeric(Object target, String methodName, int minimumWidth) {
        try {
            Object value = target.getClass().getMethod(methodName).invoke(target);
            if (!(value instanceof Number)) return "";
            int number = ((Number) value).intValue();
            if (number < 0 || number > 999) return "";
            return String.format(Locale.ROOT, "%0" + minimumWidth + "d", number);
        } catch (Throwable unavailable) {
            return "";
        }
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
        awaitSimProperties(subId, values);
    }

    /**
     * CarrierConfig broadcasts and Telephony property updates are asynchronous. CarrierConfig
     * read-back can succeed before the SIM identity exposed to framework clients changes. Wait for
     * the slot's public SIM properties so status becomes "verified" only after the visible layer
     * has caught up. This is bounded and skipped for IMS-only writes.
     */
    private void awaitSimProperties(int subId, Map<String, Object> values) {
        String expectedIso = asString(values.get("sim_country_iso_override_string"));
        String expectedCarrier = asString(values.get("carrier_name_string"));
        if (expectedIso == null && expectedCarrier == null) return;
        try {
            int slot = (int) invoke(slotIndex, service("isub", subType), subId);
            long deadline = System.currentTimeMillis() + SIM_REFRESH_TIMEOUT_MS;
            while (System.currentTimeMillis() < deadline) {
                String actualIso = propertyAtSlot("gsm.sim.operator.iso-country", slot);
                String actualCarrier = propertyAtSlot("gsm.sim.operator.alpha", slot);
                boolean isoOk = expectedIso == null || expectedIso.equalsIgnoreCase(actualIso);
                boolean carrierOk = expectedCarrier == null || expectedCarrier.equals(actualCarrier);
                if (isoOk && carrierOk) return;
                Thread.sleep(SIM_REFRESH_POLL_MS);
            }
        } catch (Throwable ignored) {
            // CarrierConfig remains authoritative when vendor properties are unavailable.
        }
    }

    private static String asString(Object value) {
        return value instanceof String && !((String) value).isEmpty() ? (String) value : null;
    }

    private static String propertyAtSlot(String property, int slot) {
        try {
            // SystemProperties is already exempted by ModuleMain and avoids spawning
            // a shell process for every 250 ms readiness sample.
            Class<?> type = Class.forName("android.os.SystemProperties");
            Method get = type.getMethod("get", String.class);
            String value = String.valueOf(get.invoke(null, property)).trim();
            if (value.startsWith("[") && value.endsWith("]"))
                value = value.substring(1, value.length() - 1);
            String[] slots = value.split(",", -1);
            return slot >= 0 && slot < slots.length ? slots[slot].trim() : "";
        } catch (Throwable hiddenApiUnavailable) {
            // Keep a bounded fallback for vendor builds that hide SystemProperties.
            try {
                Process process = new ProcessBuilder("getprop", property)
                        .redirectErrorStream(true).start();
                String line;
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(process.getInputStream()))) {
                    line = reader.readLine();
                }
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
                if (line == null) return "";
                String value = line.trim();
                if (value.startsWith("[") && value.endsWith("]"))
                    value = value.substring(1, value.length() - 1);
                String[] slots = value.split(",", -1);
                return slot >= 0 && slot < slots.length ? slots[slot].trim() : "";
            } catch (Throwable ignored) {
                return "";
            }
        }
    }
}
