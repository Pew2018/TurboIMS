# Stable #193 Carrier IMS lifecycle recovery

Baseline: Actions #193, d58b38c151964d7a4818f995cbd7c8d72a5382f8.
Preserves its WebUI, feature policy, Binder signatures and nonpersistent writes.

## Evidence and regression
The supplied SDK 36 diagnostic reports ownership_lost, empty sim_country_iso_override_string,
carrier_name_string=中華電信, followed by carrier_config_not_ready without an IMS reset.
The record's Binder acceptance is not an effective identity read-back and IMS registration was not queried.
This establishes a configuration-blocking failure, not proof of the modem's registration or Google's gating rules.
#196 moved carrier test identity before CarrierConfig; #193 and the reference ImsModifier apply CarrierConfig first.
A native reload can retain values coincidentally equal to earlier overrides. Treating every equal value as proof
of foreign ownership blocks boot configuration indefinitely.

## Changes
- Restore #193's configuration-before-test-identity order.
- Settle identity reloads for five seconds, reconcile the selected bundle again, then reset IMS.
- Reapply a marker-free nonpersistent bundle on a new boot or during this operation's identity/IMS reload.
- Keep original restoration baselines for values equal to the old module-owned values.
- Block foreign markers and uncertain pending transactions; restore alone does not grant boot recovery authority.
- Verify the entire requested bundle on writes; reassert a lost marker even when desired values already match.
- After IMS reset, require eight unchanged samples (two seconds) within a bounded reconciliation window,
  then query registration again without repeated reset.
- Skip reset for an already registered, unchanged subscription with no identity operation.
- Retain one-shot boot completion. Worker exit does not restore settings; periodic checks remain opt-in.
- SDK 36/37 builds and downloadable installer smoke checks remain in GitHub Actions.

## Device acceptance (not established by CI)
Install this branch's SDK 36 module and reboot; do not delete state/config snapshots.
With no SIM profile, verify outgoing/incoming calls immediately and again after at least 10 minutes.
With the Taiwan/Chunghwa profile saved and applied, verify country=TW, English carrier name,
outgoing/incoming calls and Google Maps reviews. Reboot and repeat without opening WebUI first.
Export diagnostics on failure, including version, current status and final_carrier_config_verified.
CI cannot prove real calls, network persistence, or Google Maps behavior.
