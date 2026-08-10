// contract §2: the hub relay reads rooms in the clear — the claim must come from `Transport`, never from markup.

import { Transport } from '../collaboration/types.js';
import type { CursorColor, DisplayName } from '../collaboration/types.js';

export const TransportClaim = { EndToEnd: 'end-to-end', Relayed: 'relayed' } as const;
export type TransportClaim = (typeof TransportClaim)[keyof typeof TransportClaim];

export type AboutLine = string & { readonly _brand: 'AboutLine' };

export type AboutHeading = string & { readonly _brand: 'AboutHeading' };

export type AboutUrl = string & { readonly _brand: 'AboutUrl' };

export type EncryptionClaimed = boolean & { readonly _brand: 'EncryptionClaimed' };

export interface TransportCopy {
  readonly claim: TransportClaim;
  readonly heroCaption: AboutLine;
  readonly linkTitle: AboutHeading;
  readonly linkLead: AboutLine;
  readonly linkRest: readonly AboutLine[];
  readonly linkGrant: AboutLine;
  readonly gateLead: AboutLine;
  readonly gateNote: AboutLine;
}

export interface SpecimenPeer {
  readonly name: DisplayName;
  readonly color: CursorColor;
}

const P2P: TransportCopy = {
  claim: TransportClaim.EndToEnd,
  heroCaption:
    'Rooms are encrypted in your browser. Not even our signaling server can see what you write — it forwards sealed bytes between browsers and holds no copy.' as AboutLine,
  linkTitle: 'The link is the key' as AboutHeading,
  linkLead:
    "A room's address and its key both live in the link, and the key sits after the # — the one part of a URL a browser never sends to a server." as AboutLine,
  linkRest: [
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
  linkLead:
    "A room's address lives in the link and nowhere else: it is never listed, indexed, or searchable, and guessing one is not practical." as AboutLine,
  linkRest: [
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

export function claimsEncryption(copy: TransportCopy): EncryptionClaimed {
  return (copy.claim === TransportClaim.EndToEnd) as EncryptionClaimed;
}

export const SPECIMEN_PEERS: readonly SpecimenPeer[] = [
  { name: 'Ada Lovelace' as DisplayName, color: '#2563eb' as CursorColor },
  { name: 'Kai' as DisplayName, color: '#16a34a' as CursorColor },
  { name: 'Rosa Mendes' as DisplayName, color: '#d97706' as CursorColor },
];

export const REPO_URL = 'https://github.com/adriendellagaspera/copad' as AboutUrl;
export const CONTRACT_URL = `${REPO_URL}/blob/main/docs/contract.md` as AboutUrl;
export const PRIVACY_URL =
  `${CONTRACT_URL}#2-the-two-transports-promise-different-things` as AboutUrl;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE` as AboutUrl;
export const DEPLOY_URL = `${REPO_URL}#deployment` as AboutUrl;
