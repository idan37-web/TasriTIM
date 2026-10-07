// מקור אמת יחיד ל-QA של התסריטים: בדיקה דטרמיניסטית + Language/Content QA + Auto-Repair ממוקד.
// משמש גם את generateVehicleScripts (action=qa) וגם את runScriptQualityAudit — אין שתי הגדרות ל-"passed".

import { callClaude } from './llm.ts';
import { runDeterministicAudit } from './qa.ts';

export const MAX_REPAIR_ROUNDS = 2;
const QA_BATCH_CHARS = 25000;   // תקציב batch בטוח — אין truncation שקט של narration
const CONCURRENCY = 3;
const WORDS_PER_MINUTE = 130;

const BLOCKING_CATEGORIES = ['meta_process_text', 'language_error', 'unsafe_absolute_claim', 'other_blocking'];

export function dedupe(list) {
  return [...new Set((list || []).filter((x) => x != null && String(x).trim() !== '').map((x) => String(x)))];
}

export function normalizeNarrationEnding(narration) {
  const text = String(narration || '').replace(/\s*\(הפסקה ארוכה\)\s*/g, ' ').trim();
  return text ? `${text}\n\n(הפסקה ארוכה)` : '';
}

// מטריקות מחושבות בצד השרת מהנוסח הסופי — אין הסתמכות על מספרים שהמודל החזיר.
export function scriptMetrics(narration) {
  const wordCount = String(narration || '').split(/\s+/).filter(Boolean).length;
  return {
    word_count: wordCount,
    estimated_duration_minutes: Math.round((wordCount / WORDS_PER_MINUTE) * 10) / 10
  };
}

// מזהה יציב לכל תסריט — ה-QA לעולם אינו מזהה תסריט על ידי parsing של טקסט חופשי.
export function scriptKeyOf(script, isGeneral) {
  return isGeneral ? 'general' : `group:${script.group_id}`;
}

export function scriptEntries(scripts) {
  const entries = [];
  if (scripts && scripts.general_script) {
    entries.push({ script_key: 'general', script: scripts.general_script });
  }
  for (const s of (scripts && scripts.focused_scripts) || []) {
    entries.push({ script_key: scriptKeyOf(s, false), script: s });
  }
  return entries;
}

// חלוקה ל-batches שלמים: תסריט לעולם אינו נחתך, וכל תסריט נכלל בדיוק פעם אחת.
function batchEntries(entries) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    const length = String(entry.script.narration || '').length + 200;
    if (current.length > 0 && size + length > QA_BATCH_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function withConcurrency(items, limit, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const slice = items.slice(i, i + limit);
    results.push(...await Promise.all(slice.map(worker)));
  }
  return results;
}

const LANGUAGE_QA_SCHEMA = {
  type: 'object',
  properties: {
    blocking_issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          script_key: { type: 'string', description: 'המזהה המדויק שנשלח עבור התסריט' },
          category: { type: 'string', enum: BLOCKING_CATEGORIES },
          issue: { type: 'string' },
          repair_instruction: { type: 'string', description: 'תיקון מינימלי בלבד' }
        },
        required: ['script_key', 'category', 'issue', 'repair_instruction']
      }
    },
    style_notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          script_key: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['script_key', 'note']
      }
    }
  },
  required: ['blocking_issues', 'style_notes']
};

function languageQaPrompt(batch) {
  const body = batch.map((e) => {
    // סימוני ההפסקות הם תקן מאושר ונבדקים דטרמיניסטית — מוסרים לפני בדיקת השפה
    const narration = String(e.script.narration || '').replace(/\(הפסקה[^)]*\)/g, '');
    return `--- script_key: ${e.script_key}\nכותרת: ${e.script.title}\n${narration}`;
  }).join('\n\n');

  return `<scripts>
${body}
</scripts>`;
}

