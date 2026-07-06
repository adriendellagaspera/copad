export const meta = {
  name: 'copad-ux-audit',
  description: 'Exhaustive UX/UI audit of Copad (desktop+mobile) + open-PR evaluation, cross-referenced with open issues',
  phases: [
    { title: 'Audit', detail: '11 UX/UI domain auditors + 6 open-PR evaluators, in parallel' },
    { title: 'Verify', detail: 'adversarially verify each non-trivial finding against source + screenshots' },
    { title: 'Synthesize', detail: 'dedup, cross-reference with open issues/PRs, produce master action plan' },
  ],
};

// ── Shared context handed to every agent ─────────────────────────────────────
const SCRATCH = '/tmp/claude-0/-home-user-copad/507fb634-b1a6-5326-ad13-2dcd60927e83/scratchpad';
const SHOTS = `${SCRATCH}/shots`;
const REPO = '/home/user/copad';

const CONTEXT = `
# Copad UX/UI audit — shared context

Copad is a serverless, local-first, real-time collaborative rich-text editor (Svelte 5 + ProseMirror + Yjs, WebRTC P2P default). Hexagonal architecture. Full architecture: ${REPO}/CLAUDE.md.

The app IS RUNNING at http://localhost:4173 (preview build) with a local WebRTC signaling server on :4444.

## Evidence you MUST use
- Screenshot corpus (PNG): ${SHOTS}/  — index + naming at ${SCRATCH}/REF-screenshots.md
  Devices: desktop(1440x900), laptop(1280x800), tablet(768x1024), mobile(390x844), smallmobile(360x640).
  Naming: <device>-<NN>-<slug>.png (scripted flow) and <device>-sup-<slug>.png (clean isolated captures).
  READ the relevant screenshots with the Read tool (it shows images visually).
- Programmatic diagnostics (touch targets <44px, horizontal overflow, unlabeled controls, heading order, console errors) per device: ${SCRATCH}/diag-<device>.json (desktop, laptop, mobile, smallmobile, tablet). Parse with node/jq or Read.
- Source: under ${REPO}/src/ . App.svelte is the wiring; ui/*.svelte, Editor.svelte, Toolbar.svelte, Settings.svelte, editor/ui/*.svelte are the components.
- Existing GitHub coverage (open issues + PRs) to cross-reference: ${SCRATCH}/REF-coverage.md

## Optional live interaction
You MAY drive the live app with Playwright for states the screenshots don't cover. Chromium exe: /opt/pw-browsers/chromium-1194/chrome-linux/chrome. Pattern lives in ${REPO}/.audit/supplement.mjs (put any new script in ${REPO}/.audit/ so node resolves node_modules, run with node). Prefer screenshots+source first; only script when genuinely needed. On first load: dismiss the intro via button "Got it", then "Write on your own" to unlock the editor.

## What counts as a finding
A concrete UX/UI irritant that degrades the experience below SOTA (Linear/Notion/Figma/iA Writer/Bear class). Be specific and evidence-backed. Rate severity honestly:
- blocker: broken/unusable or data-risk. high: clearly hurts a core flow. medium: noticeable friction. low: polish. nit: cosmetic.
platform: desktop | mobile | both.
For each finding set matched = "issue #NNN" or "PR #NNN" (from REF-coverage.md) if an existing item already covers it, else "none"; and documented = true/false accordingly. If an existing issue covers it PARTIALLY, still list it and note the gap in description.

Do NOT invent problems. If a screenshot artifact looks like a bug but is actually my test script's leftover (e.g. a stray "/" character from a scripted slash-menu step, selection weirdness), do not report it — verify against a clean supplemental capture or the source. Ground every finding in evidence (name the screenshot file and/or source file:line).
`;

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'severity', 'platform', 'description', 'evidence', 'suggestedFix', 'matched', 'documented'],
        properties: {
          id: { type: 'string', description: 'short kebab slug unique within this domain' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit'] },
          platform: { type: 'string', enum: ['desktop', 'mobile', 'both'] },
          area: { type: 'string' },
          description: { type: 'string', description: 'what is wrong and why it is an irritant vs SOTA' },
          evidence: { type: 'string', description: 'screenshot filename(s) and/or source file:line' },
          repro: { type: 'string' },
          suggestedFix: { type: 'string' },
          matched: { type: 'string', description: '"issue #NNN" | "PR #NNN" | "none"' },
          documented: { type: 'boolean' },
        },
      },
    },
    summary: { type: 'string', description: '2-3 sentence overview of this domain' },
  },
};

