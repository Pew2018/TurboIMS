# 0.3.4: saving settings during boot registration observation

## Confirmed device evidence

The 0.3.3 husky / SDK 36 export for boot `19616b89-8215-4354-aee0-c573189e61da` still contains `implementation_mode: carrier_ims`. The attempt to change mode logged `action=save ERROR Another runner operation is busy`. Each boot attempt held `operation.lock` through about 19 seconds of registration polling and 2 seconds of final readback; save previously timed out on that lock after 10 seconds.

CarrierConfig values, current boot ownership marker, and visible SIM profile all matched the requested settings. The final `verification_mismatches` was empty and both verification flags were true. IMS registration remained false. This evidence establishes a save/operation lock conflict; it does not establish why the network has not registered IMS. TurboIMS mode had not been saved or tested in that export.

## Changes

- Save uses a short configuration lock, separately from serialized telephony operations.
- Each operation parses the same immutable configuration bytes used to calculate its revision.
- Saving a changed configuration cancels old registration polling and settling waits cooperatively. Already-issued Binder calls finish under the operation lock.
- Status and blocked-result publication checks the current configuration revision while holding the configuration lock, preventing an old task from publishing over a new save.
- A changed configuration gets a new IMS reset budget. Retries of the same configuration still issue at most one accepted reset per subscription.
- After CarrierConfig, test identity operation, and visible SIM profile verification succeed, the automatic task completes even when the bounded observation reports IMS unregistered. It retains `ok: false`, `phase: ims_not_registered`, and `registered: false`, with a separate `configuration_applied: true` field.
- Actual framework readiness, reload, and SIM profile pending states remain bounded retries; ownership conflicts and verification errors remain terminal.
- Manual operations allow up to 60 seconds to obtain the operation lock when the saved configuration is unchanged.

The default implementation mode and requested feature/profile values are unchanged. No attempt is made to infer registration from SIM labels, Maps access, or an accepted Binder call.

## Validation

Host tests cover saving TurboIMS mode while a real operation file lock is held, cancellation after an IMS reset, refusing stale result publication and stale reset, operation serialization, reset budgets across revisions, boot completion without claiming registration, and configuration/SIM reapplication across two simulated boots in both modes. WebUI tests retain warning status and display registration false separately from applied settings. Android SDK 36/37 build and downloaded installer smoke checks run in GitHub Actions.

Device acceptance still requires saving and applying TurboIMS mode, checking `config.implementation_mode`, rebooting without manual apply, and testing calls plus the reported Maps behavior. Registration failure in Carrier IMS mode remains unresolved without device/network evidence.
