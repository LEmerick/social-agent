/**
 * Profil d'utilité de chaque action (decision-model.md §2) : appétit de base et sensibilité aux poids de décision.
 *
 * Les poids `decisionWeights` (0..1) sont centrés sur −1..+1 : un trait moyen n'oriente pas, un trait fort pousse vers
 * les actions dont le profil est positif sur ce poids, un trait faible vers celles dont il est négatif.
 */
import type { ActionId } from '../../rules/types.js';

export interface Profile {
  /** Appétit de base (comparable d'une action à l'autre). */
  readonly base: number;
  readonly coop?: number;
  readonly decep?: number;
  readonly rival?: number;
  readonly ambition?: number;
  readonly social?: number;
  readonly influence?: number;
  readonly react?: number;
  /** Loyauté : positif = sert un allié, négatif = trahit (rompre, voler, saboter). */
  readonly ally?: number;
  /** Multiplie l'affinité avec la cible (positif : on va vers ses amis ; négatif : vers ses rivaux). */
  readonly rel?: number;
  /** Multiplie la rivalité avec la cible (hostilité envers qui l'on déteste). */
  readonly riv?: number;
  /** Multiplie (1 − familiarité) : se présenter, faire connaissance. */
  readonly stranger?: number;
  /** Multiplie l'attirance de l'acteur pour la cible. */
  readonly attr?: number;
  /** Multiplie la fatigue de l'acteur (0 reposé … 1 épuisé). */
  readonly fatigue?: number;
}

const P = (base: number, rest: Omit<Profile, 'base'> = {}): Profile => ({ base, ...rest });

export const PROFILES: Readonly<Record<ActionId, Profile>> = {
  small_talk: P(0.6, { social: 0.4, coop: 0.2, rel: 0.3, stranger: 0.6 }),
  compliment: P(0.3, { coop: 0.5, social: 0.2, decep: 0.2, rel: 0.4, stranger: 0.4 }),
  confide: P(-0.2, { coop: 0.4, rel: 0.8, ally: 0.3 }),
  comfort: P(0.2, { coop: 0.8, rel: 0.5, ally: 0.3 }),
  probe: P(0.2, { decep: 0.3, ambition: 0.3, stranger: 0.5 }),
  flirt: P(-0.3, { social: 0.5, rel: 0.6, attr: 1.2 }),
  express_feelings: P(-0.5, { coop: 0.3, rel: 1.0, attr: 1.2 }),
  apologize: P(0.1, { coop: 0.8, ally: 0.2 }),
  provoke: P(-0.8, { rival: 0.8, react: 0.6, riv: 1.2, rel: -0.5, coop: -0.5 }),
  insult: P(-1.0, { rival: 0.6, react: 0.8, riv: 1.2, rel: -0.6, coop: -0.6 }),
  propose_alliance: P(0, { ambition: 0.8, influence: 0.6, coop: 0.3, rel: 0.5 }),
  break_alliance: P(-1.4, { ambition: 0.6, decep: 0.4, ally: -2.4, riv: 0.6 }),
  request_favor: P(0, { ambition: 0.4, rel: 0.3, coop: -0.2 }),
  negotiate_vote: P(0.2, { ambition: 0.6, influence: 0.6, decep: 0.3 }),
  share_secret: P(-0.2, { ally: 0.8, rel: 0.8, coop: 0.2, decep: -0.3 }),
  spread_rumor: P(-0.9, { decep: 0.8, rival: 0.5, riv: 0.8, rel: -0.4, ally: -0.6 }),
  lie: P(-0.8, { decep: 1.0, ambition: 0.3, coop: -0.3 }),
  deflect: P(-0.2),
  confront: P(-0.7, { rival: 0.6, react: 0.5, riv: 0.9, ambition: 0.2 }),
  accuse: P(-0.8, { rival: 0.6, react: 0.6, riv: 0.9 }),
  threaten: P(-1.0, { rival: 0.6, decep: 0.3, react: 0.4, riv: 0.8, ambition: 0.4 }),
  challenge: P(-0.2, { rival: 1.0, riv: 0.3 }),
  sabotage: P(-1.3, { decep: 0.9, rival: 0.5, riv: 0.9, ally: -1.0 }),
  move_to: P(0),
  avoid: P(-0.8, { riv: 0.6, social: -0.4, rel: -0.3 }),
  eavesdrop: P(-0.4, { decep: 0.6, ambition: 0.4 }),
  join_activity: P(0.3, { social: 0.4, ambition: 0.2 }),
  rest: P(-0.4, { fatigue: 2.5 }),
  search: P(0),
  pick_up: P(0.5),
  give: P(-0.4, { coop: 0.7, ally: 0.4, rel: 0.6 }),
  trade: P(-0.2, { ambition: 0.3 }),
  steal: P(-1.2, { decep: 1.0, ally: -1.0 }),
  hide: P(-0.2),
  show_item: P(-0.2, { influence: 0.2 }),
  use_item: P(0.1),
  fake_item: P(-1.0, { decep: 1.0 }),
  cast_vote: P(0, { riv: 0.8, rel: -0.6 }),
  spy_camp: P(-0.4, { decep: 0.6 }),
};
