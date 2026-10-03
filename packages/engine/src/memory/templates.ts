/** Gabarits français des souvenirs, par type d'event : `{A}` = acteur, `{B}` = cible. */
export type Viewpoint = 'actor' | 'target' | 'witness';

interface Template {
  /** Phrase à la première personne, selon le rôle du personnage dans l'event. */
  readonly text: Readonly<Record<Viewpoint, string>>;
  /** Émotion ressentie selon le rôle. */
  readonly emotion: Readonly<Record<Viewpoint, string>>;
  /** Intensité émotionnelle de l'épisode, 0..1. */
  readonly intensity: number;
}

const t = (
  actor: string,
  target: string,
  witness: string,
  emotions: [string, string, string],
  intensity: number,
): Template => ({
  text: { actor, target, witness },
  emotion: { actor: emotions[0], target: emotions[1], witness: emotions[2] },
  intensity,
});

export const TEMPLATES: Readonly<Record<string, Template>> = {
  alliance_proposed: t(
    'J’ai proposé une alliance à {B}.',
    '{A} m’a proposé une alliance.',
    'J’ai vu {A} proposer une alliance à {B}.',
    ['espoir', 'méfiance', 'curiosité'],
    0.6,
  ),
  alliance_formed: t(
    '{B} a accepté mon alliance.',
    'J’ai accepté l’alliance de {A}.',
    'J’ai vu {A} et {B} s’allier.',
    ['joie', 'confiance', 'inquiétude'],
    0.7,
  ),
  alliance_declined: t(
    '{B} a refusé mon alliance.',
    'J’ai refusé l’alliance de {A}.',
    'J’ai vu {B} refuser l’alliance de {A}.',
    ['déception', 'gêne', 'curiosité'],
    0.6,
  ),
  alliance_backfired: t(
    'Ma proposition d’alliance à {B} s’est très mal passée.',
    'La proposition d’alliance de {A} m’a fait sortir de mes gonds.',
    'J’ai vu la proposition d’alliance de {A} à {B} tourner mal.',
    ['honte', 'colère', 'amusement'],
    0.75,
  ),
  alliance_broken: t(
    'J’ai rompu mon alliance avec {B}.',
    '{A} a rompu notre alliance.',
    'J’ai vu {A} rompre son alliance avec {B}.',
    ['culpabilité', 'tristesse', 'surprise'],
    0.8,
  ),
  confided: t(
    'J’ai fait des confidences à {B}.',
    '{A} m’a fait des confidences.',
    'J’ai vu {A} faire des confidences à {B}.',
    ['soulagement', 'confiance', 'curiosité'],
    0.6,
  ),
  comforted: t(
    'J’ai réconforté {B}.',
    '{A} a su me réconforter.',
    'J’ai vu {A} réconforter {B}.',
    ['tendresse', 'gratitude', 'attendrissement'],
    0.5,
  ),
  compliment: t(
    'J’ai complimenté {B}.',
    '{A} m’a fait un compliment.',
    'J’ai entendu {A} complimenter {B}.',
    ['bienveillance', 'fierté', 'indifférence'],
    0.3,
  ),
  insult: t(
    'J’ai insulté {B}.',
    '{A} m’a lancé une insulte.',
    'J’ai vu {A} insulter {B}.',
    ['colère', 'colère', 'malaise'],
    0.7,
  ),
  provocation: t(
    'J’ai provoqué {B}.',
    '{A} m’a lancé une provocation.',
    'J’ai vu {A} provoquer {B}.',
    ['défi', 'irritation', 'malaise'],
    0.6,
  ),
  confrontation: t(
    'J’ai eu une dispute avec {B}.',
    'J’ai eu une dispute avec {A}.',
    'J’ai assisté à la dispute entre {A} et {B}.',
    ['colère', 'colère', 'malaise'],
    0.8,
  ),
  accusation: t(
    'J’ai accusé {B}.',
    '{A} a porté une accusation contre moi.',
    'J’ai vu {A} accuser {B}.',
    ['colère', 'peur', 'curiosité'],
    0.8,
  ),
  threat: t(
    'J’ai menacé {B}.',
    '{A} m’a lancé une menace.',
    'J’ai vu {A} menacer {B}.',
    ['tension', 'peur', 'inquiétude'],
    0.85,
  ),
  secret_shared: t(
    'J’ai partagé un secret avec {B}.',
    '{A} m’a confié un secret.',
    'J’ai surpris {A} partager un secret avec {B}.',
    ['confiance', 'confiance', 'curiosité'],
    0.7,
  ),
  rumor_spread: t(
    'J’ai fait circuler une rumeur auprès de {B}.',
    '{A} m’a rapporté une rumeur.',
    'J’ai entendu {A} répandre une rumeur auprès de {B}.',
    ['excitation', 'surprise', 'curiosité'],
    0.5,
  ),
  lie_told: t(
    'J’ai menti à {B}.',
    '{A} m’a raconté une histoire.',
    'J’ai vu {A} parler à {B}.',
    ['culpabilité', 'confiance', 'indifférence'],
    0.4,
  ),
  lie_exposed: t(
    '{B} a découvert mon mensonge.',
    'J’ai démasqué le mensonge de {A}.',
    'J’ai vu {B} démasquer le mensonge de {A}.',
    ['honte', 'colère', 'surprise'],
    0.85,
  ),
  flirted: t(
    'J’ai flirté avec {B}.',
    '{A} a flirté avec moi.',
    'J’ai vu {A} flirter avec {B}.',
    ['excitation', 'trouble', 'amusement'],
    0.5,
  ),
  feelings_expressed: t(
    'J’ai avoué mes sentiments à {B}.',
    '{A} m’a avoué ses sentiments.',
    'J’ai assisté à l’aveu de {A} à {B}.',
    ['anxiété', 'trouble', 'surprise'],
    0.85,
  ),
  apologized: t(
    'J’ai présenté mes excuses à {B}.',
    '{A} m’a présenté ses excuses.',
    'J’ai vu {A} s’excuser auprès de {B}.',
    ['regret', 'apaisement', 'curiosité'],
    0.5,
  ),
  vote_cast: t(
    'J’ai voté contre {B}.',
    'J’ai su que {A} avait voté contre moi.',
    'J’ai vu {A} voter contre {B}.',
    ['détermination', 'trahison', 'tension'],
    0.7,
  ),
  theft: t(
    'J’ai volé {B}.',
    'On m’a volé quelque chose.',
    'J’ai vu {A} voler {B}.',
    ['excitation', 'colère', 'surprise'],
    0.7,
  ),
  theft_detected: t(
    '{B} m’a pris sur le fait.',
    'J’ai surpris {A} en train de me voler.',
    'J’ai vu {B} surprendre {A} en plein vol.',
    ['honte', 'colère', 'surprise'],
    0.9,
  ),
  small_talk: t(
    'J’ai bavardé avec {B}.',
    'J’ai bavardé avec {A}.',
    'J’ai vu {A} bavarder avec {B}.',
    ['détente', 'détente', 'indifférence'],
    0.1,
  ),
};

/** Gabarit de repli pour un type d'event inconnu ; `{L}` = libellé du type. */
export const FALLBACK: Template = t(
  'Il s’est passé « {L} » avec {B}.',
  'Il s’est passé « {L} » avec {A}.',
  'J’ai vu « {L} » entre {A} et {B}.',
  ['intérêt', 'intérêt', 'curiosité'],
  0.3,
);
