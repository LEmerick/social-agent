/** Persona réel des personnages, compilé par le moteur (`compileAgentProfile`), pour `createAgentRuntime`. */
import { compileAgentProfile } from '@ai-reality/engine';
import type { Id } from '@ai-reality/engine';
import type { SimulationReader } from './ports.js';

/**
 * Charge les personnages et leurs buts du monde et rend la fonction `persona` attendue par `AgentRuntimeDeps`
 * (synchrone, texte stable d'un appel à l'autre : préfixe de cache du LLM).
 */
export async function personaProvider(sim: SimulationReader, worldId: Id): Promise<(characterId: Id) => string> {
  const [characters, goals] = await Promise.all([sim.characters(worldId), sim.goals(worldId)]);
  const personas = new Map<Id, string>(
    characters.map((c) => [
      c.id,
      compileAgentProfile(
        c,
        goals.filter((g) => g.characterId === c.id),
      ).personaPrompt,
    ]),
  );
  return (characterId) => {
    const persona = personas.get(characterId);
    if (persona === undefined) throw new Error(`Personnage ${characterId} absent du monde ${worldId}`);
    return persona;
  };
}
