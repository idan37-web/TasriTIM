// שכבת המודל: כל קריאה סמנטית באפליקציה עוברת דרך Claude (Anthropic API) בלבד.
// מחליף את Core.InvokeLLM — כאן אנחנו שולטים במודל, ברמת המאמץ, בפלט המובנה ובמגבלות הזמן.
//
// הגדרה: סוד ANTHROPIC_API_KEY בהגדרות האפליקציה ב-Base44 (או `base44 secrets set`).
// אופציונלי: CLAUDE_MODEL (ברירת מחדל claude-opus-5-5), CLAUDE_FAST_MODEL למשימות עזר (OCR, ניתוב ראיות).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type LlmDocument =
  | { kind: 'pdf'; base64: string; title?: string }
  | { kind: 'image'; base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' };

export interface LlmRequest {
  /** הנחיות קבועות — נשמרות ב-prompt cache, ולכן אין להכניס לכאן נתונים משתנים */
  system?: string;
  /** תוכן הבקשה עצמה (נתוני הפרויקט, הראיות, המשימה) */
  prompt: string;
  /** JSON Schema לפלט מובנה. בלעדיו מוחזר טקסט חופשי */
  schema?: Record<string, unknown>;
  documents?: LlmDocument[];
  effort?: Effort;
  maxTokens?: number;
  /** 'main' לכתיבה, ניתוח ובדיקה; 'fast' למשימות עזר */
  tier?: 'main' | 'fast';
  /** תקרת זמן קשיחה לקריאה (מ"ש). פונקציות Base44 נקטעות אחרי ~120 שניות */
  deadlineMs?: number;
}

export interface LlmResult<T = unknown> {
  data: T;
  text: string;
  model: string;
  usage: Record<string, unknown>;
  stopReason: string | null;
}

export class LlmError extends Error {
  retryable: boolean;
  code: string;
  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new LlmError('חסר הסוד ANTHROPIC_API_KEY בהגדרות האפליקציה — לא ניתן להפעיל את המודל', 'missing_key', false);
  }
  if (!client) client = new Anthropic({ apiKey, maxRetries: 2 });
  return client;
}

export function modelFor(tier: 'main' | 'fast' = 'main'): string {
  const main = Deno.env.get('CLAUDE_MODEL') || DEFAULT_MODEL;
  if (tier === 'fast') return Deno.env.get('CLAUDE_FAST_MODEL') || main;
  return main;
}

/** שם תצוגה למשתמש, למשל "Claude Opus 5.5" */
export function modelLabel(model = modelFor('main')): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(model);
  if (!m) return model;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}

// Structured outputs דורש additionalProperties=false בכל אובייקט. כל השדות מסומנים כחובה —
// כך המודל לעולם אינו "שוכח" שדה, והקוד שלנו לא צריך לנחש ברירות מחדל.
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    out[key] = key === 'enum' || key === 'required' ? value : strictSchema(value);
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}

function documentBlocks(documents: LlmDocument[] = []): Anthropic.Beta.BetaContentBlockParam[] {
  return documents.map((doc) => doc.kind === 'pdf'
    ? {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 },
      ...(doc.title ? { title: doc.title } : {})
    } as Anthropic.Beta.BetaContentBlockParam
    : {
      type: 'image',
      source: { type: 'base64', media_type: doc.mediaType, data: doc.base64 }
    } as Anthropic.Beta.BetaContentBlockParam);
}

// deno-lint-ignore no-explicit-any
export async function callClaude<T = any>(req: LlmRequest): Promise<LlmResult<T>> {
  const anthropic = getClient();
  const model = modelFor(req.tier || 'main');
  const controller = new AbortController();
  const timer = req.deadlineMs ? setTimeout(() => controller.abort(), req.deadlineMs) : null;

  const params: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens || 16000,
    betas: ['server-side-fallback-2026-07-01'],
    // אם מסווג הבטיחות של המודל דוחה בקשה (נדיר בתוכן רכב), היא מורצת אוטומטית על מודל חלופי
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: {
      effort: req.effort || 'medium',
      ...(req.schema ? { format: { type: 'json_schema', schema: strictSchema(req.schema) } } : {})
    },
    messages: [{
      role: 'user',
      content: [...documentBlocks(req.documents), { type: 'text', text: req.prompt }]
    }]
  };
  if (req.system) {
    params.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
  }

  let message: Anthropic.Beta.BetaMessage;
  try {
    // streaming מונע ניתוק HTTP בתשובות ארוכות; finalMessage מרכיב את התשובה המלאה
    const stream = anthropic.beta.messages.stream(
      params as unknown as Anthropic.Beta.MessageCreateParamsStreaming,
      { signal: controller.signal, maxRetries: req.deadlineMs ? 1 : 2 }
    );
    message = await stream.finalMessage();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmError(`המודל לא סיים בתוך ${Math.round((req.deadlineMs || 0) / 1000)} שניות`, 'deadline', true);
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new LlmError('מפתח ה-API של Anthropic אינו תקין', 'auth', false);
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new LlmError(`בקשה לא תקינה למודל: ${error.message}`, 'bad_request', false);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new LlmError('חריגה ממגבלת הקצב של Anthropic — נסו שוב בעוד רגע', 'rate_limit', true);
    }
    if (error instanceof Anthropic.APIError) {
      throw new LlmError(`שגיאת Anthropic (${error.status}): ${error.message}`, 'api', true);
    }
    throw new LlmError(`תקלת תקשורת עם המודל: ${(error as Error).message}`, 'network', true);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (message.stop_reason === 'refusal') {
    throw new LlmError('המודל סירב לבקשה', 'refusal', false);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new LlmError('תשובת המודל נקטעה (max_tokens) — יש לצמצם את הבקשה', 'max_tokens', true);
  }

  const textBlocks = message.content.filter((b) => b.type === 'text') as Anthropic.Beta.BetaTextBlock[];
  const text = textBlocks.map((b) => b.text).join('').trim();
  let data: unknown = text;
  if (req.schema) {
    try {
      data = JSON.parse(text);
    } catch (_e) {
      throw new LlmError('המודל החזיר JSON לא תקין', 'invalid_json', true);
    }
  }

  return {
    data: data as T,
    text,
    model: message.model,
    usage: message.usage as unknown as Record<string, unknown>,
    stopReason: message.stop_reason
  };
}

/** קריאה מינימלית לבדיקת זמינות — מפתח תקין + מודל נגיש */
export async function pingModel(): Promise<{ available: boolean; model: string; label: string; error?: string }> {
  const model = modelFor('main');
  try {
    await callClaude({ prompt: 'השב במילה אחת: תקין', effort: 'low', maxTokens: 2000, deadlineMs: 30000 });
    return { available: true, model, label: modelLabel(model) };
  } catch (error) {
    return { available: false, model, label: modelLabel(model), error: (error as Error).message };
  }
}

export async function fetchAsBase64(url: string): Promise<{ base64: string; bytes: Uint8Array }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`הורדת הקובץ נכשלה (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { base64: bytesToBase64(bytes), bytes };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