// ההנחיות הקבועות של בודק השפה — נשלחות כ-system ונשמרות ב-cache בין ה-batches
const LANGUAGE_QA_SYSTEM = `אתה עורך לשון ובודק איכות בכיר לתסריטי קריינות בעברית לסרטוני הדרכה לרכב. התסריטים מוקראים בקול, ולכן הקריטריון הוא עברית תקנית, טבעית וברורה לשמיעה.

בדוק כל תסריט:
1. category=language_error — שגיאת עברית ממשית בלבד: פועל שגוי, שורש או בניין שגויים, הטיה שגויה, שגיאת התאמה במין/מספר, שגיאת כתיב. ניסוח שנשמע מתורגם, מסורבל, חוזר או "אפשר לשפר" הוא style_note ולא שגיאה.
2. category=meta_process_text — התייחסות בתוך הקריינות למקורות, לתיעוד שסופק, לראיות, לאימות, למידע שלא סופק או לתהליך כתיבת התסריט. חשוב: ההבהרה המאושרת שמדובר במדריך מקוצר שאינו מחליף את ספר הרכב מיועדת לצופה, מחויבת בתסריט, ואינה טקסט meta — אין לדווח עליה.
3. category=unsafe_absolute_claim — הבטחה מוחלטת שמערכת תמנע תאונה.
4. category=other_blocking — פגם חמור אחר שאינו ראוי לפרסום כלל.

blocking_issues — פגם ממשי בלבד שאינו ניתן לפרסום, מהקטגוריות שלמעלה. בספק — style_note.
style_notes — הערות סגנון וליטוש (חזרות, ניסוח מסורבל או מתורגם, אורך) שאינן חוסמות פרסום.

חובה: בכל פריט השתמש ב-script_key בדיוק כפי שהופיע בתסריט. אל תתאר את התסריט במילים במקום מזהה.
אל תדווח על מידע תפעולי חסר — הוא מטופל בנפרד ואינו פגם.
repair_instruction: ציין את הנוסח השגוי המדויק ואת הנוסח המתוקן, כדי שהעורך יחליף רק אותו.`;

export async function runLanguageQa(base44, entries) {
  const validKeys = new Set(entries.map((e) => e.script_key));
  const batches = batchEntries(entries);
  const warnings = [];

  const results = await withConcurrency(batches, CONCURRENCY, async (batch) => {
    try {
      const res = await callClaude({
        base44,
        system: LANGUAGE_QA_SYSTEM,
        prompt: languageQaPrompt(batch),
        schema: LANGUAGE_QA_SCHEMA,
        effort: 'medium',
        deadlineMs: 100000
      });
      return res.data || {};
    } catch (error) {
      warnings.push(`בדיקת שפה נכשלה עבור ${batch.length} תסריטים: ${error.message}`);
      return {};
    }
  });

  const blocking = [];
  const styleNotes = [];
  for (const res of results) {
    for (const item of res.blocking_issues || []) {
      if (!item || !validKeys.has(item.script_key)) continue;
      blocking.push({
        script_key: item.script_key,
        category: BLOCKING_CATEGORIES.includes(item.category) ? item.category : 'other_blocking',
        issue: String(item.issue || ''),
        repair_instruction: String(item.repair_instruction || '')
      });
    }
    for (const note of res.style_notes || []) {
      if (!note || !note.note) continue;
      styleNotes.push({ script_key: note.script_key || '', note: String(note.note) });
    }
  }
  return { blocking, styleNotes, warnings, batch_count: batches.length };
}

const REPAIR_RULES = `אתה עורך תסריט קיים, לא כותב אותו מחדש.

בצע אך ורק את התיקונים הדרושים לפתרון ה-blocking issues שסופקו.

אסור:
- להוסיף מידע עובדתי חדש.
- להוסיף שלבי תפעול חדשים.
- להוסיף שמות לחצנים, תפריטים או הגדרות שלא היו בטקסט.
- לשנות מספרים.
- לשנות תנאים.
- לשנות אזהרות בטיחות אלא אם השגיאה מתייחסת במפורש לניסוח שלהן.
- להרחיב את התסריט.
- "לשפר" חלקים שלא קשורים לבעיה.

מותר:
- לתקן עברית.
- להסיר התייחסות לתהליך הכתיבה, למקורות, לראיות או לאימות.
- להסיר משפט meta שאינו מיועד לקריינות.
- לצמצם חזרה כאשר היא עצמה blocking issue.
- להחליף ניסוח מוחלט בניסוח לא-מוחלט כאשר QA סימן אותו כהבטחת בטיחות אסורה.

שמור ככל האפשר על הניסוח המקורי. שמור על סימוני ההפסקות הקיימים.
החזר corrected_narration בלבד.`;

const REPAIR_SCHEMA = {
  type: 'object',
  properties: { corrected_narration: { type: 'string' } },
  required: ['corrected_narration']
};

