// שכבת המודל: כל קריאה סמנטית באפליקציה עוברת דרך כאן, בשני מסלולים אפשריים:
//
//   base44    (ברירת מחדל) — Core.InvokeLLM של Base44 עם בחירת מודל מפורשת.
//             לא נדרש מפתח או חשבון נוסף; העלות יורדת מקרדיטי האינטגרציה של תוכנית Base44.
//             ברירת המחדל היא המודל שכבר עבד באפליקציה (gpt_5_6_sol); ניתן להחליף בסוד.
//   anthropic — חיבור ישיר ל-Anthropic API (נבחר אוטומטית כשמוגדר הסוד ANTHROPIC_API_KEY).
//             נותן שליטה ברמת המאמץ, prompt caching ושליחת PDF ישירות, בתשלום ל-Anthropic.
//
// סודות אופציונליים:
//   LLM_PROVIDER         base44 | anthropic (כופה מסלול)
//   BASE44_LLM_MODEL        מזהה המודל ב-Base44 לכל המשימות, ברירת מחדל gpt_5_6_sol
//   BASE44_LLM_WRITER_MODEL מודל לכתיבת התסריטים בלבד (למשל מודל חזק יותר רק לשלב הזה)
//   BASE44_LLM_FAST_MODEL   מודל למשימות עזר (OCR, ניתוב ראיות) — כאן מתאים מודל זול
//   CLAUDE_MODEL / CLAUDE_WRITER_MODEL / CLAUDE_FAST_MODEL — המקבילים במסלול anthropic
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';

// מסלול Anthropic: Sonnet מספיק לרוב העבודה ועולה כמחצית מ-Opus
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
// מסלול Base44: המזהה שכבר היה בשימוש באפליקציה ומוכח שעובד
export const DEFAULT_BASE44_MODEL = 'gpt_5_6_sol';

export type Tier = 'main' | 'writer' | 'fast';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Provider = 'base44' | 'anthropic';

