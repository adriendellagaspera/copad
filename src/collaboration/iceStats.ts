// `RTCStatsReport` entries aren't typed granularly in lib.dom.d.ts, so the
// shapes below cover only the fields read here.

import { IceCandidateType } from './types.js';
export { IceCandidateType };

export interface PeerConnectionLike {
  getStats(): Promise<RTCStatsReport>;
}

export type IceStatsReader = (conn: PeerConnectionLike) => Promise<IceCandidateType>;

interface TransportStats { readonly type: 'transport'; readonly selectedCandidatePairId?: string; }
interface CandidatePairStats { readonly type: 'candidate-pair'; readonly id: string; readonly nominated?: boolean; readonly selected?: boolean; readonly state?: string; readonly localCandidateId?: string; }
interface LocalCandidateStats { readonly type: 'local-candidate'; readonly id: string; readonly candidateType?: string; }
type StatsEntry = TransportStats | CandidatePairStats | LocalCandidateStats | { readonly type: string };

export const defaultIceStatsReader: IceStatsReader = async (conn) => {
  try {
    const rows: StatsEntry[] = [];
    (await conn.getStats()).forEach((r) => rows.push(r as StatsEntry));

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
    if (!pair) return IceCandidateType.Unknown;

    const local = rows.find(
      (r): r is LocalCandidateStats => r.type === 'local-candidate' && (r as LocalCandidateStats).id === pair.localCandidateId,
    );
    const t = local?.candidateType;
    if (t === 'relay') return IceCandidateType.Relay;
    if (t) return IceCandidateType.Direct;
    return IceCandidateType.Unknown;
  } catch {
    return IceCandidateType.Unknown;
  }
};
