// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema } from './schema.js';
import { taskItemCheckboxPlugin } from './taskList.js';

function taskListState(checked = false): EditorState {
  const item = schema.node('task_item', { checked }, schema.node('paragraph', null, schema.text('todo')));
  const list = schema.node('task_list', null, [item]);
  const doc = schema.node('doc', null, [list]);
  return EditorState.create({ schema, doc });
}

const handleClick = taskItemCheckboxPlugin.props.handleClick as (
  view: { state: EditorState; dispatch: (tr: unknown) => void },
  pos: number,
  event: { target: unknown }
) => boolean;

describe('taskItemCheckboxPlugin', () => {
  it('toggles checked when the checkbox input is clicked', () => {
    const state = taskListState(false);
    let dispatched: unknown = null;
    const view = { state, dispatch: (tr: unknown) => { dispatched = tr; } };
    const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
    // Position 3 sits inside the paragraph's text, nested within the task_item.
    const handled = handleClick(view, 3, { target: input });
    expect(handled).toBe(true);
    expect(dispatched).not.toBeNull();
    const next = state.apply(dispatched as Parameters<EditorState['apply']>[0]);
    expect(next.doc.firstChild?.firstChild?.attrs.checked).toBe(true);
  });

  it('ignores clicks that are not on the checkbox', () => {
    const state = taskListState(false);
    let dispatched = false;
    const view = { state, dispatch: () => { dispatched = true; } };
    const span = document.createElement('span');
    const handled = handleClick(view, 3, { target: span });
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });
});