export type LlmDocument =
  | { kind: 'pdf'; base64: string; title?: string }
  | { kind: 'image'; base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' };

export interface LlmRequest {
  /** הלקוח של Base44 מהבקשה — נדרש במסלול base44 */
  // deno-lint-ignore no-explicit-any
  base44?: any;
  /** הנחיות קבועות — במסלול anthropic נשמרות ב-prompt cache, ולכן אין להכניס לכאן נתונים משתנים */
  system?: string;
  /** תוכן הבקשה עצמה (נתוני הפרויקט, הראיות, המשימה) */
  prompt: string;
  /** JSON Schema לפלט מובנה. בלעדיו מוחזר טקסט חופשי */
  schema?: Record<string, unknown>;
  /** קבצים כתוכן מוטמע (מסלול anthropic) */
  documents?: LlmDocument[];
  /** קבצים כקישור (מסלול base44) */
  fileUrls?: string[];
  effort?: Effort;
  maxTokens?: number;
  /** 'writer' לכתיבת התסריטים, 'main' לניתוח ובדיקה, 'fast' למשימות עזר */
  tier?: Tier;
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

export function llmProvider(): Provider {
  const forced = (Deno.env.get('LLM_PROVIDER') || '').toLowerCase();
  if (forced === 'base44' || forced === 'anthropic') return forced;
  return Deno.env.get('ANTHROPIC_API_KEY') ? 'anthropic' : 'base44';
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

export function modelFor(tier: Tier = 'main'): string {
  const prefix = llmProvider() === 'base44' ? 'BASE44_LLM' : 'CLAUDE';
  const main = Deno.env.get(`${prefix}_MODEL`) || (prefix === 'BASE44_LLM' ? DEFAULT_BASE44_MODEL : DEFAULT_MODEL);
  if (tier === 'writer') return Deno.env.get(`${prefix}_WRITER_MODEL`) || main;
  if (tier === 'fast') return Deno.env.get(`${prefix}_FAST_MODEL`) || main;
  return main;
}

/** שם תצוגה למשתמש, למשל "Claude Opus 5.5" (גם למזהים בסגנון claude_opus_5_5) */
export function modelLabel(model = modelFor('main')): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(String(model).replace(/_/g, '-'));
  // מזהים כמו gpt_5_6_sol מוצגים כ-gpt-5.6-sol
  if (!m) return String(model).replace(/_(\d+)_(\d+)/, '-$1.$2').replace(/_/g, '-');
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
  return llmProvider() === 'base44' ? callBase44<T>(req) : callAnthropic<T>(req);
}

// מסלול Base44: אין system נפרד, אין effort ואין PDF מוטמע — ההנחיות מצורפות לבקשה והקבצים נשלחים כקישור
// deno-lint-ignore no-explicit-any
async function callBase44<T = any>(req: LlmRequest): Promise<LlmResult<T>> {
  if (!req.base44) throw new LlmError('שגיאת הגדרה: לא הועבר לקוח Base44 לקריאת המודל', 'config', false);
  const model = modelFor(req.tier || 'main');
  const prompt = req.system ? `${req.system}\n\n---\n\n${req.prompt}` : req.prompt;
  const params: Record<string, unknown> = { prompt, model };
  if (req.schema) params.response_json_schema = strictSchema(req.schema);
  if (req.fileUrls && req.fileUrls.length > 0) params.file_urls = req.fileUrls;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let raw: unknown;
  try {
    const call = req.base44.asServiceRole.integrations.Core.InvokeLLM(params);
    raw = req.deadlineMs
      ? await Promise.race([
        call,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new LlmError(`המודל לא סיים בתוך ${Math.round((req.deadlineMs || 0) / 1000)} שניות`, 'deadline', true)), req.deadlineMs);
        })
      ])
      : await call;
  } catch (error) {
    if (error instanceof LlmError) throw error;
    const message = String((error as Error)?.message || error);
    // חוסר בקרדיטים לא ייפתר בניסיון חוזר
    if (/credit|quota|limit exceeded|insufficient/i.test(message)) {
      throw new LlmError(`נגמרו קרדיטי האינטגרציה ב-Base44: ${message}`, 'credits', false);
    }
    if (/model/i.test(message) && /(not found|invalid|unsupported|unknown|not available)/i.test(message)) {
      throw new LlmError(`המודל ${model} אינו זמין ב-Base44 (${message}). בדקו את המזהה בסוד BASE44_LLM_MODEL`, 'bad_model', false);
    }
    throw new LlmError(`שגיאת מודל ב-Base44: ${message}`, 'api', true);
  } finally {
    if (timer) clearTimeout(timer);
  }

  let data: unknown = raw;
  if (req.schema && typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (_e) {
      throw new LlmError('המודל החזיר JSON לא תקין', 'invalid_json', true);
    }
  }
  if (req.schema && (!data || typeof data !== 'object')) {
    throw new LlmError('המודל החזיר תשובה ריקה', 'empty', true);
  }
  return {
    data: data as T,
    text: typeof raw === 'string' ? raw : JSON.stringify(raw),
    model,
    usage: {},
    stopReason: null
  };
}

// deno-lint-ignore no-explicit-any
async function callAnthropic<T = any>(req: LlmRequest): Promise<LlmResult<T>> {
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

/** קריאה מינימלית לבדיקת זמינות — מסלול מוגדר + מודל נגיש */
// deno-lint-ignore no-explicit-any
export async function pingModel(base44?: any): Promise<{ available: boolean; model: string; label: string; provider: Provider; error?: string }> {
  const model = modelFor('main');
  const provider = llmProvider();
  try {
    // בודקים את כל המודלים שהוגדרו, כדי שמזהה שגוי באחד מהם יתגלה לפני היצירה
    const checked = new Set<string>();
    for (const tier of ['main', 'writer', 'fast'] as Tier[]) {
      if (checked.has(modelFor(tier))) continue;
      checked.add(modelFor(tier));
      await callClaude({ base44, tier, prompt: 'השב במילה אחת: תקין', effort: 'low', maxTokens: 2000, deadlineMs: 30000 });
    }
    return { available: true, model, label: modelLabel(model), provider };
  } catch (error) {
    return { available: false, model, label: modelLabel(model), provider, error: (error as Error).message };
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
