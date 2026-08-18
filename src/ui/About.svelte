<script lang="ts">
  import Avatar from './Avatar.svelte';
  import StatusPill from './StatusPill.svelte';
  import SyncBanner, { type Dismissible } from './SyncBanner.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import { createTheme } from './theme.svelte.js';
  import { createZoom } from './zoom.svelte.js';
  import { BRAND_ICONS } from './brandIcons.js';
  import { STORAGE_ID } from '../storage/constants.js';
  import { SaveStatus } from './types.js';
  import type { KeepSegmentLabels, StorageAttached } from './types.js';
  import type { StorageLabel } from '../storage/types.js';
  import type { WriteGateHeld } from './syncBannerTier.js';
  import { ConnStatus, PresenceKind, Transport } from '../collaboration/types.js';
  import type { PagePath } from '../collaboration/roomHistory.js';
  import {
    CONTRACT_URL,
    DEPLOY_URL,
    LICENSE_URL,
    PRIVACY_URL,
    REPO_URL,
    SPECIMEN_PEERS,
    claimsEncryption,
    transportCopyFor,
  } from './aboutCopy.js';

  let {
    onNewDocument,
    transport,
    page,
  }: {
    onNewDocument: () => void;
    transport: Transport;
    page: PagePath;
  } = $props();

  const copy = $derived(transportCopyFor(transport));
  const encrypted = $derived(claimsEncryption(copy));
  const SPECIMEN_UNSAVED = false as StorageAttached;
  const SPECIMEN_SAVED = true as StorageAttached;
  const SPECIMEN_STORAGE = 'Dropbox' as StorageLabel;
  const SPECIMEN_LABELS = true as KeepSegmentLabels;
  const SPECIMEN_GATED = true as WriteGateHeld;
  const SPECIMEN_FIXED = false as Dismissible;

  const githubMark = BRAND_ICONS[STORAGE_ID.github];
  const theme = createTheme();
  // No control here (this page has no status bar) — applies whatever zoom
  // level the reader already set from a room, since it renders the same
  // .ProseMirror the zoom scales there.
  createZoom();

  function noop(): void {}
</script>

