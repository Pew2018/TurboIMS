# OnePlus WebUI navigation and presentation

All changes belong to `feature/oneplus-webui`. Do not merge into the stable branch without owner approval.

## Host back integration

KernelSU Next v3.2.0 added a native back handler:
https://github.com/KernelSU-Next/KernelSU-Next/pull/1204

The manager checks `WebView.canGoBack()`, calls `WebView.goBack()` when possible, and otherwise closes the Activity. The module must create real same-document history entries.

The root is initialized with `replaceState`, not an extra `pushState`. Page links push states with distinct hash URLs. Both `popstate` and `hashchange` restore the page without saving or rewriting the IMS form. Toolbar back calls `history.back()`. Nested colors and raw diagnostic pages return to their parent. Scroll positions are retained.

Each dialog temporarily pushes a history entry. System back cancels the dialog and resolves an outstanding confirmation as false. Cancel/confirm buttons traverse back to consume the same entry before settling the promise. Already answered confirmations are not revived by forward traversal.

## Presentation rules

- Chevrons indicate independent pages only. Choices, switches and actions have none.
- Dividers separate structural groups; rows use spacing.
- Home shows the current status. Technical identity, per-SIM errors and unconfirmed writes remain available under diagnostics.
- The diagnostic summary reports missing data as unknown, never as success. CarrierConfig read availability does not imply IMS registration or successful calls.
- Original export and operation JSON remain intact on dedicated pages.
- Raw JSON uses `white-space: pre`, monospace text and internal horizontal scrolling.
- Preferences and dialogs are not selectable. Text fields, diagnostic values and logs remain selectable.
- OnePlus Blue and custom accents are separate from green/orange/red status indicators.
- No changes to the privileged bridge, runner, shell scripts, IMS write/restore semantics or configuration schema.

## Verification

GitHub Actions runs Node regressions, root-runner tests, packaging validation, and the actual downloadable ZIP installer smoke test. The preview workflow runs Chromium checks for history, confirmation cancellation, forward/reload/hash navigation, row clicks, log scrolling, text selection, dark mode and narrow screens, and uploads screenshots.

Chromium traversal verifies web navigation behavior, not native Android dispatch. On a device with KernelSU Next v3.2.0+ confirm:

1. Appearance → colors → back gesture → appearance → back gesture → home.
2. Diagnostics → full JSON → back → diagnostics.
3. Open confirmation → system back: dialog closes; no settings are saved.
4. Repeatedly open/close dialogs, then return home: the next back exits when the host history is exhausted.
5. Abort an edge gesture: no page change or action.
6. Hardware/three-button back and Android 16 edge back follow the same completed traversal.

Predictive-back animation is controlled by the manager Activity and is outside module JavaScript.

## Touch and status refinement

The home status separates the operation title, an honest short explanation and detected SIM slots. Probe is still read-only; successful read access is never presented as write verification. Internal errors remain in diagnostic output. Probe/refresh are accent text actions rather than preference rows.

The offline feedback helper delegates pointer and keyboard events without invoking commands or changing history. Row ripples start at the actual touch coordinate, are clipped to the row, fade on release and cancel on scrolling. Disabled rows suppress activation feedback. Colors follow the current theme and custom accent. CSS tokens define spacing, touch sizes and motion durations. Reduced-motion preferences suppress animated ripples and dialog movement.

Dialog exit lasts 100 ms, then resolves the original confirmation promise once. History traversal is unchanged: the temporary dialog entry is consumed first; no extra animation entries are pushed. Radio rows update their accessible checked state before closing. Core runner and bridge code remain untouched.

The preview workflow additionally sends real touch events in Chromium, checks touch-origin feedback and scrolling cancellation, busy text-action states, system color-scheme changes, custom HEX and reduced motion. Native Android back dispatch still requires device verification.
