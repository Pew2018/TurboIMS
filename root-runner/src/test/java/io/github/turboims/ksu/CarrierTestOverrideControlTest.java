package io.github.turboims.ksu;

import org.junit.Test;
import java.lang.reflect.Method;
import static org.junit.Assert.*;

public class CarrierTestOverrideControlTest {
    private interface ModernTelephony {
        void setCarrierTestOverride(int subId, String mccmnc, String imsi, String iccid,
                String gid1, String gid2, String plmn, String spn,
                String carrierPrivilegeRules, String apn);
    }

    private interface LegacyTelephony {
        void setCarrierTestOverride(int subId, String mccmnc, String imsi, String iccid,
                String gid1, String gid2, String plmn, String spn,
                int[] carrierIds, int[] specificCarrierIds);
    }

    private interface UnsupportedTelephony {
        void setCarrierTestOverride(int subId, String mccmnc, String imsi, String iccid,
                String gid1, String gid2, String plmn, String spn,
                String carrierPrivilegeRules, int apn);
    }

    @Test public void matchesCurrentStringSignature() throws Exception {
        Method method = ModernTelephony.class.getMethod("setCarrierTestOverride",
                int.class, String.class, String.class, String.class, String.class,
                String.class, String.class, String.class, String.class, String.class);
        assertTrue(CarrierTestOverrideControl.supportsCarrierTestOverrideSignature(method));
    }

    @Test public void preservesLegacyArraySignatureCompatibility() throws Exception {
        Method method = LegacyTelephony.class.getMethod("setCarrierTestOverride",
                int.class, String.class, String.class, String.class, String.class,
                String.class, String.class, String.class, int[].class, int[].class);
        assertTrue(CarrierTestOverrideControl.supportsCarrierTestOverrideSignature(method));
    }

    @Test public void acceptsOnlyWellFormedCarrierTestMccMnc() {
        assertTrue(CarrierTestOverrideControl.isValidMccMnc("46692"));
        assertTrue(CarrierTestOverrideControl.isValidMccMnc("310260"));
        assertFalse(CarrierTestOverrideControl.isValidMccMnc(""));
        assertFalse(CarrierTestOverrideControl.isValidMccMnc("4669"));
        assertFalse(CarrierTestOverrideControl.isValidMccMnc("46A92"));
    }

    @Test public void resolvesStringMccAndMncWithoutDroppingLeadingZeroes() {
        assertEquals("46607", AndroidCarrierBackend.normalizeMccMnc("466", "07"));
        assertEquals("310260", AndroidCarrierBackend.normalizeMccMnc("310", "260"));
        assertEquals("", AndroidCarrierBackend.normalizeMccMnc("46", "92"));
        assertEquals("", AndroidCarrierBackend.normalizeMccMnc("466", "9"));
    }

    @Test public void rejectsUnrelatedOverload() throws Exception {
        Method method = UnsupportedTelephony.class.getMethod("setCarrierTestOverride",
                int.class, String.class, String.class, String.class, String.class,
                String.class, String.class, String.class, String.class, int.class);
        assertFalse(CarrierTestOverrideControl.supportsCarrierTestOverrideSignature(method));
    }

    @Test public void savedRecordNeedsMatchingObservedNumericToSkipBinderApply() {
        assertTrue(CarrierTestOverrideControl.canReuse("46692", "46692", "boot-a", "boot-a", "46692"));
        assertFalse(CarrierTestOverrideControl.canReuse("46692", "46692", "boot-a", "boot-a", ""));
        assertFalse(CarrierTestOverrideControl.canReuse("46692", "46692", "boot-a", "boot-a", "46001"));
        assertFalse(CarrierTestOverrideControl.canReuse("46692", "46692", "boot-b", "boot-a", "46692"));
    }

