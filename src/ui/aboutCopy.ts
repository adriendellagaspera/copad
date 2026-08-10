/** The transport-dependent half of the About page, as a pure function.
 *
 *  `docs/contract.md` §2: peer-to-peer is end-to-end encrypted, the hub relay
 *  reads everything in the clear. A page that claims encryption on a hub
 *  deployment is worse than no page, so the claim is derived from `Transport`
 *  here — with a unit test standing over it — rather than written inline in
 *  markup where a later edit could quietly detach it. */

import { Transport } from '../collaboration/types.js';

/** What this deployment may honestly claim about who can read a room. */
export const TransportClaim = { EndToEnd: 'end-to-end', Relayed: 'relayed' } as const;
export type TransportClaim = (typeof TransportClaim)[keyof typeof TransportClaim];

/** A sentence of About-page prose. */
export type AboutLine = string & { readonly _brand: 'AboutLine' };

/** A section or card title on the About page. */
export type AboutHeading = string & { readonly _brand: 'AboutHeading' };

/** A destination the About page links to. */
export type AboutHref = string & { readonly _brand: 'AboutHref' };

export interface TransportCopy {
  readonly claim: TransportClaim;
  /** One line under the hero, naming who can and cannot read a room. */
  readonly heroCaption: AboutLine;
  readonly linkTitle: AboutHeading;
  readonly linkBody: readonly AboutLine[];
  /** What holding the link actually grants — bounded to the session, never standing access. */
  readonly linkGrant: AboutLine;
  /** Why writing alone is refused on this transport — the cause, not the rule. */
  readonly gateLead: AboutLine;
  /** How the write gate ends on this transport: an override, or none. */
  readonly gateNote: AboutLine;
}

const P2P: TransportCopy = {
  claim: TransportClaim.EndToEnd,
  heroCaption:
    'Rooms are encrypted in your browser. Not even our signaling server can see what you write — it forwards sealed bytes between browsers and holds no copy.' as AboutLine,
  linkTitle: 'The link is the key' as AboutHeading,
  linkBody: [
    "A room's address and its key both live in the link, and the key sits after the # — the one part of a URL a browser never sends to a server." as AboutLine,
    'Because the key never leaves your browser, nobody can recover it for you. Lose the link and the room is gone; there is no account it hangs off, and no list of rooms anywhere.' as AboutLine,
  ],
  linkGrant:
    'A link invites someone into the room while you are both in it. What they read, they keep; what you write after they leave, they do not get. It is not standing access to a document.' as AboutLine,
  gateLead:
    'Writing alone in a peer-to-peer room is talking to an empty room: nothing leaves this browser, and the cache it lands in dies with the browser profile.' as AboutLine,
  gateNote:
    'There is always a way through, and the button says what it costs before you press it.' as AboutLine,
};

const HUB: TransportCopy = {
  claim: TransportClaim.Relayed,
  heroCaption:
    'Rooms are unlisted, and relayed. This deployment passes every edit through a collaboration server, which reads them in the clear — so treat a room as private from search engines, not from whoever runs the relay.' as AboutLine,
  linkTitle: 'The link is the address' as AboutHeading,
  linkBody: [
    "A room's address lives in the link and nowhere else: it is never listed, indexed, or searchable, and guessing one is not practical." as AboutLine,
    'The relay is the exception. It holds the room open so latecomers catch up, which means it sees the text. Whoever operates it could read the room; nobody else can find it.' as AboutLine,
  ],
  linkGrant:
    'A link invites someone into the room while you are both in it. What they read, they keep; what you write after they leave, they do not get. It is not standing access to a document — but assume the relay saw everything that passed through it.' as AboutLine,
  gateLead:
    'Writing alone here is talking to an empty room. Nobody is receiving a word of it, and a relay holding your text in memory until it restarts is not your document.' as AboutLine,
  gateNote:
    'Here the server keeps the list of who is present, so when it says you are alone, you are. There is no override, because there would be nothing honest to override with.' as AboutLine,
};

export function transportCopyFor(transport: Transport): TransportCopy {
  return transport === Transport.P2P ? P2P : HUB;
}

export const REPO_URL = 'https://github.com/adriendellagaspera/copad' as AboutHref;
export const CONTRACT_URL = `${REPO_URL}/blob/main/docs/contract.md` as AboutHref;
export const PRIVACY_URL =
  `${CONTRACT_URL}#2-the-two-transports-promise-different-things` as AboutHref;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE` as AboutHref;
export const DEPLOY_URL = `${REPO_URL}#deployment` as AboutHref;
