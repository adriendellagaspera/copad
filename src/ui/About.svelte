<script lang="ts">
  import Avatar from './Avatar.svelte';
  import StatusPill from './StatusPill.svelte';
  import SyncBanner from './SyncBanner.svelte';
  import { BRAND_ICONS } from './brandIcons.js';
  import { STORAGE_ID } from '../storage/constants.js';
  import { SaveStatus } from './types.js';
  import { ConnStatus, PresenceKind, Transport } from '../collaboration/types.js';
  import type { CursorColor, DisplayName } from '../collaboration/types.js';
  import type { PagePath } from '../collaboration/roomHistory.js';
  import {
    CONTRACT_URL,
    DEPLOY_URL,
    LICENSE_URL,
    PRIVACY_URL,
    REPO_URL,
    TransportClaim,
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
  const encrypted = $derived(copy.claim === TransportClaim.EndToEnd);

  const githubMark = BRAND_ICONS[STORAGE_ID.github];

  interface DemoPeer {
    readonly name: DisplayName;
    readonly color: CursorColor;
  }

  const demoPeers: readonly DemoPeer[] = [
    { name: 'Ada Lovelace' as DisplayName, color: '#2563eb' as CursorColor },
    { name: 'Kai' as DisplayName, color: '#16a34a' as CursorColor },
    { name: 'Rosa Mendes' as DisplayName, color: '#d97706' as CursorColor },
  ];

  function noop(): void {}
</script>

<div class="about">
  <div class="shell">
    <header class="capsule about-capsule">
      <a class="cap-mark" href={page} title="Copad" aria-label="Copad">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 19.5V6a2 2 0 0 1 2-2h8l6 6v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M14 4v6h6" />
        </svg>
      </a>
      <span class="wordmark">Copad</span>
      <span class="cap-fill"></span>
      <a class="cap-btn repo-link" href={REPO_URL} title="Copad on GitHub" aria-label="Copad on GitHub">
        {#if githubMark}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d={githubMark.path} /></svg>
        {/if}
      </a>
      <button class="cap-share" onclick={onNewDocument}>Start a document</button>
    </header>

    <main>
      <section class="hero">
        <h1>Write it together, in a room only your link opens.</h1>
        <p class="lede">
          Copad opens a shared page from a link. What you type goes to the people
          in the room, and to a file in a cloud you already own. There is no Copad
          account and no Copad database — nothing of yours sits on our side waiting
          to be lost, sold or subpoenaed.
        </p>
        <div class="hero-actions">
          <button class="cta" onclick={onNewDocument}>Start a document</button>
          <a class="cta-quiet" href="#rooms">See how a room works</a>
        </div>
        <p class="caption">{copy.heroCaption}</p>
      </section>

      <section class="rooms" id="rooms">
        <h2>Rooms, not documents</h2>
        <div class="rooms-body">
          <p>
            Copad gives you a room with a piece of paper on the table. While nobody
            else is in the room, nobody hears you and nobody reads what you write.
          </p>
          <p>
            When someone leaves, they leave with a copy of the text you wrote
            together, and they stop seeing what you change afterwards. They can come
            back: reopening the link while you are there catches their copy up again.
          </p>
          <p>
            Your own durable artefact is the paper in your own drawer — the file in
            the storage backend you connected. A guest never touches it.
          </p>
        </div>
      </section>

      <section class="cards" id="how" aria-label="How Copad works">
        <article class="card">
          <div class="demo demo-peers">
            {#each demoPeers as peer (peer.name)}
              <Avatar name={peer.name} color={peer.color} size={32} />
            {/each}
          </div>
          <h3>Nobody signs up</h3>
          <p>
            You pick a name and a colour in your own browser, and that is the entire
            identity system. No sign-in, no profile, no user table: the people in a
            room are whoever is holding the link right now.
          </p>
          <p class="fine">
            The avatars above are the product's own, rendered by the same component
            the editor uses.
          </p>
        </article>

        <article class="card">
          <div class="demo demo-link">
            <code class="url">
              <span class="url-path">{page}?room=</span><span class="url-id">b41f2c9e…</span
              >{#if encrypted}<span class="url-key">#k=8Qr3v…</span>{/if}
            </code>
            <StatusPill
              conn={ConnStatus.Connected}
              saveStatus={SaveStatus.Idle}
              hasStorage={false}
              {transport}
              {encrypted}
              keepLabels
            />
          </div>
          <h3>{copy.linkTitle}</h3>
          {#each copy.linkBody as line (line)}
            <p>{line}</p>
          {/each}
          <p class="fine">{copy.linkGrant}</p>
        </article>

        <article class="card">
          <div class="demo demo-banner" inert>
            <SyncBanner
              conn={ConnStatus.Waiting}
              presenceKind={PresenceKind.Alone}
              {transport}
              storageLabel={null}
              gated
              onShare={noop}
              onConnectStorage={noop}
              onWriteSolo={noop}
            />
          </div>
          <h3>It will not let you write into the void</h3>
          <p>
            {copy.gateLead} So Copad refuses to pretend: while you are alone with
            nothing durable behind the room, the document is read-only — you can still
            read, select, copy and export every word of it.
          </p>
          <p>
            It opens the moment someone joins, or the moment you connect storage of
            your own.
          </p>
          <p class="fine">{copy.gateNote}</p>
        </article>
      </section>

      <section class="where" id="where">
        <h2>Where the words go</h2>
        <p class="where-lede">
          Copad has no database, so there are exactly two places your words can be.
        </p>
        <div class="places">
          <div class="place">
            <div class="demo">
              <StatusPill
                conn={ConnStatus.Waiting}
                saveStatus={SaveStatus.Idle}
                hasStorage={false}
                {transport}
                keepLabels
              />
            </div>
            <h3>In the room</h3>
            <p>
              In the browsers of the people who are here, live, and in a cache on this
              device that dies with the browser profile. It is a convenience for
              reopening a tab, never a backup — which is exactly why the pill says
              <strong>Not saved</strong> rather than nothing.
            </p>
          </div>
          <div class="place">
            <div class="demo">
              <StatusPill
                conn={ConnStatus.Waiting}
                saveStatus={SaveStatus.Saved}
                hasStorage
                storageLabel="Dropbox"
                {transport}
                keepLabels
              />
            </div>
            <h3>In your own file</h3>
            <p>
              Connect Dropbox, pCloud, Google Drive, OneDrive, SharePoint, WebDAV, S3,
              GitHub, GitLab or a file on this disk, and Copad writes the document
              there. Your folder, your account, a format you can open without us. The
              pill only claims <strong>Saved</strong> once a write has actually landed.
            </p>
          </div>
        </div>
        <p class="fine">
          A guest never writes to your file, and you never write to theirs. Two people
          in one room, each keeping their own paper, is the normal case rather than a
          conflict to resolve.
        </p>
      </section>
    </main>

    <footer class="foot">
      <span class="foot-brand">Copad</span>
      <a href={LICENSE_URL}>MIT</a>
      <a class="foot-gh" href={REPO_URL}>
        {#if githubMark}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d={githubMark.path} /></svg>
        {/if}
        GitHub
      </a>
      <a href={CONTRACT_URL}>The contract</a>
      <a href={PRIVACY_URL}>Privacy</a>
      <a href={DEPLOY_URL}>Deploy your own</a>
    </footer>
  </div>
</div>

<style>
  /* body is overflow:hidden (base.css) — this page owns its scroll, the same way
     .content does inside the editor. */
  .about {
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
  }
  .shell {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--sp-5) var(--sp-4) var(--sp-8);
    display: flex;
    flex-direction: column;
  }

  /* app.css hides header.capsule below 900px, where the app moves to its bottom
     dock; this page has no dock, so the capsule stays. */
  @media (pointer: coarse), (max-width: 900px) {
    header.capsule.about-capsule {
      display: flex;
    }
  }
  .wordmark {
    font-size: var(--fs-400);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .about-capsule .cap-mark,
  .about-capsule .repo-link {
    text-decoration: none;
  }
  .about-capsule .repo-link {
    color: var(--text-muted);
  }
  .about-capsule .repo-link:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  main {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .hero {
    padding: var(--sp-6) 0 var(--sp-4);
  }
  h1 {
    margin: 0;
    max-width: 20ch;
    font-family: var(--font-read);
    font-size: var(--fs-800);
    font-weight: 600;
    line-height: var(--lh-tight);
    letter-spacing: -0.015em;
  }
  .lede {
    margin: var(--sp-4) 0 0;
    max-width: 58ch;
    font-family: var(--font-read);
    font-size: var(--fs-500);
    line-height: var(--lh-read);
    color: var(--text-muted);
  }
  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    margin-top: var(--sp-5);
  }
  .cta {
    min-height: 44px;
    padding: 0 var(--sp-5);
    border: 1px solid transparent;
    border-radius: var(--r-full);
    background: var(--accent);
    color: var(--accent-contrast);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease);
  }
  .cta:hover {
    background: var(--accent-hover);
  }
  .cta-quiet {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 var(--sp-3);
    color: var(--text-muted);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .cta-quiet:hover {
    color: var(--text);
  }
  .caption {
    margin: var(--sp-5) 0 0;
    max-width: 62ch;
    font-size: var(--fs-300);
    line-height: 1.5;
    color: var(--text-faint);
  }

  h2 {
    margin: 0;
    font-family: var(--font-read);
    font-size: var(--fs-700);
    font-weight: 600;
    line-height: var(--lh-tight);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-400);
    font-weight: 600;
    line-height: var(--lh-tight);
  }

  .rooms {
    padding: var(--sp-6);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .rooms-body {
    margin-top: var(--sp-4);
    max-width: 62ch;
    font-family: var(--font-read);
    font-size: var(--fs-500);
    line-height: var(--lh-read);
  }
  .rooms-body p {
    margin: 0 0 var(--sp-4);
  }
  .rooms-body p:last-child {
    margin-bottom: 0;
    color: var(--text-muted);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-4);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .card p {
    margin: 0;
    font-size: var(--fs-300);
    line-height: 1.55;
    color: var(--text-muted);
  }
  .card p.fine {
    color: var(--text-faint);
  }

  /* One shared frame for every mounted specimen: it reads as an exhibit, and the
     components inside keep their own product styling untouched. */
  .demo {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    min-height: 56px;
    padding: var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .demo-peers {
    gap: 0;
  }
  .demo-peers :global(.avatar + .avatar) {
    margin-left: -9px;
  }
  .demo-link {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-2);
  }
  .url {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--fs-300);
    color: var(--text-muted);
  }
  .url-id {
    color: var(--text);
  }
  .url-key {
    color: var(--accent);
  }
  /* The banner supplies its own surface and margin; the exhibit frame would
     double both. */
  .demo-banner {
    display: block;
    padding: 0;
    border: none;
    background: transparent;
    min-height: 0;
  }
  .demo-banner :global(.sync-banner) {
    margin-bottom: 0;
  }

  .where {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .where-lede {
    margin: 0;
    max-width: 58ch;
    font-family: var(--font-read);
    font-size: var(--fs-500);
    line-height: var(--lh-read);
    color: var(--text-muted);
  }
  .places {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-4);
  }
  .place {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .place p {
    margin: 0;
    font-size: var(--fs-300);
    line-height: 1.55;
    color: var(--text-muted);
  }
  .place strong {
    color: var(--text);
    font-weight: 600;
  }
  .where .fine {
    margin: 0;
    max-width: 62ch;
    font-size: var(--fs-300);
    line-height: 1.55;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-4);
    margin-top: var(--sp-8);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--border);
    font-size: var(--fs-300);
    color: var(--text-faint);
  }
  .foot a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    color: var(--text-muted);
    text-decoration: none;
  }
  .foot a:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .foot-brand {
    font-weight: 600;
    color: var(--text-muted);
  }
  .foot-gh svg {
    display: block;
  }

  @media (max-width: 860px) {
    .cards,
    .places {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 560px) {
    .shell {
      padding: var(--sp-4) var(--sp-3) var(--sp-8);
    }
    .about-capsule .repo-link {
      display: none;
    }
    h1 {
      font-size: var(--fs-700);
    }
    .hero-actions {
      flex-direction: column;
      align-items: stretch;
    }
    .cta,
    .cta-quiet {
      width: 100%;
      justify-content: center;
      text-align: center;
    }
    .rooms {
      padding: var(--sp-4);
    }
  }
</style>
