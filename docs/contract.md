# The Copad contract

> Specification. Unimplemented except where a section says otherwise (§4.3, §4.4,
> §5 have shipped; §2.1's hub/P2P settle-linger split, §2.2/§3.1/§3.4's presence
> model and write gate, and §4/§4.1/§4.2's waiting room and unlock moment are
> wired; §3.2/§3.3's `WriteReceipt`/`PersistHealth` machine is wired).
> This is the spine — the part that has to stay coherent, self-sufficient, on its own.
> Where it cites a mechanism, the citation is to this repo's code or to the upstream
> project that owns that mechanism — never to an issue tracker or a pull request.

## 1. The contract

Copad used to promise a place where documents live. It now promises something smaller and sharper:

> **Copad only lets you write where your writing goes: to someone, or to your file.**

One rule, two ways to satisfy it.

- **(a) Someone is here.** A peer is present and receiving your bytes.
- **(b) Your file is here.** A storage backend of yours is durably keeping them.

Neither → **read only**. You can read, scroll, select, copy and export. You cannot type.

### 1.1 What the lock is for

The lock does not punish solitude. It refuses to **fake durability**.

Writing alone in a room with no backend produces the harm the contract exists to prevent: you believe you have a document, and you don't — the bytes are in a browser cache that dies with the profile. Writing alone in a room saved to your own cloud produces no such harm: the bytes land in a real file. The two situations are genuinely different, so the contract treats them differently without becoming two contracts.

This is why branch (b) survives, and why the local cache never satisfies it (§7, D.1). It is also why the whole of §3.2 exists: a branch that claims durability must **prove** it, continuously.

### 1.2 What this replaces

The old thesis — *the document is a file you own* — is not deleted, it is demoted from the headline to a companion clause. Editing a file in place, in a cloud that offers no web editor, remains a first-class use of Copad. It is honest: the file exists. What is gone is the pretence that a room with nothing behind it is a document.

## 2. The two transports promise different things

Presence detection is the load-bearing input of branch (a), and the two transports fail in **opposite directions**.

| | **WebRTC / P2P** (default) | **WebSocket / hub** (opt-in) |
|---|---|---|
| Presence source | local inference: open data channels | server registry, relayed via awareness |
| Does the server know the room? | **No** — pure pub/sub, no roster | **Yes** — it holds the room's sockets |
| False negatives (*"alone" when not*) | **structural, unbounded** — a lost announce is never retried, no periodic re-announce exists | near zero after sync |
| False positives (*"not alone" when alone*) | rare | **up to 30 s** after an unclean exit |
| When is `peerCount` trustworthy? | positively only: `>0` proves someone receives; `0` never proves an empty room | both directions, minus the 30 s departure window |
| E2E encryption | **yes** — also encrypts signaling | **no**, by construction |

> **P2P errs toward "alone". The hub errs toward "not alone".**

Under this contract those two errors cost wildly different amounts. A P2P false negative **locks you out of your own document for an unbounded time**. A hub false positive lets you write for ≤30 s into a room that just emptied — bounded, and the CRDT converges on reconnect.

### 2.1 The inversion — wired

**The transport with the better detection gets the stricter contract.**

- **Hub — strict, no escape hatch.** *"This document opens for writing when someone else is here. The server keeps the list of who's present: when it says you're alone, you are."* Honest because the registry is authoritative. The stated cost: the server sees everything. `SyncBanner`'s gated tier states this, and its "Write alone anyway" button is gated on `transport === Transport.P2P` — the hub never renders it.
- **P2P — default, never absolute.** *"In peer-to-peer, nobody keeps the list. Copad can only know you're alone by hearing no one. When we aren't sure, we let you write. And you can always override."* An explicit, named escape hatch exists permanently.

The hub is not a degraded P2P and P2P is not an approximate hub. Each promises exactly what its mechanics allow. That inversion carries into the write gate's own clocks (`src/collaboration/writeGate.ts`), not just its copy:

| | Settle (`gateSettleMs`) | Departure linger (`gateLingerMs`) |
|---|---|---|
| **Hub** | `GATE_SETTLE_HUB_MS` = 1.5 s — the registry is authoritative, so a settled "alone" is trustworthy almost immediately. | `GATE_LINGER_HUB_MS` = 30 s — must cover y-protocols' `outdatedTimeout` awareness sweep (§2's own table), or the gate would lock while the server's own roster hasn't caught up yet. A correction, not a courtesy. |
| **P2P** | `GATE_SETTLE_P2P_MS` = 6 s — discovery is one-directional and never retried; a slow announce must not read as a locked-out room. | `GATE_LINGER_P2P_MS` = 3 s — a peer-close event is immediate and reliable, so this is a short courtesy grace window for a mid-sentence writer, not a wait for stale data to expire. |

