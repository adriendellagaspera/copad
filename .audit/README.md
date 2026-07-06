# Copad UX/UI audit harness

Reproducible tooling used to run a hands-on UX/UI audit of Copad across desktop and
mobile viewports. Not part of the app build.

- `audit.mjs <device>` — drives the running preview build with Playwright across a full
  flow (onboarding, write-gate, editor, toolbar, slash menu, share, settings, connection,
  theme) and emits screenshots + a `diag-<device>.json` of programmatic diagnostics
  (touch targets <44px, horizontal overflow, unlabeled controls, heading order, console
  errors). Devices: `desktop laptop tablet mobile smallmobile`.
- `supplement.mjs <device>` — clean, isolated captures of individual interactions
  (room switcher, identity menu, link popover + link validation, outline, selection
  toolbar, share modes, connection dialog, settings, new room).
- `audit-workflow.mjs` — the multi-agent orchestration script (11 UX domain auditors +
  6 open-PR evaluators → adversarial verification → dedup/cross-reference/synthesis).

## Run
```
npm run build && npm run preview      # serves :4173
npm run signaling                     # :4444 (WebRTC discovery)
node .audit/audit.mjs mobile          # screenshots + diagnostics
```
Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (pre-installed in the
web sandbox). Screenshots/diagnostics are written to the session scratchpad, not the repo.
