// המודל נקבע בשכבת llm.ts (סוד CLAUDE_MODEL, ברירת מחדל claude-opus-5-5). אין fallback שקט למודל חלש.
export { DEFAULT_MODEL, modelFor, modelLabel } from './llm.ts';

// תאימות לאחור: פונקציות ישנות שעדיין מייבאות את הקבועים האלה ממשיכות לעבוד בזמן עדכון הדרגתי
export const REQUIRED_MODEL = "gpt_5_6_sol";
export const REQUIRED_MODEL_LABEL = "gpt-5.6-sol";

export const SPEC_DOC_TYPES = ["spec", "systems_list_text", "extra_equipment"];
export const MANUAL_DOC_TYPES = ["driver_manual", "multimedia_manual", "english_manual"];
