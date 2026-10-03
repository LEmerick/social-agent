/** Constats du rejeu et de l'audit : une ligne par anomalie, lisible par un humain et exploitable par une machine. */

export type FindingKind =
  | 'epoch_unfinished'
  | 'epoch_gap'
  | 'commit_mismatch'
  | 'seq_gap'
  | 'tick_gap'
  | 'effect_orphan'
  | 'effect_value'
  | 'projection'
  | 'status'
  | 'score'
  | 'ledger'
  | 'knowledge'
  | 'presence'
  | 'state_missing';

export interface Finding {
  readonly kind: FindingKind;
  /** Numéro d'époque concerné, ou `null` pour une anomalie qui touche tout le monde. */
  readonly epoch: number | null;
  readonly message: string;
  /** Chemin de la valeur projetée (`char.<id>.credits`, `rel.<a>><b>.trust`…) quand il y en a un. */
  readonly path?: string;
  readonly replayed?: unknown;
  readonly stored?: unknown;
}

/** Écart entre l'état rejoué depuis le journal et les projections stockées. */
export type ReplayDiff = Finding;