    public static class FakePhone {
        final java.util.List<Object[]> writes = new java.util.ArrayList<>();
        int clears, failures;
        public void setCarrierTestOverride(int subId, String code, String imsi, String iccid,
                String gid1, String gid2, String pnn, String spn, String privileges, String apn) {
            writes.add(new Object[]{subId, code, imsi, iccid, gid1, gid2, pnn, spn, privileges, apn});
            if (failures-- > 0) throw new IllegalStateException("injected write failure");
        }
        public void clearCarrierTestOverride(int subId) { clears++; }
    }
    static class MemoryRecords implements CarrierTestOverrideControl.RecordStore {
        final java.util.Map<Integer, java.util.Map<String,Object>> data = new java.util.HashMap<>();
        public java.util.Map<String,Object> read(int subId) { return data.get(subId); }
        public void write(int subId, java.util.Map<String,Object> record) {
            data.put(subId, new java.util.LinkedHashMap<>(record));
        }
        public void delete(int subId) { data.remove(subId); }
    }
    static java.util.Map<String,Object> legacy(String boot, String phase) {
        return new java.util.LinkedHashMap<>(java.util.Map.of("owner","turboims-next","sub_id",1,
                "slot",0,"mccmnc","46692","session",boot,"phase",phase));
    }
    static CarrierTestOverrideControl control(FakePhone phone, MemoryRecords records, boolean clear) {
        Method set = java.util.Arrays.stream(FakePhone.class.getMethods())
                .filter(CarrierTestOverrideControl::supportsCarrierTestOverrideSignature).findFirst().get();
        try {
            return new CarrierTestOverrideControl(phone, set,
                    clear ? FakePhone.class.getMethod("clearCarrierTestOverride",int.class) : null,
                    "boot-a", records);
        } catch (Exception error) { throw new AssertionError(error); }
    }
    static void nativeOptionalFields(Object[] call) {
        assertEquals(10,call.length);
        for (int i=2;i<10;i++) assertNull("Optional identity argument "+i,call[i]);
    }
    @Test public void plmnOverridePreservesAllOptionalNativeIdentityFields() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        control(phone,records,false).apply(1,0,"46692","46009","46009");
        assertEquals(1,phone.writes.size()); nativeOptionalFields(phone.writes.get(0));
        assertEquals(1,phone.writes.get(0)[0]); assertEquals("46692",phone.writes.get(0)[1]);
        assertEquals("46009",records.read(1).get("native_mccmnc"));
    }
    @Test public void legacySameBootRecordCannotSkipCorrectedCallOrInventNativeBaseline() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        records.data.put(1,legacy("boot-a","applied"));
        assertEquals("binder_accepted",control(phone,records,false)
                .apply(1,0,"46692","46692","46692").get("phase"));
        assertEquals(1,phone.writes.size()); nativeOptionalFields(phone.writes.get(0));
        assertEquals(2,records.read(1).get("identity_schema"));
        assertEquals("",records.read(1).get("native_mccmnc"));
    }
    @Test public void correctedOwnedIdentityIsNotWrittenAgain() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        CarrierTestOverrideControl control=control(phone,records,false);
        control.apply(1,0,"46692","46009","46009");
        java.util.Map<String,Object> result=control.apply(1,0,"46692","46692","46692");
        assertEquals("already_owned",result.get("phase"));
        assertEquals(false,result.get("binder_accepted")); assertEquals(1,phone.writes.size());
    }
    @Test public void clearUsesPreWriteBaselineEvenWhenLiveSubscriptionIsContaminated() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        CarrierTestOverrideControl control=control(phone,records,false);
        control.apply(1,0,"46692","46009","46009");
        assertEquals("restored_native_identity_fallback",control.clearOwned(1,0,"46692").get("phase"));
        assertEquals("46009",phone.writes.get(1)[1]); nativeOptionalFields(phone.writes.get(1));
        assertEquals("already_restored_native_identity",control.clearOwned(1,0,"46009").get("phase"));
        assertEquals(2,phone.writes.size());
    }
    @Test public void legacyClearWithoutBaselineRequiresRebootAndDoesNotGuess() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        records.data.put(1,legacy("boot-a","restored_fallback"));
        try { control(phone,records,false).clearOwned(1,0,"46692"); fail("Guessed a native PLMN"); }
        catch (CarrierTestOverrideControl.CleanupRequiresReboot expected) { }
        assertTrue(phone.writes.isEmpty()); assertNotNull(records.read(1));
    }
    @Test public void previousBootRecordExpiresWithoutMutatingCurrentSim() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        records.data.put(1,legacy("boot-old","uncertain"));
        assertEquals("expired_boot_record",control(phone,records,false).clearOwned(1,0,"46009").get("phase"));
        assertNull(records.read(1)); assertTrue(phone.writes.isEmpty()); assertEquals(0,phone.clears);
    }
    @Test public void previousBootApplyCapturesFreshIdentityAndDoesNotRollbackToStalePlmn() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        records.data.put(1,legacy("boot-old","applied"));
        control(phone,records,false).apply(1,0,"46601","46009","46009");
        assertEquals("46009",records.read(1).get("native_mccmnc")); assertEquals(1,phone.writes.size());
    }
    @Test public void mismatchingPreWriteSourcesCannotSupplyRestoreIdentity() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        CarrierTestOverrideControl control=control(phone,records,false);
        control.apply(1,0,"46692","46692","46009");
        try { control.clearOwned(1,0,"46692"); fail("Untrusted baseline accepted"); }
        catch (CarrierTestOverrideControl.CleanupRequiresReboot expected) { }
        assertEquals("",records.read(1).get("native_mccmnc")); assertEquals(1,phone.writes.size());
    }
    @Test public void realClearApiCanCleanLegacyOwnedRecord() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        records.data.put(1,legacy("boot-a","applied"));
        assertEquals("cleared_owned",control(phone,records,true).clearOwned(1,0,"46692").get("phase"));
        assertEquals(1,phone.clears); assertTrue(phone.writes.isEmpty()); assertNull(records.read(1));
    }
    @Test public void failedUpdateRollbackStillPreservesNativeOptionalIdentities() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        CarrierTestOverrideControl control=control(phone,records,false);
        control.apply(1,0,"46692","46009","46009"); phone.failures=1;
        try { control.apply(1,0,"46601","46692","46692"); fail("Failure hidden"); }
        catch (IllegalStateException expected) { }
        assertEquals(3,phone.writes.size()); nativeOptionalFields(phone.writes.get(1));
        nativeOptionalFields(phone.writes.get(2)); assertEquals("46692",phone.writes.get(2)[1]);
        assertEquals("46009",records.read(1).get("native_mccmnc"));
    }
    @Test public void slotsKeepIndependentNativeBaselines() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        CarrierTestOverrideControl control=control(phone,records,false);
        control.apply(1,0,"46692","46009","46009");
        control.apply(2,1,"46601","46011","46011");
        control.clearOwned(2,1,"46601");
        assertEquals(2,phone.writes.get(2)[0]); assertEquals("46011",phone.writes.get(2)[1]);
        assertEquals("applied",records.read(1).get("phase"));
    }
    @Test public void wrongOwnerOrSlotCannotAuthorizeClear() throws Exception {
        for (boolean wrongOwner : new boolean[]{false,true}) {
            FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
            java.util.Map<String,Object> saved=legacy("boot-a","applied");
            if (wrongOwner) saved.put("owner","another-module"); else saved.put("slot",1);
            records.data.put(1,saved);
            try { control(phone,records,true).clearOwned(1,0,"46692"); fail("Ownership bypassed"); }
            catch (IllegalStateException expected) { }
            assertTrue(phone.writes.isEmpty()); assertEquals(0,phone.clears);
        }
    }
    @Test public void expiredBootRecordDoesNotBlockSimMovedToAnotherSlot() throws Exception {
        FakePhone phone=new FakePhone(); MemoryRecords records=new MemoryRecords();
        records.data.put(1,legacy("boot-old","applied"));
        assertEquals("expired_boot_record",control(phone,records,false).clearOwned(1,1,"46009").get("phase"));
        assertTrue(phone.writes.isEmpty()); assertNull(records.read(1));
    }
}
