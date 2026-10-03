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
    private static void assertRun(Fake fake,String phase,Map<String,Object> desired,boolean write){
        try{assertEquals(phase,fake.engine().reconcile(SUB,desired,write).phase);}
        catch(Exception e){throw new AssertionError(e);}
    }
}
