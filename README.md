# TurboIMS Next

[简体中文](README_CN.md)

TurboIMS Next is a standalone **KernelSU Next module** for supported arm64 Google Pixel devices. It applies selected IMS-related CarrierConfig values through a local WebUI and a root runner. It does not install a companion Android app and does not require Shizuku, Sui, Zygisk, LSPosed, or an external service.

> **Compatibility notice:** the current `master` installer accepts Android 13–16 (API 33–36) on arm64. CI also compiles an SDK 37 runner, but the current installer rejects Android 17. Do not treat an SDK 37 artifact as installable Android 17 support. Voice-call validation is device, carrier, SIM, and network dependent.

## What it does

- Keeps **TurboIMS** as the default implementation mode.
- Provides an optional **Carrier IMS** mode for devices and releases that need a Carrier IMS compatibility path.
- Applies supported IMS feature flags: VoLTE, VoWiFi, video telephony, VoNR, cross-SIM IMS, UT, and 5G NR availability.
- Selects all active subscriptions or an individual SIM, and maps subscription IDs to slots before acting.
- Applies CarrierConfig as a nonpersistent override and reads the requested values back when the platform API permits it.
- Can optionally set a per-SIM carrier test MCC/MNC in Carrier IMS mode. An empty value uses the native SIM identity.
- Reads IMS registration status, can request an IMS reset, and reports bounded polling results.
- Stores module-owned state so a mode switch or restore only targets overrides that TurboIMS Next recorded as its own.
- Provides boot application, optional periodic checking, status export, logs, diagnostics, and per-feature restore controls.

## What it does not do

- It does **not** edit APNs automatically.
- It does **not** modify the system partition, SELinux policy, root-hide settings, or system properties.
- It does **not** send data to a network service.
- It does **not** guarantee carrier registration, emergency calling, outgoing calls, incoming calls, or two-way audio. A successful CarrierConfig readback or an IMS registration result is not proof that calling works.

## Requirements

| Requirement | Current status |
| --- | --- |
| KernelSU Next | Required |
| Device ABI | arm64 |
| Android | Android 13–16 (API 33–36) accepted by the current installer |
| Device | Google Pixel target; device and carrier testing remain required |
| Root companion app | Not used |
| Shizuku / Sui / Zygisk / LSPosed | Not used |

Your carrier, SIM provisioning, region, modem state, and Android build still decide whether IMS calling can work.

## Install

1. Open **Actions** in this repository and download a successful `FLASHABLE-TurboIMS-Next-...` artifact for the supported build.
2. Install the downloaded ZIP directly in KernelSU Next.
3. Reboot.
4. Open the module WebUI, inspect the detected SIMs and status, then enable and apply the desired configuration.

The initial configuration is paused. Review the selected SIM and settings before applying a change.

## Use

### Implementation mode

- **TurboIMS** — default mode and the established KernelSU configuration path.
- **Carrier IMS** — optional compatibility path. It may apply a carrier test MCC/MNC, request an IMS reset, and check IMS registration.

Only one mode should own a subscription at a time. The module attempts to clean its own recorded override before applying the next mode. If cleanup, application, or readback fails, the operation reports the failed stage instead of reporting success.

### SIM profile

For each slot, you can optionally set:

- Country or region code
- Carrier display name
- Carrier test MCC/MNC

Leave the carrier test MCC/MNC empty to use the actual SIM identity. Use an explicit test value only when it is appropriate for the selected carrier and you can validate the result. A Binder call being accepted does not provide a reliable platform readback of the effective carrier identity.

### Restore and diagnostics

Use the status and diagnostic output to distinguish:

- Configuration write/readback verification
- Carrier test override request result
- IMS registration result
- Actual call behavior

Restore targets the configuration state recorded by this module. It deliberately avoids clearing a carrier or system override whose ownership cannot be established.

## Safety and root boundary

KernelSU Next grants this module root privileges, so the module is designed to keep its scope narrow:

- The root runner accepts only a fixed action set and validates configuration payloads.
- Module state, logs, and configuration files are stored under `/data/adb/turboims-next` with root-only permissions.
- CarrierConfig uses nonpersistent overrides; it does not request persistent system-app-only overrides.
- The runner is an `app_process` container, not an installed app or exported Android component.
- The WebUI uses local assets and does not make network requests.

This does not make a rooted device undetectable. TurboIMS Next does not manage root hiding and leaves the normal KernelSU module footprint under `/data/adb`. Apps that already have root-level access can inspect that location.

## Known limits

- Android 17 installation is blocked by the current `master` installer guard and has not been accepted as a working release path.
- Platform APIs do not provide reliable carrier-test-override readback on every Android build.
- Carrier IMS state can change after a reset or network transition; a bounded poll may finish before a carrier completes registration.
- Uninstall restore is best-effort. Reboot clears the module's nonpersistent CarrierConfig override, but review diagnostics if removal occurs during a failed restore.
- Calling behavior must be validated on the actual Pixel, Android build, SIM, carrier, and network.

## Development and build

The repository packages the module through GitHub Actions. The build produces a flashable KernelSU Next artifact, verifies the runner hash, and runs packaging checks. Do not treat a successful build as device voice-call validation.

## Related projects

- [TurboIMS upstream](https://github.com/Turbo1123/TurboIMS)
- [Carrier IMS for Pixel reference](https://github.com/Pew2018/carrier-ims-for-pixel)

## Support information

When reporting a problem, include the Android version, device codename, selected mode, selected SIM/slot, whether a SIM profile or carrier test MCC/MNC was applied, and exported diagnostics. Do not publish phone numbers, IMSIs, ICCIDs, or other subscriber identifiers.
