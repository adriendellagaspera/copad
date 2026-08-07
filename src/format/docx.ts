import type { ExportCodec } from './types.js';
import { extensionOf } from './types.js';

/**
 * Word document (.docx) — a one-way export format (#181), not a `Codec`:
 * there is no `decode`, since a Word document is never a Copad save target.
 *
 * `encode` dynamically imports docxEncode.ts, which pulls in the `docx`
 * package (~100kB gzipped) — so that cost only lands on a page that actually
 * triggers a Word export (the "Download as…" menu just needs this file's
 * cheap id/label/extensions to list the option), instead of bloating the
 * main bundle for every visitor.
 */
export const docxCodec: ExportCodec = {
  id: 'docx',
  label: 'Word (.docx)',
  extensions: [extensionOf('.docx')],

  async encode(doc) {
    const { encodeDocx } = await import('./docxEncode.js');
    return encodeDocx(doc);
  },
};