Both share one cap, `GATE_LINGER_CAP_MS` = 120 s (`src/collaboration/departureHysteresis.ts`) — the typing-extension ceiling, deliberately larger than either base window so a single extension is never clamped away on the hub.

### 2.2 The uncertainty rule, and its inversion — wired

A write gate existed before this rule did — the same App.svelte section, before this issue rewired it. It armed **deliberately** on `Connecting` / `Unreachable` / `Offline`, justified on the grounds that protection matters most when signaling is cold.

That reasoning is right for a **durability warning** and wrong for a **contract lock**.

| | Warning (old) | Lock (new) |
|---|---|---|
| Cost of a false positive | one banner too many | **the user is locked out of their document** |
| So uncertainty must… | **gate more** | **gate less** |

> Changing the thesis **inverts the polarity of the uncertainty rule.** This is the single most important line in this document.

Non-negotiable consequence: **never lock on `Connecting`, `Unreachable` or `Offline`.** Those states do not say "I am alone". They say "I don't know".

## 3. The state machine

Two independent axes. The lock closes only when **both** branches fail.

### 3.1 Presence — branch (a) — wired

`RoomPresence` is added **beside** `ConnStatus`, never replacing it (`ConnStatus` keeps feeding the status pill and the connection dialog). `src/collaboration/types.ts` (`PresenceKind`/`RoomPresence`), computed and memoised in `src/collaboration/core.ts`, emitted by both adapters via the `Collab` port's optional `onPresence`.

| Kind | Meaning | Opens (a)? |
|---|---|---|
| `Unknown` | not attached, or roster not settled | **yes** — never lock on ignorance |
| `Reaching` | peers discovered, no data channel open (P2P) | **yes** — see below |
| `Alone` | attached, roster settled, nobody | no |
| `Accompanied` | at least one peer really exchanging data | **yes** |

`Reaching` is a new state and the main safety win. Today `peerCount` deliberately excludes discovered-but-unconnected conns, so "someone is here, we can't reach them" is invisible and reads as solitude. Making it distinct kills the worst false negative (TURN down, symmetric NAT).

**`Reaching` does not lock.** The contract's premise — someone is here — is *proven*: we heard their announce. The failure is **ours** (NAT traversal), not theirs. Locking someone out because our own traversal failed is exactly the hard incident this design exists to avoid.

### 3.2 Persistence — branch (b) — wired

`savedHere` means *a backend is configured, logged in, and claims this room*. All three conjunctions are **declarative** — configuration read from `localStorage` and a token-presence boolean. **None consults the world.** A dead token leaves all three true; that gap is exactly why the rest of this section exists.

So branch (b) gets its own state machine, `PersistHealth` (`src/collaboration/persistHealth.ts`), which **constates rather than predicts**:

| Kind | Meaning |
|---|---|
| `Unproven` | nothing attempted, or nothing conclusive — the starting state |
| `Proven` | at least one write landed this session |
| `Failing` | non-terminal failures below the streak threshold |
| `Broken` | a terminal cause, or a streak beyond threshold |

A **state machine, not a freshness criterion.** Freshness ("the last write succeeded less than T ago") degrades on its own while a user simply *reads* for ten minutes, and the lock then falls at the precise moment they resume writing — with nothing having changed in the world. That cost is unbounded and strikes a user for whom nothing failed. The machine's opposite failure — a token that dies during idleness and is only noticed at the next write — is bounded by one debounce window.

The machine's promise is not *"your backend is healthy"*. It is **"I will never assert a durability I have not observed."**

