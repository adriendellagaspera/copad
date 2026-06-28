// ICE connection type detection — extracted from webrtcCollab so it can be
// tested and overridden per browser without touching the adapter itself.
//
// RTCStatsReport values aren't typed granularly in lib.dom.d.ts; the fields
// below are what Chrome/Firefox/Safari report for the entries we care about.
// Shape the entries we actually read so cast sites are explicit and localised.

/** How a live peer connection carries its media. */
export type IceCandidateType = 'direct' | 'relay' | 'unknown';

/** Strategy for reading the selected ICE candidate type from an RTCPeerConnection.
 *  The default (`defaultIceStatsReader`) works on every major browser via
 *  `getStats()`; inject a custom reader in tests or to handle browser quirks. */
export type IceStatsReader = (pc: RTCPeerConnection) => Promise<IceCandidateType>;

// Typed shapes for the specific getStats() entries we inspect.
// Only the fields we read are listed; extra browser-specific ones are ignored.
interface TransportStats { readonly type: 'transport'; readonly selectedCandidatePairId?: string; }
interface CandidatePairStats { readonly type: 'candidate-pair'; readonly id: string; readonly nominated?: boolean; readonly selected?: boolean; readonly state?: string; readonly localCandidateId?: string; }
interface LocalCandidateStats { readonly type: 'local-candidate'; readonly id: string; readonly candidateType?: string; }
type StatsEntry = TransportStats | CandidatePairStats | LocalCandidateStats | { readonly type: string };

/** Standard ICE stats reader — works on Chrome, Firefox, and Safari.
 *  Resolves to `'unknown'` when stats are unavailable or the PC is closed. */
export const defaultIceStatsReader: IceStatsReader = async (pc) => {
  try {
    const rows: StatsEntry[] = [];
    (await pc.getStats()).forEach((r) => rows.push(r as StatsEntry));

    let pairId: string | undefined;
    for (const r of rows) {
      if (r.type === 'transport' && (r as TransportStats).selectedCandidatePairId) {
        pairId = (r as TransportStats).selectedCandidatePairId;
      }
    }

    const pair =
      rows.find((r): r is CandidatePairStats => r.type === 'candidate-pair' && (r as CandidatePairStats).id === pairId) ??
      rows.find((r): r is CandidatePairStats => r.type === 'candidate-pair' && !!((r as CandidatePairStats).nominated || (r as CandidatePairStats).selected)) ??
      rows.find((r): r is CandidatePairStats => r.type === 'candidate-pair' && (r as CandidatePairStats).state === 'succeeded');
    if (!pair) return 'unknown';

    const local = rows.find(
      (r): r is LocalCandidateStats => r.type === 'local-candidate' && (r as LocalCandidateStats).id === pair.localCandidateId,
    );
    const t = local?.candidateType;
    if (t === 'relay') return 'relay';
    if (t) return 'direct';
    return 'unknown';
  } catch {
    return 'unknown';
  }
};
