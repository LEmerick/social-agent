-- Objectifs d'appel LLM supplémentaires du jalon M5 (vérificateur, directives, interview, écriture).
ALTER TYPE "llm_purpose" ADD VALUE IF NOT EXISTS 'verify';
ALTER TYPE "llm_purpose" ADD VALUE IF NOT EXISTS 'compile_directive';
ALTER TYPE "llm_purpose" ADD VALUE IF NOT EXISTS 'interview';
ALTER TYPE "llm_purpose" ADD VALUE IF NOT EXISTS 'write';
