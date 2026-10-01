package io.github.turboims.ksu;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class EngineTest {
    static final String KEY="carrier_volte_available_bool";
    static final CarrierBackend.Subscription SUB=new CarrierBackend.Subscription(17,0);
    static class Fake implements CarrierBackend, Engine.Store {
        final Map<String,Object> values=new LinkedHashMap<>();
        Engine.Snapshot snapshot; int writes,saves,delay; boolean drop;
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
            Map<String,Object> copy=new LinkedHashMap<>(payload);
            if(drop)copy.remove(KEY);
            if(delay>0)pending=copy;else values.putAll(copy);
        }
        public Engine.Snapshot load(int id){return snapshot;}
        public void save(int id,Engine.Snapshot s){saves++;snapshot=s;}
        Engine engine(){return new Engine(this,this,"boot-a",()->{});}
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
            assertEquals(true,f.snapshot.owned.get(KEY));}
    }
    @Test(expected=IllegalArgumentException.class) public void unknownKeyRejected() throws Exception {
        new Fake().engine().reconcile(SUB,Map.of("unknown_key",true),true);
    }
    private static void assertRun(Fake fake,String phase,Map<String,Object> desired,boolean write){
        try{assertEquals(phase,fake.engine().reconcile(SUB,desired,write).phase);}
        catch(Exception e){throw new AssertionError(e);}
    }
}
