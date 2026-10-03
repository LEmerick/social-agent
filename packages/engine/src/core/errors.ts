/**
 * Erreur métier typée. Le `code` est stable et peut être testé ; le `message` est destiné aux humains.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