// תיקון ממוקד: רק התסריטים שיש להם blocking issue, ורק שדה narration מוחלף.
export async function repairScripts(base44, scripts, issues) {
  const entries = scriptEntries(scripts);
  const keys = dedupe(issues.map((i) => i.script_key));
  const targets = entries.filter((e) => keys.includes(e.script_key));
  const log = [];
  const warnings = [];

  const repaired = await withConcurrency(targets, CONCURRENCY, async (entry) => {
    const own = issues.filter((i) => i.script_key === entry.script_key);
    const prompt = `--- כותרת התסריט ---
${entry.script.title}

--- הבעיות שיש לתקן ---
${own.map((i, n) => `${n + 1}. [${i.category}] ${i.issue}\n   תיקון נדרש: ${i.repair_instruction}`).join('\n')}

--- טקסט הקריינות הקיים ---
${entry.script.narration}`;
    try {
      const res = await callClaude({
        base44, system: REPAIR_RULES, prompt, schema: REPAIR_SCHEMA, effort: 'low', deadlineMs: 100000
      });
      const narration = normalizeNarrationEnding(res.data && res.data.corrected_narration);
      if (!narration) throw new Error('התיקון חזר ריק');
      return { script_key: entry.script_key, narration, issues: own };
    } catch (error) {
      warnings.push(`תיקון התסריט "${entry.script.title}" נכשל: ${error.message}`);
      return null;
    }
  });

  // מחליפים narration בלבד — title, included_system_ids, source_references ו-group_id נשמרים כפי שהם
  const next = {
    general_script: scripts.general_script ? { ...scripts.general_script } : null,
    focused_scripts: (scripts.focused_scripts || []).map((s) => ({ ...s }))
  };
  for (const item of repaired) {
    if (!item) continue;
    const target = item.script_key === 'general'
      ? next.general_script
      : next.focused_scripts.find((s) => scriptKeyOf(s, false) === item.script_key);
    if (!target) continue;
    const before = target.narration;
    target.narration = item.narration;
    Object.assign(target, scriptMetrics(item.narration));
    log.push({
      script_key: item.script_key,
      title: target.title,
      issues: item.issues.map((i) => ({ category: i.category, issue: i.issue })),
      chars_before: before.length,
      chars_after: item.narration.length,
      word_count: target.word_count
    });
  }
  if (!next.general_script) delete next.general_script;
  return { scripts: next, log, warnings, repaired_keys: log.map((l) => l.script_key) };
}

function issueText(item) {
  return `[${item.category}] ${item.issue}`;
}

// QA מפוצל לצעדים קצרים — כל צעד הוא בקשה נפרדת שנשארת בתוך מגבלת הזמן של פונקציית Base44:
//   runQaPass    → בדיקה דטרמיניסטית + בדיקת שפה לכל התסריטים, ואז סיום או בקשת תיקון
//   runRepairPass → סבב תיקון ממוקד אחד לפי הבעיות שנשמרו בסבב ה-QA האחרון
// runFullScriptQa מריץ את שניהם בלולאה (לשימוש ב-audit ידני).

async function loadQaContext(base44, jobId) {
  const job = await base44.entities.GenerationJob.get(jobId);
  if (!job) return { error: { ok: false, error: 'המשימה לא נמצאה', status: 404 } };
  if (!job.scripts || !job.scripts.general_script) {
    return { error: { ok: false, error: 'למשימה אין תסריטים לבדיקה', status: 422 } };
  }
  const systems = await base44.entities.SystemItem.filter({ project_id: job.project_id }, 'name_he', 500);
  const groups = await base44.entities.ScriptGroup.filter({ project_id: job.project_id }, 'order_index', 200);
  return { job, systems: systems || [], activeGroups: (groups || []).filter((g) => !g.cancelled) };
}