// ── Domains ──────────────────────────────────────────────────────────────────
const DOMAINS = [
  { key: 'onboarding', brief: 'First-run & onboarding & empty states. The intro dialog (IntroDialog.svelte), the InfoBanner storage nudge, the WriteGate overlay, and the SyncBanner can ALL appear at once on first load — assess the stacking/overload. Empty-document state, new-room state, placeholder copy, "Got it" flow, whether onboarding is dismissible/re-findable, returning-user experience. Screenshots: *-01-first-load-intro, *-02-after-intro-dismiss, *-03-write-gate, *-sup-new-room. Source: ui/IntroDialog.svelte, ui/InfoBanner.svelte, ui/WriteGate.svelte, ui/SyncBanner.svelte, ui/intro.svelte.ts, App.svelte.' },
  { key: 'header-chrome', brief: 'Global header & top chrome density and layout, desktop AND how it reflows to mobile/tablet. Count the controls, spacing, alignment, visual grouping, wasted space (e.g. big brand logo on mobile), breakpoint behavior. Screenshots: every *-06-typed-content, *-22-editor-full across devices; compare desktop vs mobile vs smallmobile vs tablet. Source: App.svelte header block (lines ~556-614), styles/app.css.' },
  { key: 'editor', brief: 'Core writing experience. Toolbar.svelte (13 buttons), formatting via buttons+shortcuts, markdown INPUT RULES (verify whether inline **bold**/*italic*/`code`/~~strike~~ auto-convert — evidence shows "**bold**" stayed literal in mobile-06/desktop editor; check editor/plugins.ts inputrules), slash menu (SlashMenu.svelte/slashMenu.ts), desktop selection bubble (SelectionToolbar.svelte), placeholder (editor/ui/placeholder.ts), Outline, WordCount, undo/redo affordances, ShortcutBar, CaretFormatHint, LinkPopover (link validation), code block UX, "Copy MD" discoverability, trailing empty node. Screenshots: *-sup-selection-toolbar, *-sup-outline, *-sup-link-popover, *-sup-link-popover-badlink, *-06/07/08. Source: Toolbar.svelte, Editor.svelte, editor/*.' },
  { key: 'sharing', brief: 'Sharing & encryption & access. ShareDialog.svelte (invite link, Copy link, view-only expander, secure link, room password, view link), RoomLock.svelte, view-only/?role=reader, absence of QR (#108 wants it). Copy/messaging clarity about E2E scope, live-only. Screenshots: *-sup-share-default, *-sup-share-encrypted, *-13-share-dialog. Source: ui/ShareDialog.svelte, ui/RoomLock.svelte, collaboration/secretLink.ts.' },
  { key: 'settings', brief: 'Settings drawer & storage backend connect flows. Settings.svelte sections (Editor/language, Local copy, Connection/TURN, storage backends with config+credential fields, pills unavailable/setup/ready/connected). Drawer presentation (full-screen? bottom sheet? width), scroll, section clarity, backend discoverability, connect/validate/error affordances, "managed/locked" fields. Screenshots: *-16/17/18-settings*, *-sup-settings. Source: Settings.svelte, storage/*.' },
  { key: 'status-presence', brief: 'Connection-status & persistence & presence SYSTEM and its REDUNDANCY. Header currently shows PersistenceBadge (LIVE-ONLY) AND StatusPill (No peers yet · P2P) AND a signal-bars diag button — three separate indicators. PresenceBar, IdentityMenu (avatar/Set name). Assess redundancy, legibility, whether "LIVE-ONLY" vs "No peers yet" confuse. ConnectionDialog. Note PR #124 proposes unifying — judge if that fully resolves it. Screenshots: *-06, *-sup-connection, *-sup-identity-menu. Source: ui/StatusPill.svelte, ui/PersistenceBadge.svelte, ui/PresenceBar.svelte, ui/IdentityMenu.svelte, ui/ConnectionDialog.svelte, App.svelte.' },
  { key: 'mobile-touch', brief: 'DEEP mobile responsiveness & touch ergonomics. Measure how much vertical chrome sits above the text on mobile before the document (header rows + banner + fixed toolbar). Touch targets <44px (use diag-mobile.json / diag-smallmobile.json "small" arrays — enumerate the worst offenders with labels). Fixed toolbar not keyboard-anchored (#101). Header stacking (#102). Horizontal overflow. Compare mobile vs smallmobile(360). Screenshots: all mobile-* and smallmobile-*. Source: Toolbar.svelte, Editor.svelte, styles/editor.css, styles/app.css.' },
  { key: 'a11y', brief: 'Accessibility. From diag-*.json: unlabeled controls (noLabel/inputsNoName), heading order (headings array — is there a single logical H1?), tiny targets. Plus from source/screenshots: focus-visible styles, dialog focus-trap & Escape & focus return (Dialog.svelte, IdentityMenu, RoomSwitcher popovers), aria roles, live regions for status/toasts, color-contrast concerns (muted grays on light: "No peers yet", "Set name", shortcut bar), prefers-reduced-motion coverage, icon-only buttons. Source: ui/Dialog.svelte, all interactive components, styles/base.css, styles/tokens.css.' },
  { key: 'theming', brief: 'Visual design & theming. Dark mode fidelity (screenshots *-20-dark-theme-full) — contrast, surfaces, any element that did not adapt. Light-mode typography rhythm, spacing scale, iconography consistency (mix of emoji ⚙/❝ vs SVG icons vs text glyphs B/I/S), border/radius/shadow consistency, the editor "card" framing, measure/line-length. Tokens in styles/tokens.css. Screenshots: *-19/20/21, *-22-editor-full both themes.' },
  { key: 'feedback', brief: 'Interaction feedback & transient states. Toasts (Toast.svelte, toasts.svelte.ts) — position, stacking, dismissal, copy; the "Secure link created" toast overlaps the word-count/status bar in desktop-22 — check. Loading/spinner states ("Setting up a secure connection…", "Checking room access…"), offline/reconnection UX (#109), error paths, dialog open/close consistency & backdrop dismiss, SyncBanner behavior. Source: ui/Toast.svelte, ui/SyncBanner.svelte, App.svelte, collaboration/core.ts.' },
  { key: 'navigation', brief: 'Room switching, multi-document & navigation. RoomSwitcher.svelte (rename inline, "open a room by id or URL", switch dropdown), recent rooms (recentRooms.ts) — is there a recent-docs list (#18)? New-room via "New". URL/room semantics, back button, how you find rooms you visited. Screenshots: *-sup-room-switcher. Source: ui/RoomSwitcher.svelte, collaboration/recentRooms.ts, App.svelte goToRoom/newRoom.' },
];

