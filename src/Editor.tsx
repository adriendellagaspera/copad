import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { Toolbar } from "./Toolbar";
import type { StorageAdapter } from "./storage";

const ROOM = import.meta.env.VITE_ROOM || "copad-demo";
const ROOM_PASSWORD = import.meta.env.VITE_ROOM_PASSWORD || undefined;
const SIGNALING = (import.meta.env.VITE_SIGNALING_URL || "ws://localhost:4444")
  .split(",")
  .map((s) => s.trim());

const SAVE_DEBOUNCE_MS = 3000;

type Props = {
  name: string;
  color: string;
  // The connected storage backend, or null for live-collaboration-only mode.
  adapter: StorageAdapter | null;
};

export default function Editor({ name, color, adapter }: Props) {
  const persistEnabled = !!adapter?.isAuthenticated();
  // One Y.Doc + one WebRTC transport per mounted editor.
  const ydoc = useMemo(() => new Y.Doc(), []);
  const provider = useMemo(
    () =>
      new WebrtcProvider(ROOM, ydoc, {
        signaling: SIGNALING,
        password: ROOM_PASSWORD,
      }),
    [ydoc],
  );

  const editor = useEditor({
    extensions: [
      // Collaboration brings its own undo/redo, so disable StarterKit's.
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({ provider, user: { name, color } }),
    ],
  });

  const peers = useConnectedPeers(provider);

  // Keep this peer's cursor label/colour in sync if the user renames mid-session.
  useEffect(() => {
    provider.awareness.setLocalStateField("user", { name, color });
  }, [provider, name, color]);

  // Restore the saved document from the storage backend once it's connected.
  useEffect(() => {
    if (!adapter?.isAuthenticated()) return;
    let cancelled = false;
    adapter.load().then((bytes) => {
      if (!cancelled && bytes) Y.applyUpdate(ydoc, bytes);
    });
    return () => {
      cancelled = true;
    };
  }, [ydoc, adapter]);

  // Debounced autosave. Only ONE peer (the one with the lowest client id) writes,
  // so concurrent editors don't race to overwrite the file.
  useEffect(() => {
    if (!adapter?.isAuthenticated()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const isLeader = () => {
      const ids = [...provider.awareness.getStates().keys()];
      return ids.length === 0 || ydoc.clientID === Math.min(...ids);
    };

    const flush = () => {
      if (!isLeader()) return;
      adapter.save(Y.encodeStateAsUpdate(ydoc)).catch((e) =>
        console.warn("autosave failed:", e),
      );
    };

    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    };

    ydoc.on("update", onUpdate);
    window.addEventListener("beforeunload", flush);

    return () => {
      ydoc.off("update", onUpdate);
      window.removeEventListener("beforeunload", flush);
      if (timer) clearTimeout(timer);
    };
  }, [ydoc, provider, adapter]);

  // Tear down the transport when the editor unmounts.
  useEffect(() => {
    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  return (
    <div className="editor">
      <Toolbar editor={editor} />
      <div className="status">
        <span className="dot" /> {peers} peer(s) connected · room "{ROOM}"
        {persistEnabled
          ? ` · ${adapter?.label} ✓`
          : " · storage ✗ (not connected)"}
      </div>
      <EditorContent editor={editor} className="content" />
    </div>
  );
}

// Live count of peers sharing awareness state (including this client).
function useConnectedPeers(provider: WebrtcProvider): number {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const update = () => setCount(provider.awareness.getStates().size || 1);
    update();
    provider.awareness.on("change", update);
    return () => provider.awareness.off("change", update);
  }, [provider]);
  return count;
}
