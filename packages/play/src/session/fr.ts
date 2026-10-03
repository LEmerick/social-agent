/**
 * Vocabulaire français du jeu : libellés des actions, des issues, des axes de relation, des statuts, heure simulée.
 * Aucune logique de jeu ici : uniquement de la mise en mots.
 */
import type { ActionOption, CharacterStatus, FactNode, Id, SimState } from '@ai-reality/engine';

/** [infinitif, 2e personne, 3e personne, complément, préposition devant la cible]. */
type Verb = readonly [inf: string, v2: string, v3: string, complement: string, prep: '' | 'à'];

const VERBS: Readonly<Record<string, Verb>> = {
  small_talk: ['discuter avec', 'discutes avec', 'discute avec', '', ''],
  compliment: ['complimenter', 'complimentes', 'complimente', '', ''],
  confide: ['se confier à', 'te confies à', 'se confie à', '', ''],
  comfort: ['réconforter', 'réconfortes', 'réconforte', '', ''],
  probe: ['sonder', 'sondes', 'sonde', '', ''],
  flirt: ['flirter avec', 'flirtes avec', 'flirte avec', '', ''],
  express_feelings: ['avouer ses sentiments à', 'avoues tes sentiments à', 'avoue ses sentiments à', '', ''],
  apologize: ['s’excuser auprès de', 't’excuses auprès de', 's’excuse auprès de', '', ''],
  provoke: ['provoquer', 'provoques', 'provoque', '', ''],
  insult: ['insulter', 'insultes', 'insulte', '', ''],
  propose_alliance: ['proposer', 'proposes', 'propose', 'une alliance', 'à'],
  break_alliance: ['rompre l’alliance avec', 'romps l’alliance avec', 'rompt l’alliance avec', '', ''],
  request_favor: ['demander', 'demandes', 'demande', 'un service', 'à'],
  negotiate_vote: ['négocier un vote avec', 'négocies un vote avec', 'négocie un vote avec', '', ''],
  share_secret: ['confier', 'confies', 'confie', 'un secret', 'à'],
  spread_rumor: ['répandre', 'répands', 'répand', 'une rumeur', 'à'],
  lie: ['mentir à', 'mens à', 'ment à', '', ''],
  deflect: [
    'détourner la conversation avec',
    'détournes la conversation avec',
    'détourne la conversation avec',
    '',
    '',
  ],
  confront: ['confronter', 'confrontes', 'confronte', '', ''],
  accuse: ['accuser', 'accuses', 'accuse', '', ''],
  threaten: ['menacer', 'menaces', 'menace', '', ''],
  challenge: ['défier', 'défies', 'défie', '', ''],
  sabotage: ['saboter', 'sabotes', 'sabote', '', ''],
  avoid: ['éviter', 'évites', 'évite', '', ''],
  eavesdrop: ['écouter discrètement', 'écoutes discrètement', 'écoute discrètement', '', ''],
  give: ['donner un objet à', 'donnes un objet à', 'donne un objet à', '', ''],
  trade: ['échanger avec', 'échanges avec', 'échange avec', '', ''],
  steal: ['voler', 'voles', 'vole', '', ''],
  show_item: ['montrer un objet à', 'montres un objet à', 'montre un objet à', '', ''],
  cast_vote: ['voter contre', 'votes contre', 'vote contre', '', ''],
};

/** Actions sans cible : [libellé de menu, 2e personne, 3e personne]. */
const SOLO: Readonly<Record<string, readonly [menu: string, v2: string, v3: string]>> = {
  rest: ['Se reposer', 'te reposes', 'se repose'],
  search: ['Fouiller les lieux', 'fouilles les lieux', 'fouille les lieux'],
  pick_up: ['Ramasser un objet', 'ramasses un objet', 'ramasse un objet'],
  hide: ['Cacher un objet', 'caches un objet', 'cache un objet'],
  use_item: ['Utiliser un objet', 'utilises un objet', 'utilise un objet'],
  fake_item: ['Fabriquer un faux objet', 'fabriques un faux objet', 'fabrique un faux objet'],
  spy_camp: ['Espionner un camp adverse', 'espionnes un camp adverse', 'espionne un camp adverse'],
  join_activity: ['S’inscrire à une activité', 't’inscris à une activité', 's’inscrit à une activité'],
  move_to: ['Changer de lieu', 'changes de lieu', 'change de lieu'],
};

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const nameOf = (state: Readonly<SimState>, id: Id | null): string =>
  id === null ? '' : (state.characters[id]?.firstName ?? id);

