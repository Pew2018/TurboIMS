package io.github.turboims.ksu;

import java.util.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Exercises the actual engine, batch runner, bounded retry and IMS task together. */
public class BootRecoveryFlowTest {
    static class Device extends EngineTest.Fake {
        final Map<String,String> visible = new LinkedHashMap<>();
        final Map<String,Object> nativeValues = new LinkedHashMap<>();
        Device() {
            values.put("sim_country_iso_override_string", "");
            values.put("carrier_name_override_bool", true);
            values.put("carrier_name_string", "中国联通");
            nativeValues.putAll(values);
            visible.put("country_iso", "");
            visible.put("carrier_name", "中国联通");
        }
        void reboot() {
            values.clear(); values.putAll(nativeValues);
            // Native flags now partly coincide with the previous override.
            values.put(EngineTest.KEY, true);
            values.put("carrier_name_string", "中国联通");
            visible.put("country_iso", "");
            visible.put("carrier_name", "中国联通");
        }
        @Override public void override(int id, Map<String,Object> payload) {
            super.override(id, payload);
            Object iso = payload.get("sim_country_iso_override_string");
            Object carrier = payload.get("carrier_name_string");
            if (iso instanceof String) visible.put("country_iso", (String) iso);
            if (carrier instanceof String) visible.put("carrier_name", (String) carrier);
        }
    }

    static FeatureConfig config(String mode) {
        FeatureConfig base = FeatureConfigTest.config(true, FeatureConfig.Mode.ON);
        return new FeatureConfig(true, false, "all", 1800, base.modes,
                Map.of(0, new FeatureConfig.SimProfile("tw", "Chunghwa Telecom")), mode);
    }

    static String boot(Device device, String session, FeatureConfig config,
                       CarrierImsControlTest.FakeOps telephony) throws Exception {
        Engine engine = new Engine(device, device, session, () -> {}, true);
        CarrierImsControl.Task task = new CarrierImsControl.Task();
        CarrierImsControl ims = new CarrierImsControl(telephony);
        boolean[] identityChanged = {false};
        return AutoApply.untilReady(() -> {
            BatchRunner.Report preflight = BatchRunner.run(List.of(EngineTest.SUB),
                    config, engine, true, false);
            if (!preflight.ok) return preflight.phase;
            if ("carrier_ims".equals(config.implementationMode)
                    && config.simProfiles.containsKey(0)
                    && !config.simProfiles.get(0).requestedTestMccMnc().isEmpty() && !identityChanged[0]) {
                // Model the public-property invalidation caused by the test identity.
                device.visible.put("country_iso", "");
                device.visible.put("carrier_name", "");
                identityChanged[0] = true;
            }
            boolean refresh = !Engine.simIdentityMatches(device.visible, config.desiredForSlot(0));
            BatchRunner.Report report = BatchRunner.run(List.of(EngineTest.SUB), config,
                    engine, false, false, refresh ? Set.of(EngineTest.SUB.id) : Set.of());
            if (!report.ok) return report.phase;
            String imsPhase = "";
            CarrierImsControl.Registration registration = task.observe(
                    ims, EngineTest.SUB.id, 0, 20, 1000,
                    "carrier_ims".equals(config.implementationMode), millis -> {}, () -> true);
            if (!registration.registered) imsPhase = registration.phase;
            String readback = Engine.readbackPhase(device.values, config.desiredForSlot(0));
            String visible = Engine.simIdentityMatches(device.visible, config.desiredForSlot(0))
                    ? "" : "sim_identity_pending";
            return AutoApply.resultPhase(report.phase,
                    readback.equals("verified") ? "" : readback, visible, imsPhase);
        }, phase -> AutoApply.automaticPhase(phase,
                Engine.readbackPhase(device.values, config.desiredForSlot(0)).equals("verified")
                        && Engine.simIdentityMatches(device.visible, config.desiredForSlot(0))),
                millis -> {});
    }

    static void assertProfile(Device f, FeatureConfig config) {
        assertEquals("tw", f.visible.get("country_iso"));
        assertEquals("Chunghwa Telecom", f.visible.get("carrier_name"));
        for (var entry : config.desiredForSlot(0).entrySet())
            assertTrue(entry.getKey(), FeatureConfig.same(entry.getValue(), f.values.get(entry.getKey())));
    }

