// The label vocabulary, and the only home for it. `.github/workflows/labels.yml`
// syncs GitHub to this file and prunes anything absent from it.
//
// Four axes answer four questions; a label answers exactly one of them:
//   type:     what is this?          exactly one, required
//   area:     where in the code?     one or more, required
//   status:   where is it up to?     at most one, absent = nothing to flag
//   surface:  which viewport?        at most one, absent = both
// `good first issue` keeps GitHub's own name and colour: the string is an API,
// it populates the repository's /contribute page.
//
// The two required rules are enforced by .github/scripts/check-issue-labels.cjs.

const TYPE = '2563eb';
const AREA = '6b6862';
const STATUS = 'd97706';
const SURFACE = '9333ea';

module.exports = [
  { name: 'type:bug', color: TYPE, description: 'Shipped behaviour contradicts the intent or the contract' },
  { name: 'type:feature', color: TYPE, description: 'A capability that does not exist yet' },
  { name: 'type:polish', color: TYPE, description: 'An existing capability below the bar — UX, a11y, perf. Not a defect' },
  { name: 'type:debt', color: TYPE, description: 'Internal quality; nothing changes for the user' },
  { name: 'type:docs', color: TYPE, description: 'Documentation or the contract only' },
  { name: 'type:spike', color: TYPE, description: 'Timeboxed investigation; the deliverable is an answer, not code' },
  { name: 'type:decision', color: TYPE, description: 'An open question to arbitrate; the deliverable is a recorded decision' },
  { name: 'type:tracking', color: TYPE, description: 'Umbrella over sub-issues; carries no work of its own' },

  { name: 'area:editor', color: AREA, description: 'src/editor/, src/format/, Editor.svelte, Toolbar.svelte' },
  { name: 'area:storage', color: AREA, description: 'src/storage/' },
  { name: 'area:collab', color: AREA, description: 'src/collaboration/ — transport, presence, room encryption' },
  { name: 'area:shell', color: AREA, description: 'src/ui/, App.svelte, src/styles/ — chrome outside the editor' },
  { name: 'area:build', color: AREA, description: '.github/, deploy/, e2e/' },
  { name: 'area:contract', color: AREA, description: 'docs/contract.md governs this; it changes in the same commit' },

  { name: 'status:needs-triage', color: STATUS, description: 'Set by the template, and re-set whenever type:/area: are missing' },
  { name: 'status:needs-decision', color: STATUS, description: 'Blocked on a human arbitration, not on work' },
  { name: 'status:blocked', color: STATUS, description: 'Blocked by another issue — which one lives in the link, not here' },
  { name: 'status:ready', color: STATUS, description: 'Specified enough to pick up without asking anything' },
  { name: 'status:in-progress', color: STATUS, description: 'An open PR carries it' },

  { name: 'surface:mobile', color: SURFACE, description: 'Touch or small-screen specific' },
  { name: 'surface:desktop', color: SURFACE, description: 'Fine-pointer or wide-viewport specific' },

  { name: 'good first issue', color: '7057ff', description: 'Small, self-contained, no context needed' },
];