This requires the `Storage` port to be able to say what it did. `save(): Promise<void>` was a validator: it reports *threw / didn't throw*, and "didn't throw" does not mean the bytes arrived. The port is now `save(): Promise<WriteReceipt>` (`src/storage/writeOutcome.ts`) — every adapter reports `landed()` on a confirmed write, `skipped(Coalesced)` when a concurrent write already covered it, and throws a `ClassifiedWriteError` (a `WriteFailureKind`) instead of a bare `Error` on failure, so `parseWriteFailure()` (`src/storage/parse.ts`) has a real signal to classify. All ten adapters (`local`, `github`, `gitlab`, `gdrive`, `pcloud`, `dropbox`, `webdav`, `s3`, `sharepoint`, `onedrive`) are migrated — there is no `void` escape hatch left in the port, and `parseWriteFailure()`'s `DOMException`/fallback branches exist only for the truly unclassifiable case, not for an adapter that hasn't been touched yet.

### 3.3 Cold and Warm — the lock protects a session's start, not its middle — wired

The boundary is an **event, not a clock**: the first local modification in this session (`Editor.svelte`'s ProseMirror `dispatchTransaction`, keyed off `docChanged` and the absence of y-prosemirror's `isChangeOrigin` transaction meta — a remote peer's edit doesn't warm the regime, only this user's own does). That is what creates something to lose.

| | **Cold** (nothing written yet) | **Warm** (has written) |
|---|---|---|
| `Broken` ⟹ | branch (b) fails; the lock may close if (a) doesn't hold | branch (b) fails, **but the lock never closes** |
| Why | locking costs nothing — nothing to confiscate, and the illusion is stopped before it serves | locking does not un-write the paragraphs; it adds humiliation to loss |
| Instead | — | **alert loudly, offer the exits**: `Reconnect`, `Export a copy`, last-success time |

The same hysteresis governs a peer leaving mid-session (§4, ⑥). One principle, two verticals.

### 3.4 The decision rule — wired

```
durabilityHolds = savedHere && (health ∈ {Proven, Unproven, Failing} || regime === Warm)
                  ⟺ false only when  Broken ∧ Cold

Open if any of:
  role === Reader            → out of scope, readers were never gated
  collabUnavailable          → nobody can ever arrive
  soloOptIn                  → explicit, named user choice (P2P only)
  presence === Accompanied   → branch (a)
  presence === Reaching      → someone is here
  presence === Unknown       → NEVER LOCK ON IGNORANCE
  durabilityHolds            → branch (b)
  within settle window       → grace after attaching
  within linger window       → hysteresis after a departure

Held otherwise. ⟺ Alone, confirmed, past grace, out of hysteresis, and not durable.
```

Implemented in `src/collaboration/writeGate.ts` (`writeGateFor()`), a pure
function — no timers, no clocks, no DOM — with `docs/contract.md`'s truth table
unit-tested branch by branch. `durabilityHolds` (`src/collaboration/persistHealth.ts`)
is `savedHere && (health ∈ {Proven, Unproven, Failing} || regime === Warm)` — App.svelte
computes it from `savedHere` plus the Editor-reported `persistHealth`/`regime`
(bridged through `sessionState.svelte.ts`, same pattern as `saveStatus`) and feeds
*that*, not the bare `savedHere`, into `writeGateFor()`'s branch-(b) input. The one
read site that deliberately keeps the bare `savedHere` is the `storage` prop passed
to the Editor: gating that on health too would make `Broken` absorbing, since a
`storage = null` Editor never calls `save()` again and so could never prove itself
healthy. The clocks for the settle and linger windows live in `App.svelte` (two small
`$effect`s), which feed `writeGateFor()` pre-computed booleans (`aloneSettled`,
`withinDepartureLinger`) rather than raw timestamps — keeping the decision
function itself clock-free.

> **Unlocking is optimistic and immediate; locking is pessimistic and deferred.** Any sign of life opens at once; only a prolonged, confirmed absence closes. The tests must enforce this asymmetry.

## 4. The states, as the user meets them — wired

Three words that must never blur into one another — the solitude lock is **not a permission**, and must never borrow the padlock vocabulary of `RoomLock`, or the user reads "the host restricted me" when the true sentence is "there is nobody here".

| Concept | Label | Reversible? |
|---|---|---|
| Alone, confirmed | **Waiting for someone** | yes, the moment someone arrives |
| View-only link (`?role=reader`) | **View-only** | no, fixed for the session |
| Encrypted room, no key | **Locked** | yes, with the key |

Inherited principles, not inventions: **never a scrim over the text** — the document stays visible, scrollable, selectable and copyable in every state; one status band only; the status pill stays the quiet permanent reference.

| # | State | Editable? | What we say |
|---|---|---|---|
| ① | `Connecting` | **yes** | nothing beyond the pill |
| ② | attached, discovering (grace) | **yes** | nothing — deliberate silence |
| ③ | **alone, confirmed** | **no** | *You're the only one here. Copad opens the document when someone joins. Until then you can read, copy and export it.* |
| ④ | someone here, unreachable | **yes** | *Someone's here — still connecting to them.* Neutral tone, `Retry` + `Connection details` |
| ⑤ | `Connected` | **yes** | one line, once |
| ⑥ | a peer left | **yes**, then ③ | *Ada left. You can keep writing for a moment.* Then: *The room is empty again. Your work is still here to read and export.* |
| ⑦ | `Unreachable` | **yes** | *We can't tell whether anyone else is here, so the document stays open.* |
| ⑧ | `Offline` | **yes** | *The document stays open; nothing syncs until you're back.* |

Departure hysteresis re-arms when someone returns and is **extended by typing** — never close mid-sentence — capped so the contract doesn't evaporate.

### 4.1 The unlock moment — done

The product moment. In order, ~450 ms: the **caret appears** (the editor becomes editable reactively, no remount — this is the real signal, physical and silent); the band folds away; the peer's avatar enters in their colour; one self-dismissing line — *Ada is here. The document is open.*

Explicitly forbidden: sound, confetti, full-screen flash, modal. The contrast (nothing → caret) does all the work. **Never steal focus** — a background tab grabbing focus because someone joined is a hostile bug. `prefers-reduced-motion` keeps steps 1 and 4 only.

### 4.2 Waiting has to be liveable — done

This is what lets two people actually meet. Waiting is a feature, not an error screen.

No spinner — a spinner promises imminence and lies after 30 seconds. A calm dot and elapsed time (*Waiting since 14:02*). The band stays dismissable. **The primary action of waiting is `Copy invite link`**, not `Connect storage`: under this thesis, inviting someone *is* how you unblock. That inverts today's hierarchy. The tab title should reflect waiting so that waiting in one tab among twenty is practical.

### 4.3 Export is a hard requirement — done

"Export" used to mean *configure an OAuth backend and let autosave write*. That was not acceptable for a contract that promises *read, copy, export, wait*: a promised capability cannot be a side effect of OAuth setup.

`Export a copy` (`src/ui/ExportDialog.svelte` + `ExportFormats.svelte`) is the genuinely new UI surface the contract required — all four portable codecs (text/markdown/html/json) already existed, so the format falls out of the chosen extension; no codec was written. It reaches the shared `Y.Doc` through `src/editor/exportBridge.svelte.ts` (same module-level-bridge shape as the room-name bridge), bound whenever the Editor is mounted — including while write-gated, since export is a read. Reachable from two places: the read-only band itself (`SyncBanner`'s waiting tier, next to Copy invite link / Connect storage) and Settings, so it works whether or not the gate has armed. A fifth entry, `PDF (print)`, sits alongside the four codec buttons: not a codec (nothing is encoded ahead of time), it triggers the browser's native print dialog against a dedicated `src/styles/print.css` stylesheet — "Save as PDF" gives real, selectable text with zero added dependency.

Also active while read-only: text selection and copy, scrolling and outline, Share, Settings, connecting a backend, theme and identity, loading from the backend. Inactive: typing, formatting toolbar (visible but disabled — removing it would suggest a different app), slash menu, input rules, undo/redo, renaming the document (the title lives in the shared doc, so renaming is a collaborative write).

### 4.4 The escape hatch — done

The gate used to yield silently on the first keystroke. *"Read-only until you type"* is not a contract, it is a speed bump — right for a warning, self-defeating for a contract.

It is now an explicit, named button, **P2P only**, stating its cost: `Write alone anyway` → *Nothing you write will leave this device until someone joins.* (`SyncBanner.svelte`'s gated tier — rendered only while `transport === Transport.P2P`, since the hub's contract offers no escape hatch, §2.1.) Scope stays per-room, in memory, for the session; every reload re-asserts the contract (`App.svelte`'s `soloRooms`, unpersisted).

The honest cost, documented in the README: the contract is *read-only when alone by default, deliberately overridable*. That is defensible. The silent version was not.

## 5. Prerequisite: harden the room identifier — done

Was not follow-up work — a **precondition**, and small.

`newRoom()` used to generate 8 base36 characters from `Math.random()` — about 41 bits, from a non-cryptographic PRNG. Room ids are the only access control in `public` mode. Separately, a plaintext room leaks the **full SDP** over signaling, whose `a=candidate:` lines carry LAN and public IPs.

This contract made it worse: a guessed room leaked a document, and under §6 it would also leak **who is where, and when** — presence becomes a published signal, a step up in sensitivity.

Resolved: `newRoomId()` (`src/collaboration/roomId.ts`) draws room ids from `crypto.randomUUID()`, and `browserId()` (`src/collaboration/browserId.ts`) mints the same way (with a `crypto.getRandomValues` fallback). **New rooms are encrypted by default** — `newRoom()` mints a secret-link key (`#k=`) alongside the id, so a freshly created room is end-to-end encrypted from the start; the Share dialog surfaces this as the 🔒 *Encrypted* badge, so the choice is visible rather than implicit. The README states plainly what the room id protects and what it doesn't. CSPRNG room ids and encryption by default were prerequisites of the probe, not a later chore — that precondition is now satisfied.

## 6. Two modules that plug into the contract

### 6.1 The presence probe — making the rendezvous possible

If Copad only writes with company, *"is anyone there?"* becomes its most frequent question, and it must be answerable **without joining**. Otherwise every visit is a coin flip and two people three minutes apart never meet.

Both transports are probeable **with stock upstream servers** — no server ships in this repo and none needs patching: [`y-webrtc`](https://github.com/yjs/y-webrtc)'s `y-webrtc-signaling` bin, [`@y/websocket-server`](https://github.com/yjs/y-websocket-server)'s `y-websocket-server` bin.

Measured, on running prototypes:

| | WebRTC | Hub |
|---|---|---|
| Arrival | 260–270 ms (plain *and* encrypted) | 171 ms |
| Already present | 116 ms | 170 ms |
| Clean departure | 341–716 ms | 2 ms |
| **Frozen client (lid closed)** | **89 s** | **31 s** |
| Rooms per connection | **200 on one socket** | 1 |
| Server cost of being probed | 1 `Set` entry per room | **1 `Y.Doc` per room, never freed** |

Two consequences. A hall watching many rooms is **cheaper on P2P** than on the hub — the opposite of intuition. And the UX number is the frozen-client tail: the hall must say *"seen a minute ago"*, never *"present"*.

The hub row is a real cost, not a footnote: the stock server only frees a room's `Y.Doc` on disconnect if persistence is configured (`closeConn`, conditional on `persistence !== null`), and the bundled binary configures none. Probing a hub room — even once, even briefly — allocates a `Y.Doc` that outlives the probe for the life of the process. A hall watching many rooms, or anyone hostile enough to probe many room names, grows the hub's memory without bound. Mitigate at the hub's persistence layer, not in the probe.

The probe works **without the room key** — presence leaks, content does not. It needs an `unknown` arm distinct from `empty`, which is the same rule as §2.2: "I don't know" must never render as "there is nobody".

Honest limit: with no server, notification exists only while a Copad tab is open. A Service Worker does not change this. The real shape is a **hall page** left open. Arrivals are push (not throttled in background tabs); only the departure poll degrades.

### 6.2 Meeting link → room + key

The best integration asks **nobody** to install anything.

The meeting link is the only identifier every participant already has. So `room = hash(link)` and `key = hash(link, other salt)`. Everyone pastes the same video-call link and lands in the same encrypted pad — no account, no extension, no server, not even a Copad link to pass around.

The second hash is the real win: deriving the **encryption key** from the meeting link means only people holding the invitation can decrypt the pad. Access control is borrowed from the host, for free. This is *"Copad never owns identity, it borrows the host's"* achieved with no integration at all.

It is also the purest form of attaching to an existing rendezvous: the meeting **is** the rendezvous, so §6.1's probe is unnecessary in that case — which confirms the probe is the fallback for moments no host carries.

Governing principle for everything in this area: **Copad is a launcher, not an embed.** Options that embed Copad in the host (Meet, Teams, Zoom, Discord) damage the architecture most — third-party iframe means partitioned storage and host CSP, and Discord forbids WebRTC outright. Embedding destroys precisely what makes Copad: P2P, E2E, local cache. Options that *launch* Copad leave it in a top-level tab where all of it works untouched.

Two traps: Zoom meeting ids are enumerable, so the canonical form must include `pwd=`; and the derivation must be **versioned**, or a silent update splits one meeting into two pads.

## 7. What we are not doing, and why

| | Decision |
|---|---|
| **The local cache** | Never satisfies branch (b). It is browser-local, dies with the profile, and is on by default — counting it as durable would void the lock for almost everyone. It is exactly the illusion the contract exists to prevent. Kept for reading, qualified as such. |
| **Saved rooms** | A saved room **does not lock** when you are alone. Editing a cloud file in place is a real, honest use. But the exemption must be **earned continuously** (§3.2), or it re-admits the illusion through the branch we chose to keep open. |
| **Filename per room, collision warning** | Kept. Storage stays first-class, so the machinery keeping stores distinct stays justified. |
| **Leader election** | Kept — it follows from the above, and autosave-during-session remains. |
| **`?role=reader`** | Stays a strictly separate concept from the solitude lock: distinct copy, distinct iconography. One lifts by itself, the other never does; merging them would blur the central promise. |
| **The `WriteGateIntro` modal** | **Deleted.** The waiting state teaches the contract better than a modal shown once per browser — consistent with "the interface recedes", and with an intro modal already removed for that reason. |
| **A second tab of your own browser** | Still satisfies the contract — a second tab really does receive the bytes — but the UI **names it**: *"Another tab of yours is here."* No lie, and no silent loophole. |
| **Deployments with no collab server** | Said plainly rather than silently degraded. Copad without a collaboration server is not Copad; it is flagged at deploy and in the UI, so one contract holds everywhere. |
| **`Reaching` locking** | It does not lock. The premise is proven and the failure is ours. |

## 8. Order of work

1. ~~**Harden the room identifier**~~ (§5) — done, was a precondition for §6.1.
2. ~~**Presence model**~~ — `RoomPresence`, the new core hooks, memoised emission — done (§3.1).
3. ~~**`writeGate.ts`**~~ — pure decision function with a full truth table — done (§3.4).
4. ~~**Wire the gate**~~ — the commit that inverts the polarity — done (§2.2, §4.4's escape hatch). The waiting-room polish in step 6 below (banner tiers per `RoomPresence` kind, pill labels, the `Reaching` UI treatment, typing-extended departure hysteresis) is deliberately left for that step — this one only inverts the lock's polarity and replaces the silent yield with the named escape hatch.
5. ~~**Write outcome**~~ — `WriteReceipt`, `PersistHealth`, all ten adapters migrated — done (§3.2/§3.3). Non-leader diffusion of a broken leader's health across same-browser tabs (a `BroadcastChannel`, mirroring the leader-election scoping) is left for a follow-up — a non-leader tab simply stays `Unproven`, which never locks on its own, so this is a UX gap (no passive warning shown), not a soundness one.
6. ~~**The waiting room**~~ — banner tiers, pill labels, `Reaching`, hysteresis — done (§4, §4.2).
7. ~~**The unlock moment**~~ (§4.1). ~~**Export**~~ (§4.3) — done.
8. ~~**The hub's own contract**~~ — its settle/linger values, its copy, no escape hatch — done (§2.1).
9. ~~**Docs**~~ — `AGENTS.md` is now the single source of contribution rules, `docs/architecture.md` the reference doc, `CLAUDE.md` a pointer to both — done. README leads with this contract's thesis, ownership demoted to the companion clause (§1.2) — done.

Steps 2 and 3 are risk-free and separately testable. Step 4 is the one that changes behaviour.
