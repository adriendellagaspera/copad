// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema, nodeNameOf } from './schema.js';
import { taskItemCheckboxPlugin } from './taskList.js';

function docWithTaskItem(checked: boolean) {
  const item = schema.node('task_item', { checked }, schema.node('paragraph', null, schema.text('todo')));
  const list = schema.node('task_list', null, [item]);
  return schema.node('doc', null, [list]);
}

/** Position inside the task_item's paragraph content (any pos there resolves
 *  up to the task_item at some ancestor depth). */
function posInsideTaskItem(state: EditorState): number {
  let pos = -1;
  state.doc.descendants((node, p) => {
    if (node.isTextblock && nodeNameOf(node) === 'paragraph') pos = p + 1;
  });
  if (pos === -1) throw new Error('no paragraph found');
  return pos;
}

describe('taskItemCheckboxPlugin', () => {
  const handleClick = taskItemCheckboxPlugin.props.handleClick as (
    view: unknown,
    pos: number,
    event: MouseEvent
  ) => boolean;

  it('toggles checked when a checkbox input is clicked', () => {
    const doc = docWithTaskItem(false);
    const state = EditorState.create({ schema, doc });
    let dispatched: unknown = null;
    const view = {
      state,
      dispatch: (tr: unknown) => {
        dispatched = tr;
      },
    };
    const input = document.createElement('input');
    input.type = 'checkbox';
    const event = { target: input } as unknown as MouseEvent;

    const handled = handleClick(view, posInsideTaskItem(state), event);
    expect(handled).toBe(true);
    expect(dispatched).not.toBeNull();
    const next = state.apply(dispatched as Parameters<typeof state.apply>[0]);
    expect(next.doc.firstChild?.firstChild?.attrs.checked).toBe(true);
  });

  it('ignores clicks on non-checkbox targets', () => {
    const doc = docWithTaskItem(false);
    const state = EditorState.create({ schema, doc });
    const dispatch = vi.fn();
    const view = { state, dispatch };
    const span = document.createElement('span');
    const event = { target: span } as unknown as MouseEvent;

    const handled = handleClick(view, 1, event);
    expect(handled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