    @Test public void traditionalModeKeepsAutomaticApplyAcrossTwoReboots() throws Exception {
        Device f = new Device();
        FeatureConfig config = config("turboims");
        CarrierImsControlTest.FakeOps ims = new CarrierImsControlTest.FakeOps();
        assertEquals("active", boot(f, "boot-a", config, ims)); assertProfile(f, config);
        f.reboot();
        assertEquals("active", boot(f, "boot-b", config, ims)); assertProfile(f, config);
        assertEquals(2, f.writes);
        assertEquals(0, ims.resets);
    }

    @Test public void carrierModeSlowRegistrationPreservesIdentityAcrossTwoReboots() throws Exception {
        Device f = new Device();
        FeatureConfig config = config("carrier_ims");
        CarrierImsControlTest.FakeOps first = new CarrierImsControlTest.FakeOps();
        assertEquals("active", boot(f, "boot-a", config, first)); assertProfile(f, config);
        assertEquals(1, first.resets);
        assertEquals(26, first.reads);
        f.reboot();
        CarrierImsControlTest.FakeOps second = new CarrierImsControlTest.FakeOps();
        assertEquals("active", boot(f, "boot-b", config, second)); assertProfile(f, config);
        assertEquals(1, second.resets);
        assertEquals(26, second.reads);
        assertEquals(2, f.writes);
    }

    @Test public void testIdentityInvalidationRefreshesPropertiesWithUnchangedCarrierConfig() throws Exception {
        Device f = new Device();
        FeatureConfig base = config("carrier_ims");
        FeatureConfig config = new FeatureConfig(true,false,"all",1800,base.modes,
                Map.of(0,new FeatureConfig.SimProfile("tw","Chunghwa Telecom","46692",true)),"carrier_ims");
        CarrierImsControlTest.FakeOps first = new CarrierImsControlTest.FakeOps();
        first.readyAfter = 1;
        assertEquals("active", boot(f, "boot-a", config, first));
        int writes = f.writes;
        // CarrierConfig still holds the requested values; the identity operation
        // invalidates public properties. A differential-only write would do nothing.
        CarrierImsControlTest.FakeOps next = new CarrierImsControlTest.FakeOps();
        next.readyAfter = 1;
        assertEquals("active", boot(f, "boot-a", config, next));
        assertEquals(writes + 1, f.writes);
        assertProfile(f, config);
    }
    @Test public void bothModesAndDisplayChoicesApplyAutomaticallyAcrossTwoReboots() throws Exception {
        for (String mode:List.of("turboims","carrier_ims")) for (boolean display:new boolean[]{false,true}) {
            FeatureConfig base=config(mode);
            FeatureConfig config=new FeatureConfig(true,false,"all",1800,base.modes,
                    display ? base.simProfiles : Collections.emptyMap(),mode);
            Device device=new Device();
            for (String boot:List.of("boot-a","boot-b")) {
                CarrierImsControlTest.FakeOps ims=new CarrierImsControlTest.FakeOps(); ims.readyAfter=1;
                assertEquals("active",boot(device,boot,config,ims));
                assertEquals(mode.equals("carrier_ims") ? 1 : 0,ims.resets);
                assertEquals(2,ims.reads);
                if (display) { assertProfile(device,config); assertEquals("",config.simProfiles.get(0).requestedTestMccMnc()); }
                else assertEquals("中国联通",device.visible.get("carrier_name"));
                device.reboot();
            }
            assertEquals(2,device.writes);
        }
    }
    @Test public void failedRegistrationHasBoundedObservationsWithOneWriteAndOneReset() throws Exception {
        Device device=new Device(); CarrierImsControlTest.FakeOps ims=new CarrierImsControlTest.FakeOps();
        ims.readyAfter=10000;
        assertEquals("ims_not_registered",boot(device,"boot-a",config("carrier_ims"),ims));
        assertEquals(1,device.writes); assertEquals(1,ims.resets);
        assertEquals(AutoApply.MAX_ATTEMPTS*20,ims.reads);
    }
}