export async function runQaPass(base44, jobId, { maxRepairRounds = MAX_REPAIR_ROUNDS } = {}): Promise<any> {
  const ctx = await loadQaContext(base44, jobId);
  if (ctx.error) return ctx.error;
  const { job, systems, activeGroups } = ctx;
  const previous = job.qa_results || {};
  const round = Number(previous.repair_rounds || 0);

  await base44.entities.GenerationJob.update(jobId, { status: 'qa' });

  const scripts = job.scripts;
  const writerBlocking = dedupe(job.writer_blocking_issues);
  const writerGaps = dedupe(job.writer_documentation_gaps);
  const deterministic = runDeterministicAudit(scripts, systems, activeGroups);
  const language = await runLanguageQa(base44, scriptEntries(scripts));

  const languageBlocking = language.blocking.map(issueText);
  const styleNotes = dedupe([...(previous.language_style_notes || []), ...language.styleNotes.map((n) => n.note)]);
  const warnings = dedupe([...(previous.warnings || []), ...language.warnings]);
  const initialLanguageBlocking = round === 0 ? languageBlocking : (previous.initial_language_blocking_issues || []);

  // Auto-Repair רק כשהחסימה היחידה היא Language/Content — לא מייצרים מחדש שום תסריט
  const canRepair = language.blocking.length > 0 &&
    deterministic.blocking.length === 0 &&
    writerBlocking.length === 0 &&
    round < maxRepairRounds;

  const qaResults = {
    ...previous,
    initial_language_blocking_issues: initialLanguageBlocking,
    repair_attempts: previous.repair_attempts || [],
    repair_rounds: round,
    final_language_blocking_issues: languageBlocking,
    final_deterministic_blocking_issues: deterministic.blocking,
    deterministic_gaps: deterministic.gaps,
    writer_blocking_issues: writerBlocking,
    writer_documentation_gaps: writerGaps,
    language_style_notes: styleNotes,
    warnings,
    pending_repair_issues: canRepair ? language.blocking : []
  };

  if (canRepair) {
    await base44.entities.GenerationJob.update(jobId, { status: 'repairing', qa_results: { ...qaResults, passed: false } });
    return {
      ok: false,
      needs_repair: true,
      job_id: jobId,
      repair_round: round + 1,
      blocking_issues: languageBlocking,
      style_notes: styleNotes,
      warnings
    };
  }

  const blockingIssues = dedupe([...deterministic.blocking, ...writerBlocking, ...languageBlocking]);
  // documentation_gaps = מידע שלא אומת במקורות בלבד. הערות סגנון נשמרות בנפרד.
  const documentationGaps = dedupe([...writerGaps, ...deterministic.gaps]);
  const passed = blockingIssues.length === 0;

  await base44.entities.GenerationJob.update(jobId, {
    status: passed ? 'passed' : 'failed',
    qa_results: { ...qaResults, passed },
    blocking_issues: blockingIssues,
    documentation_gaps: documentationGaps,
    qa_style_notes: styleNotes,
    qa_warnings: warnings,
    validation_issues: blockingIssues,
    error_message: passed ? '' : (blockingIssues[0] || job.error_message || ''),
    finished_at: new Date().toISOString()
  });

  if (passed) {
    await base44.entities.VehicleProject.update(job.project_id, {
      status: 'generated',
      prompt_version: job.prompt_version
    });
  }

  return {
    ok: passed,
    needs_repair: false,
    job_id: jobId,
    blocking_issues: blockingIssues,
    documentation_gaps: documentationGaps,
    style_notes: styleNotes,
    warnings,
    repair_rounds: round,
    repair_attempts: qaResults.repair_attempts
  };
}

export async function runRepairPass(base44, jobId): Promise<any> {
  const job = await base44.entities.GenerationJob.get(jobId);
  if (!job) return { ok: false, error: 'המשימה לא נמצאה', status: 404 };
  const previous = job.qa_results || {};
  const issues = previous.pending_repair_issues || [];
  if (issues.length === 0) return { ok: true, job_id: jobId, repaired_keys: [] };

  await base44.entities.GenerationJob.update(jobId, { status: 'repairing' });
  const round = Number(previous.repair_rounds || 0) + 1;
  const repair = await repairScripts(base44, job.scripts, issues);

  await base44.entities.GenerationJob.update(jobId, {
    status: 'qa',
    scripts: repair.repaired_keys.length > 0 ? repair.scripts : job.scripts,
    qa_results: {
      ...previous,
      repair_rounds: round,
      pending_repair_issues: [],
      warnings: dedupe([...(previous.warnings || []), ...repair.warnings]),
      repair_attempts: [
        ...(previous.repair_attempts || []),
        {
          round,
          issues: issues.map((i) => ({ script_key: i.script_key, category: i.category, issue: i.issue })),
          repaired: repair.log
        }
      ]
    }
  });

  return { ok: true, job_id: jobId, round, repaired_keys: repair.repaired_keys, warnings: repair.warnings };
}

// הצינור המלא בבקשה אחת. maxRepairRounds=0 מריץ QA בלבד ללא תיקון.
export async function runFullScriptQa(base44, jobId, { maxRepairRounds = MAX_REPAIR_ROUNDS } = {}): Promise<any> {
  // ריצה מלאה מתחילה מאפס — סבבי תיקון קודמים של המשימה אינם נספרים
  const job = await base44.entities.GenerationJob.get(jobId);
  if (job) {
    await base44.entities.GenerationJob.update(jobId, {
      qa_results: { ...(job.qa_results || {}), repair_rounds: 0, pending_repair_issues: [], repair_attempts: [] }
    });
  }
  for (;;) {
    const result = await runQaPass(base44, jobId, { maxRepairRounds });
    if (!result.needs_repair) return result;
    const repair = await runRepairPass(base44, jobId);
    if (repair.error) return repair;
    if (!repair.repaired_keys || repair.repaired_keys.length === 0) {
      // התיקון לא הצליח — סבב QA אחרון ללא תיקון נוסף
      return await runQaPass(base44, jobId, { maxRepairRounds: 0 });
    }
  }
}
