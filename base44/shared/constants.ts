// המודל נקבע בשכבת llm.ts (סוד CLAUDE_MODEL, ברירת מחדל claude-opus-5-5). אין fallback שקט למודל חלש.
export { DEFAULT_MODEL, modelFor, modelLabel } from './llm.ts';

export const SPEC_DOC_TYPES = ["spec", "systems_list_text", "extra_equipment"];
export const MANUAL_DOC_TYPES = ["driver_manual", "multimedia_manual", "english_manual"];
