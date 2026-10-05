package io.github.turboims.ksu;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class EngineTest {
    static final String KEY="carrier_volte_available_bool";
    static final CarrierBackend.Subscription SUB=new CarrierBackend.Subscription(17,0);
    static class Fake implements CarrierBackend, Engine.Store {
        final Map<String,Object> values=new LinkedHashMap<>();
        Engine.Snapshot snapshot; int writes,saves,delay; boolean drop, throwBefore, throwAfter, dropMarker;
        Map<String,Object> pending;
        Fake() {
            for (var entry:FeatureConfigTest.config(true,FeatureConfig.Mode.ON).desired().entrySet()) {
                Object v=entry.getValue();
                values.put(entry.getKey(),v instanceof Boolean ? !((boolean)v) :
                        v instanceof int[] ? new int[]{0} : 0);
            }
            values.put(Engine.LOADED,true);
            values.put("unrelated_other_module_key",true);
        }
        public List<Subscription> subscriptions(){return List.of(SUB);}
        public Map<String,Object> read(int id){
            if(pending!=null && --delay<=0){values.putAll(pending);pending=null;}
            return new LinkedHashMap<>(values);
        }
        public void override(int id,Map<String,Object> payload){
            assertNotNull(payload);assertFalse(payload.isEmpty());writes++;
            if(throwBefore) throw new IllegalStateException("injected Binder failure before write");
            Map<String,Object> copy=new LinkedHashMap<>(payload);
            if(drop)copy.remove(KEY);
            if(dropMarker)copy.remove(Engine.MARKER);
            if(delay>0)pending=copy;else values.putAll(copy);
            if(throwAfter) throw new IllegalStateException("injected failure after mutation");
        }
        public Engine.Snapshot load(int id){return snapshot;}
        public void save(int id,Engine.Snapshot s){saves++;snapshot=s;}
        Engine engine(){return engine("boot-a");}
        Engine engine(String session){return new Engine(this,this,session,()->{});}
    }
    static Map<String,Object> on(){return Map.of(KEY,true);}
    @Test public void appliesAndVerifies(){Fake f=new Fake();
        assertRun(f,"verified",on(),true);assertEquals(true,f.values.get(KEY));assertEquals(1,f.writes);}
    @Test public void repeatedApplyIsIdempotent(){Fake f=new Fake();
        assertRun(f,"verified",on(),true);assertRun(f,"unchanged",on(),true);assertEquals(1,f.writes);}
    @Test public void previewDoesNotMutateOrSaveOrClaimAChange() throws Exception {
        Fake f=new Fake();
        Engine.Result result=f.engine().reconcile(SUB,on(),false);
        assertEquals("preview",result.phase);assertFalse(result.changed);
        assertEquals(0,f.writes);assertEquals(0,f.saves);
    }
    @Test public void waitsForLoadedCarrierConfig(){Fake f=new Fake();f.values.put(Engine.LOADED,false);
        assertRun(f,"waiting",on(),true);assertEquals(0,f.writes);assertEquals(0,f.saves);}
    @Test public void restoreOnlyOwnValues(){Fake f=new Fake();assertRun(f,"verified",on(),true);
        assertRun(f,"restored",Map.of(),true);assertEquals(false,f.values.get(KEY));
        assertEquals(true,f.values.get("unrelated_other_module_key"));assertTrue(f.snapshot.owned.isEmpty());}
    @Test public void defaultsDoNotChangeUnownedValues(){Fake f=new Fake();
        assertRun(f,"unchanged",Map.of(),true);assertEquals(0,f.writes);}
    @Test public void existingSameValueIsNotClaimed(){Fake f=new Fake();f.values.put(KEY,true);
        assertRun(f,"unchanged",on(),true);assertNull(f.snapshot);assertEquals(0,f.writes);}
    @Test public void preservesThirdPartyConflicts() throws Exception {Fake f=new Fake();assertRun(f,"verified",on(),true);
        f.values.put(KEY,false);Engine.Result r=f.engine().reconcile(SUB,on(),true);
        assertEquals("conflict",r.phase);assertEquals(List.of(KEY),r.conflicts);assertEquals(1,f.writes);}
    @Test public void restoreDoesNotOverwriteThirdParty(){Fake f=new Fake();assertRun(f,"verified",on(),true);
        f.values.put(KEY,false);assertRun(f,"conflict",Map.of(),true);assertEquals(1,f.writes);}
    @Test public void carrierReloadReacquiresBaseline(){Fake f=new Fake();assertRun(f,"verified",on(),true);
        f.values.remove(Engine.MARKER);f.values.put(KEY,false);
        assertRun(f,"verified",on(),true);assertEquals(false,f.snapshot.baseline.get(KEY));}
    @Test public void carrierReloadWithNativeBaselineDriftReappliesFullOverride() throws Exception {
        Fake f=new Fake();
        String key="carrier_nr_availabilities_int_array";
        Map<String,Object> wanted=Map.of(key,new int[]{1,2});
        assertRun(f,"verified",wanted,true);
        f.values.remove(Engine.MARKER);
        // The carrier reload discarded our non-persistent override and changed its
        // native baseline. No owned module value remains, so it is safe to rebase.
        f.values.put(key,new int[]{1});
        Engine.Result result=f.engine("boot-b").reconcile(SUB,wanted,true);
        assertEquals("verified",result.phase);
        assertArrayEquals(new int[]{1,2},(int[])f.values.get(key));
        assertArrayEquals(new int[]{1},(int[])f.snapshot.baseline.get(key));
    }
    @Test public void foreignMarkerPreventsCarrierReloadRebase() throws Exception {
        Fake f=new Fake();
        String key="carrier_nr_availabilities_int_array";
        Map<String,Object> wanted=Map.of(key,new int[]{1,2});
        assertRun(f,"verified",wanted,true);
        f.values.put(Engine.MARKER,"other-session");
        f.values.put(key,new int[]{1});
        Engine.Result result=f.engine("boot-b").reconcile(SUB,wanted,true);
        assertEquals("ownership_lost",result.phase);
        assertArrayEquals(new int[]{1},(int[])f.values.get(key));
    }
    @Test public void unsupportedKeysAreSkipped() throws Exception {Fake f=new Fake();f.values.remove(KEY);
        Engine.Result r=f.engine().reconcile(SUB,on(),true);assertEquals(List.of(KEY),r.unsupported);
        assertEquals(0,f.writes);}
    @Test public void configurationChangeInSameVersionWorks(){Fake f=new Fake();
        assertRun(f,"verified",on(),true);
        assertRun(f,"verified",Map.of(KEY,false),true);assertEquals(false,f.values.get(KEY));}
    @Test public void arrayReadbackIsVerifiedByContents(){Fake f=new Fake();
        Map<String,Object> wanted=Map.of("carrier_nr_availabilities_int_array",new int[]{1,2});
        assertRun(f,"verified",wanted,true);assertRun(f,"unchanged",wanted,true);}
    @Test public void asyncWritesArePolled(){Fake f=new Fake();f.delay=3;
        assertRun(f,"verified",on(),true);assertEquals(true,f.values.get(KEY));}
    @Test public void failedVerificationKeepsRecoverySnapshot() throws Exception {
        Fake f=new Fake();f.drop=true;
        try{f.engine().reconcile(SUB,on(),true);fail("Should fail verification");}
        catch(IllegalStateException expected){assertNotNull(f.snapshot);
            assertEquals(true,f.snapshot.pending.get(KEY));
            assertTrue(f.snapshot.owned.isEmpty());}
    }
    @Test(expected=IllegalArgumentException.class) public void unknownKeyRejected() throws Exception {
        new Fake().engine().reconcile(SUB,Map.of("unknown_key",true),true);
    }
    @Test public void failedSettingChangeRetainsLastVerifiedOwnership() throws Exception {
        Fake f=new Fake();assertRun(f,"verified",on(),true);f.throwBefore=true;
        try { f.engine().reconcile(SUB,Map.of(KEY,false),true);fail(); }
        catch(IllegalStateException expected) {
            assertEquals(true,f.snapshot.owned.get(KEY));
            assertEquals(false,f.snapshot.pending.get(KEY));
        }
        f.throwBefore=false;
        assertRun(f,"restored",Map.of(),true);
        assertEquals(false,f.values.get(KEY));assertTrue(f.snapshot.pending.isEmpty());
    }
    @Test public void failedFirstWriteCanRetryWithoutInventingConflict() throws Exception {
        Fake f=new Fake();f.throwBefore=true;
        try { f.engine().reconcile(SUB,on(),true);fail(); }
        catch(IllegalStateException expected) { assertTrue(f.snapshot.owned.isEmpty()); }
        f.throwBefore=false;assertRun(f,"verified",on(),true);
        assertEquals(false,f.snapshot.baseline.get(KEY));
    }
    @Test public void partialFirstWriteCanRetryWhenMarkerWasWritten() throws Exception {
        Fake f=new Fake();f.drop=true;
        try { f.engine().reconcile(SUB,on(),true);fail(); }
        catch(IllegalStateException expected) { }
        f.drop=false;assertRun(f,"verified",on(),true);
    }
    @Test public void mutationBeforeExceptionIsRecovered() throws Exception {
        Fake f=new Fake();f.throwAfter=true;
        try { f.engine().reconcile(SUB,on(),true);fail(); }
        catch(IllegalStateException expected) { }
        f.throwAfter=false;assertRun(f,"restored",Map.of(),true);
        assertEquals(false,f.values.get(KEY));assertTrue(f.snapshot.pending.isEmpty());
    }
    @Test public void unknownPendingValueRemainsAConflict() throws Exception {
        Fake f=new Fake();String key="wfc_spn_format_idx_int";
        f.throwAfter=true;
        try { f.engine().reconcile(SUB,Map.of(key,6),true);fail(); }
        catch(IllegalStateException expected) { }
        f.throwAfter=false;f.values.put(key,9);
        assertRun(f,"conflict",Map.of(),true);assertEquals(9,f.values.get(key));
    }
    @Test public void interruptedRestorationCanCompleteWithoutNewWrite() throws Exception {
        Fake f=new Fake();assertRun(f,"verified",on(),true);f.throwAfter=true;
        try { f.engine().reconcile(SUB,Map.of(),true);fail(); }
        catch(IllegalStateException expected) { }
        f.throwAfter=false;int writes=f.writes;assertRun(f,"unchanged",Map.of(),true);
        assertEquals(writes,f.writes);assertTrue(f.snapshot.owned.isEmpty());
        assertTrue(f.snapshot.pending.isEmpty());
    }
    @Test public void lostMarkerDoesNotRebaseOnOurOwnModifiedValue() throws Exception {
        Fake f=new Fake();assertRun(f,"verified",on(),true);f.values.remove(Engine.MARKER);
        int writes=f.writes;assertRun(f,"ownership_lost",Map.of(),true);
        assertEquals(writes,f.writes);assertEquals(false,f.snapshot.baseline.get(KEY));
    }
    @Test public void ownershipSurvivesRebootWhenMarkerMatchesSavedSnapshot() throws Exception {
        Fake f=new Fake();
        assertEquals("verified",f.engine("boot-a").reconcile(SUB,on(),true).phase);
        Engine.Result restored=f.engine("boot-b").reconcile(SUB,Map.of(),true);
        assertEquals("restored",restored.phase);
        assertEquals(false,f.values.get(KEY));
        assertEquals("boot-b",f.values.get(Engine.MARKER));
        assertEquals("boot-b",f.snapshot.session);
    }
    @Test public void missingMarkerAfterRebootDoesNotReclaimModifiedValue() throws Exception {
        Fake f=new Fake();
        assertEquals("verified",f.engine("boot-a").reconcile(SUB,on(),true).phase);
        f.values.remove(Engine.MARKER);
        Engine.Result result=f.engine("boot-b").reconcile(SUB,on(),true);
        assertEquals("ownership_lost",result.phase);
        assertEquals(true,f.values.get(KEY));
    }
    @Test public void mutationWithoutMarkerStopsForManualRecovery() throws Exception {
        Fake f=new Fake();f.dropMarker=true;
        try { f.engine().reconcile(SUB,on(),true);fail(); }
        catch(IllegalStateException expected) { }
        int writes=f.writes;assertRun(f,"ownership_lost",Map.of(),true);
        assertEquals(writes,f.writes);
    }
    @Test public void previewDoesNotResolvePendingSnapshotOnDisk() throws Exception {
        Fake f=new Fake();f.throwAfter=true;
        try { f.engine().reconcile(SUB,on(),true);fail(); }
        catch(IllegalStateException expected) { }
        int saves=f.saves;
        assertRun(f,"preview",Map.of(),false);assertEquals(saves,f.saves);
        assertFalse(f.snapshot.pending.isEmpty());
    }

    private static Engine applying(Fake f, String boot) {
        return new Engine(f, f, boot, () -> {}, true);
    }

    @Test public void bootReappliesSimAndImsWithCoincidentNativeValues() throws Exception {
        Fake f = new Fake();
        String carrier = "carrier_name_string", iso = "sim_country_iso_override_string";
        String nr = "carrier_nr_availabilities_int_array";
        f.values.put(carrier, "original carrier");
        f.values.put(iso, "");
        f.values.put(nr, new int[]{1});
        Map<String,Object> wanted = new LinkedHashMap<>();
        wanted.put(KEY, true);
        wanted.put(nr, new int[]{1,2});
        wanted.put(carrier, "Chunghwa Telecom");
        wanted.put(iso, "tw");
        assertEquals("verified", applying(f, "boot-a").reconcile(SUB, wanted, true).phase);
        // Reboot drops the marker. Native carrier data changed and VoLTE happens
        // to equal our last requested value: equality is not retained ownership.
        f.values.remove(Engine.MARKER);
        f.values.put(KEY, true);
        f.values.put(nr, new int[]{1});
        f.values.put(carrier, "中華電信");
        f.values.put(iso, "");
        Engine.Result result = applying(f, "boot-b").reconcile(SUB, wanted, true);
        assertEquals("verified", result.phase);
        assertTrue(result.conflicts.isEmpty());
        assertEquals("Chunghwa Telecom", f.values.get(carrier));
        assertEquals("tw", f.values.get(iso));
        assertArrayEquals(new int[]{1,2}, (int[])f.values.get(nr));
        assertEquals("中華電信", f.snapshot.baseline.get(carrier));
        assertEquals(true, f.snapshot.baseline.get(KEY));
        // A further reboot also reacquires a fresh baseline.
        f.values.remove(Engine.MARKER);
        f.values.put(carrier, "中華電信");
        f.values.put(iso, "");
        assertEquals("verified", applying(f, "boot-c").reconcile(SUB, wanted, true).phase);
        assertEquals("tw", f.values.get(iso));
    }

    @Test public void bootDoesNotUseArrayCoincidenceAsOwnershipEvidence() throws Exception {
        Fake f = new Fake();
        String nr = "carrier_nr_availabilities_int_array", carrier = "carrier_name_string";
        f.values.put(carrier, "native");
        Map<String,Object> wanted = Map.of(nr, new int[]{1,2}, carrier, "Chunghwa Telecom");
        applying(f, "boot-a").reconcile(SUB, wanted, true);
        f.values.remove(Engine.MARKER);
        f.values.put(nr, new int[]{1,2});
        f.values.put(carrier, "中華電信");
        assertEquals("verified", applying(f, "boot-b").reconcile(SUB, wanted, true).phase);
        assertEquals("Chunghwa Telecom", f.values.get(carrier));
    }

    @Test public void bootApplyStillRejectsForeignMarkerAtOldBaseline() throws Exception {
        Fake f = new Fake();
        applying(f, "boot-a").reconcile(SUB, on(), true);
        f.values.put(KEY, false);
        f.values.put(Engine.MARKER, "foreign-owner");
        int writes = f.writes;
        assertEquals("ownership_lost", applying(f, "boot-b").reconcile(SUB, on(), true).phase);
        assertEquals(writes, f.writes);
    }

    @Test public void bootApplyRejectsForeignMarkerWithoutSnapshot() throws Exception {
        Fake f = new Fake();
        f.values.put(Engine.MARKER, "foreign-owner");
        assertEquals("ownership_lost", applying(f, "boot-b").reconcile(SUB, on(), true).phase);
        assertEquals(0, f.writes);
        assertNull(f.snapshot);
    }

    @Test public void bootApplyDoesNotDiscardInterruptedMarkerlessWrite() throws Exception {
        Fake f = new Fake();
        f.dropMarker = true;
        try { applying(f, "boot-a").reconcile(SUB, on(), true); fail(); }
        catch (Engine.VerificationException expected) { }
        int writes = f.writes;
        assertEquals("ownership_lost", applying(f, "boot-b").reconcile(SUB, on(), true).phase);
        assertEquals(writes, f.writes);
        assertFalse(f.snapshot.pending.isEmpty());
    }

    @Test public void recoveryContextCannotRestoreUnownedCoincidentValues() throws Exception {
        Fake f = new Fake();
        applying(f, "boot-a").reconcile(SUB, on(), true);
        f.values.remove(Engine.MARKER);
        int writes = f.writes;
        assertEquals("ownership_lost", applying(f, "boot-b").reconcile(SUB, Map.of(), true).phase);
        assertEquals(writes, f.writes);
    }

    @Test public void bootRebasePreviewPreservesSnapshotAndState() throws Exception {
        Fake f = new Fake();
        applying(f, "boot-a").reconcile(SUB, on(), true);
        f.values.remove(Engine.MARKER);
        Engine.Snapshot before = f.snapshot;
        int writes = f.writes, saves = f.saves;
        assertEquals("preview", applying(f, "boot-b").reconcile(SUB, on(), false).phase);
        assertSame(before, f.snapshot);
        assertEquals(writes, f.writes);
        assertEquals(saves, f.saves);
    }

    @Test public void sameMarkerConflictsStayBlockedDuringBootRecovery() throws Exception {
        Fake f = new Fake();
        applying(f, "boot-a").reconcile(SUB, on(), true);
        f.values.put(KEY, false);
        int writes = f.writes;
        assertEquals("conflict", applying(f, "boot-b").reconcile(SUB, on(), true).phase);
        assertEquals(writes, f.writes);
    }


    @Test public void finalReadbackDetectsPostResetLossOfSimFields() {
        Map<String,Object> requested = Map.of("carrier_name_string", "Chunghwa Telecom",
                "sim_country_iso_override_string", "tw");
        Map<String,Object> current = new LinkedHashMap<>(requested);
        current.put(Engine.LOADED, true);
        current.put(Engine.MARKER, "boot-a");
        assertEquals("verified", Engine.readbackPhase(current, requested));
        current.remove(Engine.MARKER);
        current.put("carrier_name_string", "中華電信");
        current.put("sim_country_iso_override_string", "");
        assertEquals("carrier_config_reloaded", Engine.readbackPhase(current, requested));
        current.put(Engine.MARKER, "boot-a");
        assertEquals("verification_failed", Engine.readbackPhase(current, requested));
        current.put(Engine.LOADED, false);
        assertEquals("carrier_config_reloaded", Engine.readbackPhase(current, requested));
    }

    @Test public void finalReadbackComparesArrayContents() {
        Map<String,Object> current = new LinkedHashMap<>();
        current.put(Engine.LOADED, true);
        current.put(Engine.MARKER, "boot-a");
        current.put("carrier_nr_availabilities_int_array", new int[]{1,2});
        assertEquals("verified", Engine.readbackPhase(current,
                Map.of("carrier_nr_availabilities_int_array", new int[]{1,2})));
        assertEquals("verification_failed", Engine.readbackPhase(current,
                Map.of("carrier_nr_availabilities_int_array", new int[]{1})));
    }

    private static void assertRun(Fake fake,String phase,Map<String,Object> desired,boolean write){
        try{assertEquals(phase,fake.engine().reconcile(SUB,desired,write).phase);}
        catch(Exception e){throw new AssertionError(e);}
    }

    @Test public void crossBootFailureBeforeMutationKeepsOldOwnerAndBaseline() throws Exception {
        Fake f = new Fake();
        applying(f, "boot-a").reconcile(SUB, on(), true);
        f.throwBefore = true;
        try { applying(f, "boot-b").reconcile(SUB, Map.of(KEY, false), true); fail(); }
        catch (IllegalStateException expected) { }
        assertEquals("boot-a", f.snapshot.session);
        assertEquals("boot-b", f.snapshot.pendingSession);
        assertEquals("boot-a", f.values.get(Engine.MARKER));
        f.throwBefore = false;
        assertEquals("restored", applying(f, "boot-b").reconcile(SUB, Map.of(), true).phase);
        assertEquals(false, f.values.get(KEY));
        assertTrue(f.snapshot.pending.isEmpty());
    }

    @Test public void crossBootFailureAfterMutationRecognizesNewPendingOwner() throws Exception {
        Fake f = new Fake();
        applying(f, "boot-a").reconcile(SUB, on(), true);
        f.throwAfter = true;
        try { applying(f, "boot-b").reconcile(SUB, Map.of(KEY, false), true); fail(); }
        catch (IllegalStateException expected) { }
        assertEquals("boot-a", f.snapshot.session);
        assertEquals("boot-b", f.snapshot.pendingSession);
        assertEquals("boot-b", f.values.get(Engine.MARKER));
        f.throwAfter = false;
        assertEquals("unchanged", applying(f, "boot-b").reconcile(SUB, Map.of(), true).phase);
        assertEquals("boot-b", f.snapshot.session);
        assertTrue(f.snapshot.owned.isEmpty());
        assertTrue(f.snapshot.pending.isEmpty());
    }

    @Test public void simRefreshRepublishesOnlyRequestedSimKeysEvenWhenEqual() throws Exception {
        Fake f = new Fake();
        String iso = "sim_country_iso_override_string", carrier = "carrier_name_string";
        f.values.put(iso, "tw"); f.values.put(carrier, "Chunghwa Telecom");
        Map<String,Object> desired = Map.of(iso, "tw", carrier, "Chunghwa Telecom");
        assertEquals("unchanged", applying(f, "boot-a").reconcile(SUB, desired, true).phase);
        assertEquals(0, f.writes);
        assertEquals("verified", applying(f, "boot-a").reconcile(SUB, desired, true, true).phase);
        assertEquals(1, f.writes);
        assertEquals("tw", f.snapshot.baseline.get(iso));
        assertFalse(f.snapshot.owned.containsKey(KEY));
        assertEquals(true, f.values.get("unrelated_other_module_key"));
    }

    @Test public void simRefreshDoesNotBypassConflictOrReadOnlyChecks() throws Exception {
        Fake f = new Fake();
        String carrier = "carrier_name_string";
        f.values.put(carrier, "native");
        Map<String,Object> desired = Map.of(carrier, "Chunghwa Telecom");
        applying(f, "boot-a").reconcile(SUB, desired, true);
        int writes = f.writes, saves = f.saves;
        applying(f, "boot-a").reconcile(SUB, desired, false, true);
        assertEquals(writes, f.writes); assertEquals(saves, f.saves);
        f.values.put(carrier, "someone else");
        assertEquals("conflict", applying(f, "boot-a").reconcile(SUB, desired, true, true).phase);
        assertEquals(writes, f.writes);
    }

    @Test public void publicSimReadbackMustMatchIsoAndExactCarrierName() {
        Map<String,Object> desired = Map.of("sim_country_iso_override_string", "tw",
                "carrier_name_string", "Chunghwa Telecom");
        assertTrue(Engine.simIdentityMatches(
                Map.of("country_iso", "TW", "carrier_name", "Chunghwa Telecom"), desired));
        assertFalse(Engine.simIdentityMatches(
                Map.of("country_iso", "", "carrier_name", "中華電信"), desired));
        assertFalse(Engine.simIdentityMatches(
                Map.of("country_iso", "TW", "carrier_name", "中華電信"), desired));
        assertTrue(Engine.simIdentityMatches(Map.of(), Map.of(KEY, true)));
    }

}
