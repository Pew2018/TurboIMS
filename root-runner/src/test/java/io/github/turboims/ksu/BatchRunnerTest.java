package io.github.turboims.ksu;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class BatchRunnerTest {
    static final String KEY=EngineTest.KEY;
    static final CarrierBackend.Subscription FIRST=new CarrierBackend.Subscription(17,0);
    static final CarrierBackend.Subscription SECOND=new CarrierBackend.Subscription(41,1);
    static class Fake extends EngineTest.Fake {
        final EngineTest.Fake second=new EngineTest.Fake();
        int failedId=-1;
        @Override public Map<String,Object> read(int id) {
            if(id==failedId) throw new SecurityException("injected per-SIM failure");
            return id==SECOND.id ? second.read(id) : super.read(id);
        }
        @Override public void override(int id,Map<String,Object> values) {
            if(id==SECOND.id) second.override(id,values);else super.override(id,values);
        }
        @Override public Engine.Snapshot load(int id) {
            return id==SECOND.id ? second.snapshot : snapshot;
        }
        @Override public void save(int id,Engine.Snapshot value) {
            if(id==SECOND.id) second.save(id,value);else super.save(id,value);
        }
        BatchRunner.Report run(boolean preview) {
            return BatchRunner.run(List.of(FIRST,SECOND),
                    FeatureConfigTest.config(true,FeatureConfig.Mode.ON),engine(),preview,false);
        }
    }
    @Test public void matchingConfigurationIsReadButNeverRewritten() {
        Fake f = new Fake();
        assertTrue(f.run(false).changed);
        BatchRunner.Report repeat = f.run(false);
        assertFalse(repeat.changed);
        assertTrue(repeat.verified);
        assertEquals(1, f.writes);
        assertEquals(1, f.second.writes);
    }
    @Test public void firstSimFailureDoesNotPreventSecondSimApply() {
        Fake f=new Fake();f.failedId=FIRST.id;BatchRunner.Report r=f.run(false);
        assertFalse(r.ok);assertEquals("error",r.phase);assertTrue(r.requiresManualRetry);
        assertEquals(2,r.entries.size());assertNotNull(r.entries.get(0).error);
        assertEquals("verified",r.entries.get(1).result.phase);
        assertTrue(r.changed);assertTrue(r.verified);assertEquals(1,f.second.writes);
    }
    @Test public void secondSimFailurePreservesFirstSimResult() {
        Fake f=new Fake();f.failedId=SECOND.id;BatchRunner.Report r=f.run(false);
        assertEquals("verified",r.entries.get(0).result.phase);
        assertNotNull(r.entries.get(1).error);assertEquals(1,f.writes);
    }
    @Test public void unsupportedKeysCannotReportCompleteSuccess() {
        Fake f=new Fake();f.values.remove(KEY);BatchRunner.Report r=f.run(false);
        assertFalse(r.ok);assertEquals("partial",r.phase);assertFalse(r.requiresManualRetry);
        assertTrue(r.entries.get(0).result.unsupported.contains(KEY));
    }
    @Test public void waitingSimDoesNotHideAppliedSim() {
        Fake f=new Fake();f.values.put(Engine.LOADED,false);BatchRunner.Report r=f.run(false);
        assertFalse(r.ok);assertEquals("waiting",r.phase);assertTrue(r.changed);
        assertEquals("verified",r.entries.get(1).result.phase);
    }
    @Test public void probeReportsErrorsWithoutMutations() {
        Fake f=new Fake();f.failedId=FIRST.id;BatchRunner.Report r=f.run(true);
        assertFalse(r.ok);assertEquals("error",r.phase);
        assertEquals(0,f.writes);assertEquals(0,f.second.writes);assertEquals(0,f.second.saves);
    }
    @Test public void noActiveSimWhileEnabledIsWaiting() {
        Fake f=new Fake();BatchRunner.Report r=BatchRunner.run(List.of(),
                FeatureConfigTest.config(true,FeatureConfig.Mode.ON),f.engine(),false,false);
        assertFalse(r.ok);assertEquals("waiting",r.phase);
    }
    @Test public void lostOwnershipIsExplicitAndStopsAutomaticWrites() {
        Fake f=new Fake();f.run(false);f.values.remove(Engine.MARKER);
        BatchRunner.Report r=f.run(false);
        assertFalse(r.ok);assertEquals("ownership_lost",r.phase);assertTrue(r.requiresManualRetry);
    }
}
