import type { DisplayName, CursorColor, SessionRole, PeerAwarenessState } from './types.js';

const FALLBACK_NAME = 'Anonymous' as DisplayName;
const FALLBACK_COLOR = '#888888' as CursorColor;

/**
 * Parse an unknown awareness state value arriving from a peer browser.
 * All field access is guarded — malformed peer data produces safe fallbacks.
 * This is the single cast site for DisplayName and CursorColor from network data.
 */
export function parsePeerAwarenessState(raw: unknown): PeerAwarenessState {
  const obj = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};
  const user = (typeof obj['user'] === 'object' && obj['user'] !== null)
    ? obj['user'] as Record<string, unknown>
    : {};
  const nameRaw = user['name'];
  const colorRaw = user['color'];
  const name: DisplayName = (typeof nameRaw === 'string' && nameRaw.trim())
    ? nameRaw.trim() as DisplayName
    : FALLBACK_NAME;
  const color: CursorColor = (typeof colorRaw === 'string' && /^#[0-9a-fA-F]{6}$/.test(colorRaw))
    ? colorRaw as CursorColor
    : FALLBACK_COLOR;
  const role: SessionRole = obj['role'] === 'reader' ? 'reader' : 'writer';
  const canPersist = obj['canPersist'] === true;
  return { user: { name, color }, role, canPersist };
}