<div class="app">
  <header class="capsule about-capsule">
    <a class="cap-mark" href={page} title="Copad" aria-label="Copad">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 19.5V6a2 2 0 0 1 2-2h8l6 6v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M14 4v6h6" />
      </svg>
    </a>
    <span class="wordmark">Copad</span>
    <span class="cap-fill"></span>
    <button class="cap-share" onclick={onNewDocument}>Start a document</button>
    <div class="cap-theme"><ThemeToggle {theme} /></div>
  </header>

  <div class="editor about-doc">
    <div class="content">
      <div class="ProseMirror">
        <div class="doc-title">
          <span class="sigil" aria-hidden="true">#</span>
          <h1>About</h1>
        </div>

        <p class="lede">
          Copad opens a shared page from a link. What you type goes to the people
          in the room, and to a file in a cloud you already own. There is no Copad
          account and no Copad database — nothing of yours sits on our side waiting
          to be lost, sold or subpoenaed.
        </p>

        <div class="demo demo-room">
          <code class="url">
            <span class="url-path">{page}?room=</span><span class="url-id">b41f2c9e…</span
            >{#if encrypted}<span class="url-key">#k=8Qr3v…</span>{/if}
          </code>
          <StatusPill
            conn={ConnStatus.Connected}
            saveStatus={SaveStatus.Idle}
            hasStorage={SPECIMEN_UNSAVED}
            {transport}
            {encrypted}
            keepLabels={SPECIMEN_LABELS}
          />
        </div>
        <p class="caption">{copy.heroCaption}</p>

        <hr />

        <h2>Rooms, not documents</h2>
        <p>
          Copad gives you a room with a piece of paper on the table. While nobody
          else is in the room, nobody hears you and nobody reads what you write.
        </p>
        <p>
          Nobody owns the room, and the room remembers nothing: the text is what
          the people in it hold between them. Walk in while others are there and
          you get all of it as it stands, not only what is written after you
          arrive. Walk in when the room is empty and you do not find an empty
          room — you find what your own device kept, nothing new.
        </p>
        <blockquote>
          So no copy is the real one. When the room empties there are only
          recollections, all equally real, and two that meet again reconcile:
          what each person wrote apart ends up in the text they share, with
          nothing lost or overwritten.
        </blockquote>
        <p class="quiet">
          The durable artefact is the paper in your own drawer — the file in a
          storage provider you connected. Anyone in the room can connect their own.
        </p>

        <hr />

        <h2>Nobody signs up</h2>
        <div class="demo demo-peers">
          {#each SPECIMEN_PEERS as peer (peer.name)}
            <Avatar name={peer.name} color={peer.color} size={32} />
          {/each}
        </div>
        <p>
          You pick a name and a colour in your own browser, and that is the entire
          identity system. No sign-in, no profile, no user table: the people in a
          room are whoever is holding the link right now.
        </p>
        <p class="fine">
          The avatars above are the product's own, rendered by the same component
          the editor uses.
        </p>

        <h3>{copy.linkTitle}</h3>
        <p>{copy.linkLead}</p>
        {#each copy.linkRest as line (line)}
          <p>{line}</p>
        {/each}
        <p class="fine">{copy.linkGrant}</p>

        <hr />

        <h2>It will not let you write into the void</h2>
        <p>{copy.gateLead}</p>
        <div class="demo demo-banner" inert>
          <SyncBanner
            dismissible={SPECIMEN_FIXED}
            conn={ConnStatus.Waiting}
            presenceKind={PresenceKind.Alone}
            {transport}
            storageLabel={null}
            gated={SPECIMEN_GATED}
            onShare={noop}
            onConnectStorage={noop}
            onWriteSolo={noop}
          />
        </div>
        <p>
          So Copad refuses to pretend: while you are alone with nothing durable
          behind the room, the document is read-only. You can still read, select,
          copy and export every word of it.
        </p>
        <p class="fine">
          It opens the moment someone joins, or the moment you connect storage of
          your own. {copy.gateNote}
        </p>

        <hr />

        <h2>Where the words go</h2>
        <p>Copad has no database, so there are exactly two places your words can be.</p>

        <h3>In the room</h3>
        <div class="demo">
          <StatusPill
            conn={ConnStatus.Waiting}
            saveStatus={SaveStatus.Idle}
            hasStorage={SPECIMEN_UNSAVED}
            {transport}
            keepLabels={SPECIMEN_LABELS}
          />
        </div>
        <p>
          In the browsers of the people who are here, live, and in a cache on this
          device that dies with the browser profile. It is a convenience for
          reopening a tab, never a backup — which is exactly why the pill says
          <strong>Not saved</strong> rather than nothing.
        </p>

        <h3>In your own file</h3>
        <div class="demo">
          <StatusPill
            conn={ConnStatus.Waiting}
            saveStatus={SaveStatus.Saved}
            hasStorage={SPECIMEN_SAVED}
            storageLabel={SPECIMEN_STORAGE}
            {transport}
            keepLabels={SPECIMEN_LABELS}
          />
        </div>
        <p>
          Connect Dropbox, pCloud, Google Drive, OneDrive, SharePoint, WebDAV, S3,
          GitHub, GitLab or a file on this disk, and Copad writes the document
          there. Your folder, your account, a format you can open without us. The
          pill only claims <strong>Saved</strong> once a write has actually landed.
        </p>
        <p class="fine">
          Nobody writes to anyone else's file. Two people in one room, each keeping
          their own paper, is the normal case rather than a conflict to resolve.
        </p>
      </div>
    </div>

    <div class="about-foot">
      <a href={LICENSE_URL}>MIT</a>
      <a class="about-foot-gh" href={REPO_URL}>
        {#if githubMark}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d={githubMark.path} /></svg>
        {/if}
        GitHub
      </a>
      <a href={CONTRACT_URL}>The contract</a>
      <a href={PRIVACY_URL}>Privacy</a>
      <span class="spacer"></span>
      <a href={DEPLOY_URL}>Deploy your own</a>
    </div>
  </div>
</div>

<style>
  /* app.css hides header.capsule below 900px for the bottom dock; this page has no dock. */
  @media (pointer: coarse), (max-width: 900px) {
    header.capsule.about-capsule {
      display: flex;
    }
    .about-doc .content {
      padding-bottom: var(--sp-4);
    }
  }
  .wordmark {
    font-size: var(--fs-400);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .about-capsule .cap-mark {
    text-decoration: none;
  }

  /* prosemirror-view's stylesheet sets .ProseMirror to break-spaces (an editable
     surface must render literal whitespace); this text is static, so reset it —
     otherwise this file's own source indentation shows up as rendered gaps. */
  .ProseMirror {
    white-space: normal;
  }

  .doc-title {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    margin: 0 0 var(--sp-2);
  }
  .doc-title .sigil {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: var(--fs-700);
    color: var(--text-faint);
    line-height: 1;
    user-select: none;
  }
  .ProseMirror .doc-title h1 {
    margin: 0;
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: var(--fs-700);
    line-height: 1.25;
  }

  .ProseMirror .lede {
    color: var(--text-muted);
  }
  .ProseMirror .quiet {
    color: var(--text-faint);
  }
  .ProseMirror .fine {
    font-size: var(--fs-300);
    color: var(--text-faint);
  }
  .ProseMirror .caption {
    margin: 0 0 var(--sp-4);
    font-size: var(--fs-300);
    color: var(--text-faint);
  }
  .ProseMirror strong {
    color: var(--text);
    font-weight: 600;
  }

  .ProseMirror .demo {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    margin: var(--sp-3) 0 var(--sp-4);
    padding: var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .ProseMirror .demo-room {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-3);
    padding: var(--sp-4);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .ProseMirror .demo-peers {
    gap: 0;
    width: fit-content;
  }
  .ProseMirror .demo-peers :global(.avatar + .avatar) {
    margin-left: -9px;
  }
  .ProseMirror .url {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--fs-300);
    color: var(--text-muted);
    background: none;
    padding: 0;
  }
  .ProseMirror .url-id {
    color: var(--text);
  }
  .ProseMirror .url-key {
    color: var(--accent);
  }
  /* The banner supplies its own surface and margin; the demo frame would double both. */
  .ProseMirror .demo-banner {
    display: block;
    margin: var(--sp-3) 0 var(--sp-4);
    padding: 0;
    border: none;
    background: transparent;
  }
  .ProseMirror .demo-banner :global(.sync-banner) {
    margin-bottom: 0;
    padding-right: var(--sp-4);
  }

  .about-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-4);
    flex: none;
    padding: var(--sp-3) var(--sp-5);
    border-top: 1px solid var(--border);
    background: var(--surface-2);
    font-size: var(--fs-300);
    color: var(--text-faint);
  }
  .about-foot a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    text-decoration: none;
  }
  .about-foot a:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .about-foot .spacer {
    margin-left: auto;
  }
  .about-foot-gh svg {
    display: block;
  }

  @media (max-width: 640px) {
    .about-foot {
      padding: var(--sp-3) var(--sp-4);
    }
  }
</style>