// ── Open PRs to evaluate ─────────────────────────────────────────────────────
const PRS = [
  { n: 124, title: 'Unify connection & durability into a single status chip', focus: 'Does merging StatusPill+PersistenceBadge into one chip actually reduce the header redundancy I found? Is the mobile icon-only collapse legible/accessible? Any regression vs current 3-indicator layout? Read the PR diff + the current status screenshots.' },
  { n: 121, title: 'Align WriteGate with mobile UX north star (bottom sheet)', focus: 'Does the bottom-sheet WriteGate improve on the current centered-card+scrim (screenshots *-03-write-gate / *-sup-connection show current)? Does the editor stay visible? Any desktop regression?' },
  { n: 79, title: 'English/French i18n', focus: 'UX completeness of i18n: are ALL visible strings covered? Any layout risk from longer French strings in the dense header/toolbar? Language switch discoverability. Read diff + Settings.svelte language section.' },
  { n: 76, title: 'Room name as empty-doc title placeholder', focus: 'Does the ghost H1 room-name placeholder help or confuse (is it distinguishable from a real H1)? Interaction with the write-gate/empty state. Read diff + editor/ui/placeholder.ts.' },
  { n: 70, title: 'Replace "New" text button with a + icon', focus: 'Does New→+ icon help header density (my header-chrome finding)? Discoverability/accessibility of an icon-only "+" (aria-label kept?). Read diff.' },
  { n: 'storage', title: 'Storage backend PRs #117 GDrive / #118 GitLab / #119 SharePoint / #120 S3', focus: 'These are generic-field backends with minimal bespoke UI. Assess ONLY the UX surface: do they render cleanly in Settings via generic field rendering? Any new config-field UX concern (labels, help text, error/validate copy, too many fields)? Read each PR diff briefly + Settings generic rendering. One consolidated set of findings.' },
];