/** « Alexandre », « toi » ne s’emploie pas ici : voir `narrate` pour les phrases à la 2e personne. */
export function factText(state: Readonly<SimState>, fact: FactNode): string {
  const subject = fact.subjectId === null ? '' : nameOf(state, fact.subjectId);
  const object = fact.objectText ?? (fact.objectId === null ? '' : nameOf(state, fact.objectId));
  if (fact.predicate === 'hides') return `${subject} ${object}`.trim();
  return [subject, fact.predicate.replaceAll('_', ' '), object].filter((p) => p !== '').join(' ');
}

/** Libellé de menu d’une option du catalogue : « Complimenter Sarah », « Confier un secret à Sarah : … ». */
export function optionLabel(state: Readonly<SimState>, o: ActionOption): string {
  const target = nameOf(state, o.targetId);
  const solo = SOLO[o.action];
  if (solo) return solo[0];
  const verb = VERBS[o.action];
  if (!verb) return o.targetId === null ? o.action : `${o.action} → ${target}`;
  const [inf, , , complement, prep] = verb;
  const head = [inf, complement].filter((p) => p !== '').join(' ');
  const base = capitalize(prep === 'à' ? `${head} à ${target}` : `${head} ${target}`);
  const fact = o.factId === null ? undefined : state.facts[o.factId];
  return fact ? `${base} : « ${factText(state, fact)} »` : base;
}

/** Groupe d’affichage d’une option : la personne visée, sinon « Seul ». */
export const optionGroup = (state: Readonly<SimState>, o: ActionOption): string =>
  o.targetId === null ? 'Seul' : `Avec ${nameOf(state, o.targetId)}`;

/** Réaction de la cible : [3e personne, 2e personne], du point de vue de la cible. */
const REACTIONS: Readonly<Record<string, readonly [string, string]>> = {
  accepted: ['accepte', 'acceptes'],
  accepted_conditional: ['accepte sous condition', 'acceptes sous condition'],
  deflected: ['esquive', 'esquives'],
  refused: ['refuse', 'refuses'],
  backfired: ['retourne la situation', 'retournes la situation'],
  escalated: ['s’emporte', 't’emportes'],
  believed: ['y croit', 'y crois'],
  doubted: ['a des doutes', 'as des doutes'],
  disbelieved: ['n’y croit pas', 'n’y crois pas'],
  won: ['perd', 'perds'],
  lost: ['gagne', 'gagnes'],
  draw: ['fait match nul', 'fais match nul'],
};

/** Libellé de choix d’une issue pour le joueur ciblé (il réagit). */
export const OUTCOME_CHOICE: Readonly<Record<string, string>> = {
  accepted: 'Accepter',
  accepted_conditional: 'Accepter sous condition',
  deflected: 'Esquiver',
  refused: 'Refuser',
  backfired: 'Retourner la situation contre lui',
  escalated: 'Monter d’un cran',
  believed: 'Y croire',
  doubted: 'Avoir des doutes',
  disbelieved: 'Ne pas y croire',
  won: 'Perdre',
  lost: 'Gagner',
  draw: 'Match nul',
  detected: 'Y voir un mensonge',
};

/** Ce que la cible fait, vu de l’extérieur ; vide si l’issue n’a pas de sens pour un témoin. */
export function reactionOf(outcome: string | null, targetName: string, targetIsYou: boolean): string {
  const r = outcome === null ? undefined : REACTIONS[outcome];
  if (!r) return '';
  return targetIsYou ? `tu ${r[1]}` : `${targetName} ${r[0]}`;
}

