import { describe, it, expect } from 'vitest';
import { Transport } from '../collaboration/types.js';
import {
  TransportClaim,
  transportCopyFor,
  CONTRACT_URL,
  PRIVACY_URL,
  LICENSE_URL,
  DEPLOY_URL,
  REPO_URL,
  type TransportCopy,
} from './aboutCopy.js';

function everyLine(copy: TransportCopy): string[] {
  return [
    copy.heroCaption,
    copy.linkTitle,
    ...copy.linkBody,
    copy.linkGrant,
    copy.gateLead,
    copy.gateNote,
  ];
}

describe('transportCopyFor', () => {
  it('claims end-to-end encryption only on the peer-to-peer transport', () => {
    expect(transportCopyFor(Transport.P2P).claim).toBe(TransportClaim.EndToEnd);
    expect(transportCopyFor(Transport.Hub).claim).toBe(TransportClaim.Relayed);
  });

  it('never promises encryption or privacy from the server on a hub deployment', () => {
    const forbidden = /encrypt|end-to-end|e2e|only you can|nobody can (?:see|read)/i;
    for (const line of everyLine(transportCopyFor(Transport.Hub))) {
      expect(line).not.toMatch(forbidden);
    }
  });

  it('says plainly, on a hub deployment, that the relay reads the room', () => {
    const hub = everyLine(transportCopyFor(Transport.Hub)).join(' ');
    expect(hub).toMatch(/relay/i);
    expect(hub).toMatch(/in the clear|reads them|sees the text/i);
  });

  it('names the adversary rather than reciting the mechanism', () => {
    expect(transportCopyFor(Transport.P2P).heroCaption).toMatch(/not even our/i);
  });

  it('explains the unrecoverable key by its cause', () => {
    expect(transportCopyFor(Transport.P2P).linkBody.join(' ')).toMatch(
      /because the key never leaves your browser/i,
    );
  });

  it('bounds what a link grants to the session on both transports', () => {
    for (const transport of [Transport.P2P, Transport.Hub]) {
      const grant = transportCopyFor(transport).linkGrant;
      expect(grant).toMatch(/not standing access/i);
      expect(grant).not.toMatch(/non-revokable|permanently|forever|never again/i);
    }
  });

  it('never calls a hub deployment peer-to-peer', () => {
    for (const line of everyLine(transportCopyFor(Transport.Hub))) {
      expect(line).not.toMatch(/peer-to-peer|browser to browser/i);
    }
  });

  it('offers the escape hatch only where the contract has one', () => {
    expect(transportCopyFor(Transport.P2P).gateNote).toMatch(/way through/i);
    expect(transportCopyFor(Transport.Hub).gateNote).toMatch(/no override/i);
  });

  it('emits no empty string', () => {
    for (const transport of [Transport.P2P, Transport.Hub]) {
      for (const line of everyLine(transportCopyFor(transport))) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('About page links', () => {
  it('point at the repository over https', () => {
    for (const href of [REPO_URL, CONTRACT_URL, PRIVACY_URL, LICENSE_URL, DEPLOY_URL]) {
      expect(href.startsWith('https://github.com/')).toBe(true);
    }
  });

  it('treat the contract as the privacy document', () => {
    expect(PRIVACY_URL.startsWith(CONTRACT_URL)).toBe(true);
  });
});
