/** Single-use, never a `BrowserId`: a genuine second tab of the same browser
 *  must still count as `someone` (docs/contract.md §7). */
export type SelfProbeMarker = string & { readonly _brand: 'SelfProbeMarker' };

export function mintSelfProbeMarker(): SelfProbeMarker {
  return crypto.randomUUID() as SelfProbeMarker;
}