// ── Phase 1: Audit (domains + PRs in parallel) ───────────────────────────────
phase('Audit');

const domainThunks = DOMAINS.map((d) => () =>
  agent(
    `${CONTEXT}\n\n## YOUR DOMAIN: ${d.key}\n${d.brief}\n\nAudit this domain EXHAUSTIVELY across desktop and mobile. Read the named screenshots and source. Enumerate every distinct UX/UI irritant as a finding per the schema. Aim for completeness over brevity, but no padding — each finding must be real, specific, evidence-backed, and independently reproducible. Include the good parts only in "summary", not as findings.`,
    { label: `audit:${d.key}`, phase: 'Audit', agentType: 'general-purpose', effort: 'high', schema: FINDINGS_SCHEMA },
  ).then((r) => ({ domain: d.key, ...(r || { findings: [] }) })),
);

const prThunks = PRS.map((p) => () =>
  agent(
    `${CONTEXT}\n\n## YOUR TASK: evaluate open PR #${p.n} — "${p.title}"\n${p.focus}\n\nUse the GitHub MCP tools (ToolSearch for mcp__github__pull_request_read to get the PR diff/files; owner=adriendellagaspera repo=copad) to read the actual changes, plus the affected source in ${REPO}/src and the relevant screenshots of the CURRENT (pre-PR) state. Judge the UX DELTA the PR delivers: does it fix its target irritant, introduce any new one, and is it SOTA? Report findings per the schema — a finding here = a UX concern/gap/regression in the PR OR a residual irritant the PR leaves unaddressed. Set matched="PR #${p.n}".`,
    { label: `pr:${p.n}`, phase: 'Audit', agentType: 'general-purpose', effort: 'high', schema: FINDINGS_SCHEMA },
  ).then((r) => ({ pr: p.n, ...(r || { findings: [] }) })),
);

const auditResults = await parallel([...domainThunks, ...prThunks]);
const allFindings = auditResults.filter(Boolean).flatMap((r) =>
  (r.findings || []).map((f) => ({ ...f, source: r.domain ? `domain:${r.domain}` : `pr:${r.pr}` })),
);
log(`Audit: ${allFindings.length} raw findings from ${auditResults.filter(Boolean).length} agents`);

// ── Phase 2: Verify (adversarial, per finding worth verifying) ───────────────
phase('Verify');

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'correctedSeverity', 'keep', 'notes'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'artifact', 'overstated', 'not-reproducible', 'duplicate-of-issue'] },
    correctedSeverity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit'] },
    correctedMatched: { type: 'string', description: '"issue #NNN" | "PR #NNN" | "none" — fix if the auditor mis-tagged existing coverage' },
    keep: { type: 'boolean', description: 'true unless it is a test-harness artifact, false positive, or pure duplicate' },
    notes: { type: 'string', description: 'what you checked and the corrected framing/evidence' },
  },
};

// Verify everything except pure nits (those pass through as-is).
const toVerify = allFindings.filter((f) => f.severity !== 'nit');
const passthrough = allFindings.filter((f) => f.severity === 'nit').map((f) => ({ ...f, verdict: 'confirmed', keep: true }));

const verified = await parallel(
  toVerify.map((f) => () =>
    agent(
      `${CONTEXT}\n\n## ADVERSARIAL VERIFICATION\nA UX auditor reported this finding. Your job is to REFUTE or CONFIRM it against the real evidence (screenshots + source, and Playwright if needed). Be skeptical: is it a real irritant, a test-harness artifact (e.g. a stray character my script left), a false positive, overstated in severity, or already fully covered by an existing issue/PR (see ${SCRATCH}/REF-coverage.md)? Correct the severity and the matched/documented tag if wrong.\n\nFINDING (JSON):\n${JSON.stringify(f, null, 2)}\n\nReturn your verdict. keep=false ONLY if it is an artifact/false-positive/pure-duplicate.`,
      { label: `verify:${f.source}:${f.id}`, phase: 'Verify', agentType: 'general-purpose', effort: 'high', schema: VERIFY_SCHEMA },
    ).then((v) => ({ ...f, ...(v || { verdict: 'unverified', keep: true }) })),
  ),
);

