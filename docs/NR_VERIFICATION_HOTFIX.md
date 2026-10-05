# 0.3.6 NR verification and independent IMS/SIM results

## Device evidence

On 2026-10-05 the user confirmed 0.3.5 boot application, outgoing and incoming calls, and two-way audio work on husky / SDK 36 / KernelSU Next 3.3.0 / China Unicom. The live framework dump exposes Voice:true, UT:true and SMS:true. Video:false is retained as a limitation; the module does not claim all IMS features are available.

The actual SIM and subscription remain 46009; the display remains TW / Chunghwa Telecom, with carrier_test_enabled=false. The first boot task and a later read-only probe in the same boot both report registered=true and NR availability [1], despite the requested [1,2].

The 0.3.5 engine, final readback, registration summary and visible SIM summary incorrectly used a single combined success criterion. A single NR difference produced verification_failed/blocked.json and suppressed successful component verification. Read-only probes intentionally did not claim continuous registration verification, but that distinction was not explicit.

## Audit result and boundary

The module uses putIntArray to publish int[] through overrideConfig(...,false); it reads the returned PersistableBundle value without array transformation. FeatureConfig requests [1,2]. No module-side clipping to [1] was found.

AOSP CarrierConfigManager defines 1 as NSA and 2 as SA. AOSP CarrierConfigLoader merges nonpersistent overrides and copies subset values. This does not identify the cause of this particular Pixel build's [1] readback. A partial configuration warning does not assert modem, carrier or vendor normalization, and is not proof of actual 5G service or SA registration.

Primary sources:
- https://android.googlesource.com/platform/frameworks/base/+/HEAD/telephony/java/android/telephony/CarrierConfigManager.java
- https://android.googlesource.com/platform/packages/services/Telephony/+/master/src/com/android/phone/CarrierConfigLoader.java

## Behavior

- Only an enable-both NR request [1,2] read back as a valid nonempty single mode [1] or [2] qualifies as a limited request. Full configuration equality is still false.
- A loaded bundle and matching non-null verified owner marker are required. All other requested values must match. Missing/empty/invalid arrays, a disabled NR request, changed signal thresholds, IMS values, SIM values or owner marker retain strict failure handling.
- Initial write verification requires three consecutive acceptable partial samples before accepting this limited result. Full exact readback remains the usual success path.
- Original requested ownership and pre-write baseline remain stored. The limited readback is not promoted to a fabricated native baseline. Retry/manual/periodic reconciliation does not repeatedly overwrite that NR value for the unchanged owned request.
- Restore releases a limited NR claim without writing only when the current value already equals the recorded original baseline. Otherwise it preserves the conflict.
- A bounded boot task can continue observing late IMS registration with partial NR; a warning cannot override registration waiting, another SIM's error, or SIM-display readiness. Carrier IMS keeps at most one accepted reset per subscription per task. TurboIMS never resets IMS.
- Once registration and the other checks complete, configured_partial is an operational completion with a visible NR warning, not a complete configuration verification. It does not create blocked.json. Its ok=true means the task completed with the documented warning.
- configuration_applied and write_readback_verified remain false when the full request is not fulfilled. configuration_partial=true and verification_mismatches preserve the limitation.
- ims_configuration_verified, sim_profiles_verified and nr_configuration_verified describe their own component. sim_properties are read even when the NR check is partial.
- ims_registration_verified only describes completed continuous registration observation; it no longer depends on unrelated NR equality. A read-only probe instead returns ims_registration_state=observed_registered when its single sample is registered, with ims_registration_verified=false.
- The UI shows independent configuration rows plus the exact requested and observed NR arrays. It does not claim voice calling, video calling or Maps availability based only on registration.

## Validation and device acceptance

Remote CI covers immediate and later NR reduction, strict errors, owner mismatch, restoration, dual-SIM error precedence, no repeated write/reset during registration retries, both modes across two reboots, and registered read-only WebUI presentation.

Install 0.3.6 and reboot. Keep the currently working identity settings, particularly carrier_test_enabled=false. Before any manual apply, check:
1. IMS is registered and the boot task has completed.
2. IMS/SIM component results pass; an unchanged [1] NR readback is a partial warning with the exact difference, not a red overall verification failure.
3. No blocked.json is created solely for the NR limitation; no repeated NR write or IMS reset is logged.
4. Outgoing/incoming calls connect with two-way audio; country/name stay configured.
5. A second reboot preserves those results. Test TurboIMS separately if switching paths; only Carrier IMS has current real-device calling evidence.
6. Verify Maps comments separately; display verification is not application-level validation.

The immutable 0.3.5 backup remains archive/release-0.3.5-device-verified. This hotfix does not change master or that backup.
