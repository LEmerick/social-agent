/** Types échangés avec le serveur de jeu (miroir de @ai-reality/play ; le web n'en dépend pas à la compilation). */
export interface PlayOption {
  readonly n: number;
  readonly label: string;
  readonly group?: string;
}

export interface PlayRequest {
  readonly id: string;
  readonly kind: 'destination' | 'action' | 'outcome';
  readonly epoch: number;
  readonly tick: number;
  readonly time: string;
  readonly prompt: string;
  readonly options: readonly PlayOption[];
  readonly context: { readonly place: string; readonly zone: string | null; readonly present: readonly string[] };
}

export type PlayEventKind = 'heard' | 'seen' | 'arrived' | 'left' | 'learned' | 'relation' | 'credits' | 'status';

export interface PlayEvent {
  readonly seq: number;
  readonly epoch: number;
  readonly tick: number;
  readonly time: string;
  readonly kind: PlayEventKind;
  readonly text: string;
}

export interface PlayMap {
  readonly locations: readonly { readonly id: string; readonly name: string; readonly zones: readonly string[] }[];
  readonly routes: readonly { readonly from: string; readonly to: string; readonly minutes: number }[];
}

export interface Player {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface PlayerStatus {
  readonly name: string;
  readonly status: string;
  readonly stats: Readonly<Record<string, number>>;
  readonly credits: number;
  readonly place: string | null;
  readonly placeId: string | null;
  readonly zone: string | null;
  readonly moving: boolean;
  readonly present: readonly string[];
}

export interface PlayClock {
  readonly epoch: number;
  readonly tick: number;
  readonly ticksPerEpoch: number;
  readonly time: string;
}

export interface PlayerRelation {
  readonly otherId: string;
  readonly name: string;
  readonly acquaintance: string;
  readonly axes: Readonly<Record<string, number>>;
  readonly labels: readonly string[];
}

export interface PlayerKnowledge {
  readonly factId: string;
  readonly text: string;
  readonly source: string;
  readonly belief: string;
  readonly confidence: number;
}

export interface EpochSummary {
  readonly epoch: number;
  readonly creditsBefore: number;
  readonly creditsAfter: number;
  readonly statusBefore: string;
  readonly statusAfter: string;
  readonly relationChanges: readonly {
    readonly name: string;
    readonly deltas: Readonly<Record<string, number>>;
    readonly magnitude: number;
  }[];
  readonly interactions: number;
  readonly learned: number;
}

export interface EpochEnd {
  readonly kind: 'epoch_end';
  readonly summary: EpochSummary;
  readonly hasNext: boolean;
}

export interface Character {
  readonly slug: string;
  readonly name: string;
}
