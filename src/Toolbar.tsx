import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";

// A minimal rich-text toolbar. `useEditorState` re-renders only when the queried
// flags change, so the buttons reflect the current selection without churn.
export function Toolbar({ editor }: { editor: Editor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
          }
        : null,
  });

  if (!editor || !state) return null;

  const run = (fn: () => boolean) => () => fn();

  return (
    <div className="toolbar">
      <button data-active={state.bold} onClick={run(() => editor.chain().focus().toggleBold().run())}>
        <b>B</b>
      </button>
      <button data-active={state.italic} onClick={run(() => editor.chain().focus().toggleItalic().run())}>
        <i>I</i>
      </button>
      <button data-active={state.strike} onClick={run(() => editor.chain().focus().toggleStrike().run())}>
        <s>S</s>
      </button>
      <button data-active={state.code} onClick={run(() => editor.chain().focus().toggleCode().run())}>
        {"</>"}
      </button>
      <span className="sep" />
      <button data-active={state.h1} onClick={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>
        H1
      </button>
      <button data-active={state.h2} onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>
        H2
      </button>
      <span className="sep" />
      <button data-active={state.bullet} onClick={run(() => editor.chain().focus().toggleBulletList().run())}>
        • Liste
      </button>
      <button data-active={state.ordered} onClick={run(() => editor.chain().focus().toggleOrderedList().run())}>
        1. Liste
      </button>
      <button data-active={state.quote} onClick={run(() => editor.chain().focus().toggleBlockquote().run())}>
        ❝
      </button>
      <span className="sep" />
      <button onClick={run(() => editor.chain().focus().undo().run())}>↶</button>
      <button onClick={run(() => editor.chain().focus().redo().run())}>↷</button>
    </div>
  );
}