/**
 * Phrase d’une interaction telle que la perçoit `viewerId`. Les actions couvertes (mensonge) sont décrites sans
 * révéler leur nature à ceux qui ne sont pas l’acteur.
 */
export function narrate(
  state: Readonly<SimState>,
  viewerId: Id,
  action: string,
  actorId: Id,
  targetId: Id | null,
  outcome: string | null,
): string {
  const actorIsYou = actorId === viewerId;
  const targetIsYou = targetId === viewerId;
  const actor = actorIsYou ? 'Tu' : nameOf(state, actorId);
  const target = nameOf(state, targetId);
  // Pour un témoin ou une cible, un mensonge ressemble à une confidence.
  const shown = !actorIsYou && action === 'lie' ? 'confide' : action;
  const solo = SOLO[shown];
  let sentence: string;
  if (solo) {
    sentence = `${actor} ${actorIsYou ? solo[1] : solo[2]}`;
  } else {
    const verb = VERBS[shown];
    sentence = verb ? fromVerb(verb, actor, actorIsYou, target, targetIsYou) : `${actor} : ${shown}`;
  }
  const reaction = reactionOf(outcome, target, targetIsYou);
  const tail = reaction === '' || targetId === null ? '' : ` — ${reaction}`;
  return `${sentence.replace(/\s+/g, ' ').trim()}${tail}.`;
}

function fromVerb(verb: Verb, actor: string, actorIsYou: boolean, target: string, targetIsYou: boolean): string {
  const [, v2, v3, complement, prep] = verb;
  const conj = actorIsYou ? v2 : v3;
  const tailComplement = complement === '' ? '' : ` ${complement}`;
  if (targetIsYou) {
    // Verbes à particule (« discute avec », « se confie à ») : « avec toi » ; sinon le pronom passe avant le verbe.
    const particle = /^(.*?)( avec| à| auprès de| contre)$/.exec(conj);
    if (particle) return `${actor} ${particle[1] ?? ''}${particle[2] ?? ''} toi${tailComplement}`;
    return `${actor} ${/^[aeiouyhéèêâîô]/i.test(conj) ? 't’' : 'te '}${conj}${tailComplement}`;
  }
  return `${actor} ${conj}${tailComplement}${prep === 'à' ? ' à' : ''} ${target}`;
}

export const AXIS_FR: Readonly<Record<string, string>> = {
  trust: 'confiance',
  affection: 'affection',
  rivalry: 'rivalité',
  respect: 'respect',
  fear: 'crainte',
  attraction: 'attirance',
  alliance: 'alliance',
};

export const STAT_FR: Readonly<Record<string, string>> = {
  energy: 'énergie',
  morale: 'moral',
  popularity: 'popularité',
  influence: 'influence',
  reputation: 'réputation',
};

export const STATUS_FR: Readonly<Record<CharacterStatus, string>> = {
  active: 'en jeu',
  restricted: 'restreint (crédits bas)',
  elimination_pending: 'menacé d’élimination',
  eliminated: 'éliminé',
  paused: 'en pause',
};

export const ACQUAINTANCE_FR: Readonly<Record<string, string>> = {
  known_of: 'connu de nom',
  met: 'rencontré',
  acquainted: 'connaissance',
  close: 'proche',
};

export const SOURCE_FR: Readonly<Record<string, string>> = {
  seeded: 'tu le sais depuis toujours',
  public: 'c’est public',
  witnessed: 'tu l’as vu',
  overheard: 'tu l’as surpris',
  told: 'on te l’a dit',
  inferred: 'tu l’as déduit',
};

export const BELIEF_FR: Readonly<Record<string, string>> = {
  believes: 'tu y crois',
  doubts: 'tu en doutes',
  disbelieves: 'tu n’y crois pas',
};

/** Heure simulée d’un tick (HH:MM), à partir de l’heure de départ du monde et du pas d’un tick. */
export function clockOf(config: SimState['world']['config'], tick: number): string {
  const startMinutes = Math.floor(config.startMs / 60_000) % 1440;
  const total = (startMinutes + tick * config.tickMinutes) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
