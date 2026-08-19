import { describe, it, expect } from 'vitest';
import { renderContractPage } from './build-docs.mjs';

describe('renderContractPage', () => {
  it('keeps the heading anchor aboutCopy.ts already links into stable', () => {
    const html = renderContractPage('## 2. The two transports promise different things\n');
    expect(html).toContain('id="2-the-two-transports-promise-different-things"');
  });

  it('strips markdown punctuation from a slug rather than hyphenating it', () => {
    const html = renderContractPage("### 3.3 Cold and Warm — a session's start\n");
    expect(html).toContain('id="33-cold-and-warm--a-sessions-start"');
  });

  it('de-duplicates repeated headings with a numeric suffix', () => {
    const html = renderContractPage('## Order\n\ntext\n\n## Order\n');
    expect(html).toContain('id="order"');
    expect(html).toContain('id="order-1"');
  });

  it('titles the page as Copad documentation, not a bare filename', () => {
    const html = renderContractPage('# The Copad contract\n');
    expect(html).toContain('<title>The contract — Copad documentation</title>');
  });

  it('renders GFM tables from the contract', () => {
    const html = renderContractPage('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
  });
});
