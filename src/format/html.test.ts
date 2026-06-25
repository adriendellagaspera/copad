// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { schema } from '../editor/schema.js';
import { writePmDoc, readPmDoc } from './pm.js';
import { htmlCodec } from './html.js';

function seeded() {
  const { paragraph, heading } = schema.nodes;
  const { strong } = schema.marks;
  const doc = new Y.Doc();
  writePmDoc(
    doc,
    schema.topNodeType.create(null, [
      heading.create({ level: 2 }, schema.text('Heading')),
      paragraph.create(null, [schema.text('a '), schema.text('b', [strong.create()])]),
    ]),
  );
  return doc;
}

describe('html codec', () => {
  it('serialises to HTML tags', async () => {
    const html = new TextDecoder().decode(await htmlCodec.encode(seeded()));
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>');
  });

  it('round-trips structure and marks through HTML', async () => {
    const bytes = await htmlCodec.encode(seeded());
    const dst = new Y.Doc();
    await htmlCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(restored.textContent).toContain('Heading');
    expect(JSON.stringify(restored.toJSON())).toContain('"strong"');
  });
});
