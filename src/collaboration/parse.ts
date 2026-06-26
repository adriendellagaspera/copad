import type { DisplayName, CursorColor, SessionRole, PeerAwarenessState, RoomId } from './types.js';
import { FALLBACK_NAME, FALLBACK_COLOR } from './peerDefaults.js';

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

/** Parse a raw string from storage as a RoomId — the single cast site for RoomId from localStorage. */
export function parseRoomId(raw: string): RoomId | null {
  const trimmed = raw.trim();
  return trimmed ? (trimmed as RoomId) : null;
}
