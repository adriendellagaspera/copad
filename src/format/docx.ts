import type { ExportCodec } from './types.js';
import { extensionOf } from './types.js';

// Import stays dynamic: the `docx` package (~100kB gz) must not enter the main bundle.
export const docxCodec: ExportCodec = {
  id: 'docx',
  label: 'Word (.docx)',
  extensions: [extensionOf('.docx')],

  async encode(doc) {
    const { encodeDocx } = await import('./docxEncode.js');
    return encodeDocx(doc);
  },
};
