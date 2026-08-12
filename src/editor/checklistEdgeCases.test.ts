import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { schema } from './schema.js';

function stateWithChecked(text: string, checked: boolean, cursorAtEnd = true) {
  const para = text ? schema.node('paragraph', null, schema.text(text)) : schema.node('paragraph');
  const item = schema.node('task_item', { checked }, para);
  const list = schema.node('task_list', null, [item]);
  const doc = schema.node('doc', null, [list]);
  // doc(0) > task_list(1) > task_item(2) > paragraph content starts at 3.
  const pos = cursorAtEnd ? 3 + text.length : 3;
  let state = EditorState.create({ schema, doc });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  return state;
}

function apply(state: EditorState, cmd: (state: EditorState, dispatch?: (tr: unknown) => void) => boolean) {
  let next = state;
  const applied = cmd(state, (tr) => {
    next = state.apply(tr as Parameters<typeof state.apply>[0]);
  });
  return { next, applied };
}

describe('checklist edge cases', () => {
  it('Enter on a checked item starts the new item unchecked', () => {
    const state = stateWithChecked('done', true);
    // Mirrors the keymap binding in plugins.ts, which passes an explicit `checked: false`.
    const { next, applied } = apply(state, splitListItem(schema.nodes.task_item, { checked: false }));
    expect(applied).toBe(true);
    const list = next.doc.firstChild;
    expect(list?.childCount).toBe(2);
    expect(list?.child(0).attrs.checked).toBe(true);
    expect(list?.child(1).attrs.checked).toBe(false);
  });

  it('Backspace at the start of the only item lifts it out of the list (baseKeymap liftEmptyBlock)', () => {
    const state = stateWithChecked('', false, false);
    const { applied } = apply(state, liftListItem(schema.nodes.task_item));
    expect(applied).toBe(true);
  });

  it('Tab sinks a task_item under the previous sibling (nested checklist)', () => {
    const first = schema.node('task_item', { checked: false }, schema.node('paragraph', null, schema.text('one')));
    const second = schema.node('task_item', { checked: false }, schema.node('paragraph', null, schema.text('two')));
    const list = schema.node('task_list', null, [first, second]);
    const doc = schema.node('doc', null, [list]);
    let state = EditorState.create({ schema, doc });
    let secondStart = -1;
    state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === 'two') secondStart = pos + 1;
    });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, secondStart)));
    const { next, applied } = apply(state, sinkListItem(schema.nodes.task_item));
    expect(applied).toBe(true);
    const outer = next.doc.firstChild;
    expect(outer?.childCount).toBe(1);
    const nestedList = outer?.firstChild?.lastChild;
    expect(nestedList?.type.name).toBe('task_list');
    expect(nestedList?.firstChild?.textContent).toBe('two');
  });

  it('markdown round-trips a nested checklist (sunk item survives export/import)', async () => {
    const { markdownCodec } = await import('../format/markdown.js');
    const { writePmDoc, readPmDoc } = await import('../format/pm.js');
    const Y = await import('yjs');
    const first = schema.node('task_item', { checked: false }, [
      schema.node('paragraph', null, schema.text('parent')),
      schema.node('task_list', null, [
        schema.node('task_item', { checked: true }, schema.node('paragraph', null, schema.text('child'))),
      ]),
    ]);
    const list = schema.node('task_list', null, [first]);
    const doc = new Y.Doc();
    writePmDoc(doc, schema.topNodeType.create(null, [list]));
    const bytes = await markdownCodec.encode(doc);
    const md = new TextDecoder().decode(bytes);
    expect(md).toContain('- [ ] parent');
    expect(md).toMatch(/-\s+\[x\] child/);

    const dst = new Y.Doc();
    await markdownCodec.decode(bytes, dst);
    const restored = readPmDoc(dst);
    expect(restored.firstChild?.type.name).toBe('task_list');
    const parentItem = restored.firstChild?.firstChild;
    expect(parentItem?.type.name).toBe('task_item');
    expect(parentItem?.attrs.checked).toBe(false);
    let sawNestedChecked = false;
    restored.descendants((node) => {
      if (node.type.name === 'task_item' && node.textContent === 'child') {
        sawNestedChecked = node.attrs.checked === true;
      }
    });
    expect(sawNestedChecked).toBe(true);
  });
});
