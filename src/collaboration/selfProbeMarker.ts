/**
 * Single-use marker minted by `MeetingJoinDialog` before it opens the probe's
 * race-target tab: threaded into `probeWebsocketPresence()` to recognize and
 * discard that tab's own self-join awareness entry, and into the new tab's
 * URL so `Editor.svelte` broadcasts it back. Distinct from `BrowserId`, which
 * would also match a genuine second tab already in the room — a false
 * positive the contract (§7) requires the probe to still report as `someone`.
 */
export type SelfProbeMarker = string & { readonly _brand: 'SelfProbeMarker' };

export function mintSelfProbeMarker(): SelfProbeMarker {
  return crypto.randomUUID() as SelfProbeMarker;
}
