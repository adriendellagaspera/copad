# Copad — hands-on UX/UI audit report

_Desktop + mobile, run against a live local build, cross-referenced with open issues/PRs. Produced by a multi-agent audit swarm and reconciled against current `main`._

## Method

- Built and ran Copad locally (`vite preview` + WebRTC signaling), driven with Playwright.
- **114 screenshots** across 5 viewports (desktop 1440, laptop 1280, tablet 768, mobile 390, small-mobile 360) covering every flow, plus per-device programmatic diagnostics (touch targets <44px, horizontal overflow, unlabeled controls, heading order, console errors).
- **Swarm:** 11 UX-domain auditors + 6 open-PR evaluators (127 agents total incl. adversarial verification) → 120 raw findings → 113 verified → **86 de-duplicated items**.
- Hands-on-tested open PRs in isolated git worktrees; re-baselined the status/connection chrome against current `main` after mid-session merges.

## Important: the repo moved during the audit

`main` advanced several commits mid-session, which **already resolved** part of what an initial pass would have flagged — so this report does not re-file them:

- **#124 merged** — the old 3-indicator header (LIVE-ONLY badge + "No peers yet · P2P" pill + signal-bars button) is now **one 2-segment status chip**.
- **#105 / #125 merged** — "Live-only" → "Not saved"; the connection dialog is now a redesigned **"Connection & storage" bottom sheet**.
- **PR #121 updated (open)** — now **deletes the IntroDialog + the WriteGate overlay**, folds the gate into the SyncBanner, fixes an invisible-gate bug, and fixes the amber-on-amber CTA contrast. This addresses the onboarding-overload / overlay-gate / banner-contrast findings, so they were routed to a **comment on #121** instead of new issues.

## Headline: two genuine correctness bugs (filed in #128)

1. **Pasting an encrypted invite `?room=X#k=KEY` into the room switcher silently drops the `#k=` decryption key** → you join an encrypted room with no key and it fails to sync as an "empty room", no error. (`roomIdFrom`/`goToRoom` ignore the URL fragment.)
2. **Browser Back/Forward is broken after a room switch** — `goToRoom` uses `history.pushState` but there is no `popstate` listener, so the URL and the open document desync.

## New issues filed (7)

| # | Area | Labels |
|---|------|--------|
| [#128](https://github.com/adriendellagaspera/copad/issues/128) | Room navigation & switcher | ux, P1 |
| [#129](https://github.com/adriendellagaspera/copad/issues/129) | Share dialog | ux |
| [#130](https://github.com/adriendellagaspera/copad/issues/130) | Editor writing experience | editor, ux |
| [#131](https://github.com/adriendellagaspera/copad/issues/131) | Accessibility & contrast | ux |
| [#132](https://github.com/adriendellagaspera/copad/issues/132) | Toast & feedback system | ux |
| [#133](https://github.com/adriendellagaspera/copad/issues/133) | Visual consistency | ux |
| [#134](https://github.com/adriendellagaspera/copad/issues/134) | Settings drawer & storage connect-forms | storage, ux |

## Comments added (7)

| Target | What it adds |
|--------|--------------|
| issue #102 | quantified mobile chrome cost + 2 unaddressed sub-cases (stranded drawer close, non-scrolling Share sheet) |
| issue #101 | exact sub-44px target sizes (38×38 toolbar, header icons) + no touch selection affordance |
| issue #18 | cryptic new-room slugs + missing list management (remove/pin/filter) |
| PR #121 | review: net win; residuals (InfoBanner still stacks, lost re-findable help, gate cue + ≥44px CTAs) |
| PR #76 | review: ghost-H1 looks like a title but sits on a paragraph & doesn't rename the room |
| PR #79 | review: i18n coverage gaps (slash menu, link popover), discoverability, non-reactive placeholder |
| PR #70 | review: icon-only + is fine (aria ok); flag ≥44px target for the mobile-header work |

## Open-PR verdicts (hands-on)

| PR | Verdict | Note |
|----|---------|------|
| #124 unified status chip | **merged during audit** | 3→1 indicators; mobile glyphs terse |
| #121 write-gate → banner | **ship** | removes intro modal + overlay + fixes invisible-gate bug + CTA contrast |
| #70 "New" → + icon | **ship** | aria-label preserved; tightens header |
| #76 ghost-H1 placeholder | **ship w/ questions** | distinct from real H1, but node-type mismatch + no rename link |
| #79 EN/FR i18n | **needs rebase** | solid base; slash menu/link popover uncovered; base stale |
| #117-120 storage backends | **UX ok** | generic-field render clean; see #134 for form-scaling gaps |

## Reconciled / not filed (already owned or fixed)

- **Comment on PR #124 (unified status chip review)** — PR #124 is MERGED into current main (0ed3ed2). Its consolidation (StatusPill+PersistenceBadge → one 2-segment chip; standalone diag button removed) is now shipped, so a pre-merge review comment is moot.
- **New-issue / finding: header carries 3-4 redundant status indicators (LIVE-ONLY badge + 'No peers yet · P2P' pill + signal-bars diag button + SyncBanner)** — Resolved by merged #124: PersistenceBadge.svelte is deleted, the signal-bars diag button is gone, and the header now shows a single tappable chip (`StatusPill.svelte`). Confirmed in shots-mainnow/desktop-03-editor-header.png.
- **Feedback-toasts item: 'Connection dialog repeats no-peers twice and always shows the TURN help'** — ConnectionDialog was redesigned (#105/#125, merged) into a 'Connection & storage' sheet. The 'Peers 0' + 'No peer connections yet' lines and the 'Relayed via TURN' explainer are now both folded inside a collapsed 'Technical details' <details> (ConnectionDialog.svelte:229-266); the main sheet leads with a clean 'You're the only one here' card. No longer a user-facing redundancy.
- **New-issue group [4] 'onboarding-first-run' as a standalone issue** — Converted to residuals in the PR #121 comment per instructions. #121 (open, updated) deletes IntroDialog + WriteGate and folds the gate into SyncBanner, directly addressing the triple-stack, the WriteGate-overlay-reads-as-blocked, and the amber-on-amber CTA contrast. Only the still-true residuals (InfoBanner stacking, lost re-findable intro, gate CTA sizing) are carried to the PR comment.
- **Chip mobile residuals from the (dropped) PR #124 review: collapsed chip is sub-44px icon-only; wordless states rely on colour (Save-failed vs Not-saved same cloud-off glyph; Direct vs Alone dot distinguished only by a reduced-motion-disabled pulse); dead 'ok' Tone + orphaned .seg.ok CSS** — These are real on merged main (StatusPill.svelte:46,104,117,214-216,266-288) but sit squarely in the territory of open issues #105 (elevate the durability signal on mobile) and #106 (status pill + presence/connection sheet), which own the mobile status chip. Left for those epic children rather than filed as a duplicate new issue; the merged design mitigates via SR-only clipped labels + the one-tap detail sheet.
- **Minor arrangement finding: self avatar (IdentityMenu) and peer avatars (PresenceBar) live in two header clusters** — A defensible pattern (self identity menu vs peer facepile is a common split) and low-signal; owned by presence epic child #106 if pursued. Not worth a maintainer's attention as an issue.

---
_Full de-duplicated finding set and per-domain detail were produced by the swarm; this report is the actioned summary. Audit harness lives in `.audit/`._