const survivors = [...verified, ...passthrough].filter((f) => f.keep !== false);
log(`Verify: ${survivors.length}/${allFindings.length} findings survived (dropped ${allFindings.length - survivors.length})`);

// Persist raw + verified for the orchestrator to read regardless of synthesis.
// (Return them too.)

// ── Phase 3: Synthesize (dedup + cross-reference + action plan) ──────────────
phase('Synthesize');

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'newIssueGroups', 'issueComments', 'topline'],
  properties: {
    topline: { type: 'string', description: '4-6 sentence executive summary: the biggest UX themes and the single most impactful fixes' },
    items: {
      type: 'array',
      description: 'the full deduped master list, most severe first',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'platform', 'area', 'description', 'evidence', 'suggestedFix', 'disposition'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit'] },
          platform: { type: 'string', enum: ['desktop', 'mobile', 'both'] },
          area: { type: 'string' },
          description: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
          disposition: { type: 'string', description: '"comment on issue #NNN" | "augment PR #NNN" | "NEW ISSUE: <group-key>" | "known/no-action"' },
        },
      },
    },
    newIssueGroups: {
      type: 'array',
      description: 'proposed NEW issues, each grouping related undocumented findings into one well-scoped issue',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'body', 'labels', 'severity'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string', description: 'full GitHub issue body (markdown): context, the irritants w/ evidence, desktop/mobile, proposed direction, files. Honor the repo style seen in REF-coverage.' },
          labels: { type: 'array', items: { type: 'string' } },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit'] },
        },
      },
    },
    issueComments: {
      type: 'array',
      description: 'proposed comments to add to EXISTING issues/PRs that our audit augments with new evidence',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'body'],
        properties: {
          target: { type: 'string', description: 'e.g. "issue #102" or "PR #124"' },
          body: { type: 'string', description: 'the comment markdown: what our hands-on audit adds (evidence, measurements, edge cases) beyond what the issue already says' },
        },
      },
    },
  },
};

const synth = await agent(
  `${CONTEXT}\n\n## SYNTHESIS\nHere are all VERIFIED UX/UI findings from 11 domain auditors + 6 PR evaluators (after adversarial verification). Deduplicate across domains (many will overlap — e.g. mobile chrome height appears in header-chrome, mobile-touch, onboarding), MERGE duplicates, and produce the master action plan.\n\nRules:\n- Cross-reference every item with open issues/PRs in ${SCRATCH}/REF-coverage.md. If an existing issue/PR already fully owns it → disposition "comment on issue #NNN" or "augment PR #NNN" ONLY if we add real new evidence, else "known/no-action".\n- Group UNDOCUMENTED findings into a SMALL number of well-scoped NEW issues (do not file one issue per nit — cluster related nits into a "polish" issue). Each new issue body must be self-contained, evidence-backed (cite screenshot files + source paths), state desktop/mobile impact, and match the repo's existing issue style (see REF-coverage). Use labels from what the repo already uses: enhancement, ux, mobile-ux, editor, storage, presence, north-star, P0/P1/P2/P3, epic (only reuse plausible ones; prefer "ux" and "mobile-ux").\n- issueComments: only where our hands-on audit genuinely augments an existing issue (measurements, extra edge cases, a missed sub-case). Keep them concise and additive, not restating the issue.\n- Order items most-severe first. Be comprehensive but honest.\n\nFINDINGS (JSON array):\n${JSON.stringify(survivors, null, 2)}`,
  { label: 'synthesize', phase: 'Synthesize', agentType: 'general-purpose', effort: 'high', schema: SYNTH_SCHEMA },
);

return { rawCount: allFindings.length, survivorCount: survivors.length, survivors, synth };
