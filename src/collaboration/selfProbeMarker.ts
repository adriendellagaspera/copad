/**
 * A single-use marker minted by `MeetingJoinDialog` immediately before it
 * starts a presence probe and opens the new tab that probe is about to race
 * against. Threaded two ways: into `probeWebsocketPresence()` so it can
 * recognize and discard the one awareness entry that is the new tab
 * announcing itself (not a real peer), and into the new tab's URL so its own
 * `Editor.svelte` broadcasts it once connected. Distinct from `BrowserId`,
 * which is stable per browser and would also match a genuine second tab of
 * the same browser already in the room — the false positive the contract
 * (§7, "A second tab of your own browser") requires the probe to still
 * report as `someone`.
 */
export type SelfProbeMarker = string & { readonly _brand: 'SelfProbeMarker' };

export function mintSelfProbeMarker(): SelfProbeMarker {
  return crypto.randomUUID() as SelfProbeMarker;
}
