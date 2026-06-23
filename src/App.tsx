import { useMemo, useState } from "react";
import Editor from "./Editor";
import {
  availableAdapters,
  DEFAULT_BACKEND,
  type StorageAdapter,
} from "./storage";

const COLORS = ["#e11d48", "#7c3aed", "#0891b2", "#16a34a", "#d97706", "#db2777"];
function randomColor(): string {
  return COLORS[Math.floor((Date.now() / 1000) % COLORS.length)];
}

export default function App() {
  const [name, setName] = useState("Anonymous");
  const color = useMemo(randomColor, []);

  const adapters = useMemo(availableAdapters, []);
  const [adapter, setAdapter] = useState<StorageAdapter>(
    () => adapters.find((a) => a.id === DEFAULT_BACKEND) || adapters[0],
  );
  const [connected, setConnected] = useState(() => adapter.isAuthenticated());
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = (id: string) => {
    const next = adapters.find((a) => a.id === id)!;
    setAdapter(next);
    setConnected(next.isAuthenticated());
    setCreds({});
    setError("");
  };

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await adapter.connect(adapter.credentialFields ? creds : undefined);
      setConnected(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    adapter.disconnect();
    setConnected(false);
  };

  return (
    <div className="app">
      <header>
        <h1>Copad</h1>
        <div className="controls">
          <label>
            Name&nbsp;
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Storage&nbsp;
            <select
              value={adapter.id}
              onChange={(e) => pick(e.target.value)}
              disabled={connected}
            >
              {adapters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="connect">
        {connected ? (
          <div className="connected">
            <span>✓ Connected to {adapter.label}</span>
            <button onClick={disconnect}>Disconnect</button>
          </div>
        ) : adapter.credentialFields ? (
          <form
            className="creds"
            onSubmit={(e) => {
              e.preventDefault();
              connect();
            }}
          >
            {adapter.credentialFields.map((f) => (
              <input
                key={f.name}
                type={f.type || "text"}
                placeholder={f.placeholder || f.label}
                value={creds[f.name] || ""}
                onChange={(e) =>
                  setCreds((c) => ({ ...c, [f.name]: e.target.value }))
                }
              />
            ))}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Connecting…" : `Connect ${adapter.label}`}
            </button>
          </form>
        ) : (
          <button className="primary" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : `Connect ${adapter.label}`}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {!connected && (
        <p className="hint">
          You can collaborate <strong>right now</strong> (peer-to-peer).
          Connect a storage backend to <strong>save &amp; restore</strong> the document.
        </p>
      )}

      <Editor name={name} color={color} adapter={connected ? adapter : null} />
    </div>
  );
}
