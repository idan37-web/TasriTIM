// מקור אמת יחיד ל-QA של התסריטים: בדיקה דטרמיניסטית + Language/Content QA + Auto-Repair ממוקד.
// משמש גם את generateVehicleScripts (action=qa) וגם את runScriptQualityAudit — אין שתי הגדרות ל-"passed".

import { REQUIRED_MODEL } from './constants.ts';
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

  return `אתה בודק איכות לתסריטי קריינות בעברית לסרטוני הדרכה לרכב.

בדוק כל תסריט:
1. category=language_error — שגיאת עברית ממשית בלבד: פועל שגוי, שורש או בניין שגויים, הטיה שגויה, שגיאת התאמה במין/מספר, שגיאת כתיב. ניסוח שנשמע מתורגם, מסורבל, חוזר או "אפשר לשפר" הוא style_note ולא שגיאה.
2. category=meta_process_text — התייחסות בתוך הקריינות למקורות, לתיעוד שסופק, לראיות, לאימות, למידע שלא סופק או לתהליך כתיבת התסריט. חשוב: ההבהרה המאושרת שמדובר במדריך מקוצר שאינו מחליף את ספר הרכב מיועדת לצופה, מחויבת בתסריט, ואינה טקסט meta — אין לדווח עליה.
3. category=unsafe_absolute_claim — הבטחה מוחלטת שמערכת תמנע תאונה.
4. category=other_blocking — פגם חמור אחר שאינו ראוי לפרסום כלל.

blocking_issues — פגם ממשי בלבד שאינו ניתן לפרסום, מהקטגוריות שלמעלה. בספק — style_note.
style_notes — הערות סגנון וליטוש (חזרות, ניסוח מסורבל או מתורגם, אורך) שאינן חוסמות פרסום.

חובה: בכל פריט השתמש ב-script_key בדיוק כפי שנשלח כאן. אל תתאר את התסריט במילים במקום מזהה.
אל תדווח על מידע תפעולי חסר — הוא מטופל בנפרד ואינו פגם.

--- התסריטים ---
${body}`;
}

export async function runLanguageQa(base44, entries) {
  const validKeys = new Set(entries.map((e) => e.script_key));
  const batches = batchEntries(entries);
  const warnings = [];

  const results = await withConcurrency(batches, CONCURRENCY, async (batch) => {
    try {
      const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: languageQaPrompt(batch),
        model: REQUIRED_MODEL,
        response_json_schema: LANGUAGE_QA_SCHEMA
      });
      return res || {};
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
    const prompt = `${REPAIR_RULES}

--- כותרת התסריט ---
${entry.script.title}

--- הבעיות שיש לתקן ---
${own.map((i, n) => `${n + 1}. [${i.category}] ${i.issue}\n   תיקון נדרש: ${i.repair_instruction}`).join('\n')}

--- טקסט הקריינות הקיים ---
${entry.script.narration}`;
    try {
      const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt, model: REQUIRED_MODEL, response_json_schema: REPAIR_SCHEMA
      });
      const narration = normalizeNarrationEnding(res && res.corrected_narration);
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

// הצינור המלא. maxRepairRounds=0 מריץ QA בלבד ללא תיקון.
export async function runFullScriptQa(base44, jobId, { maxRepairRounds = MAX_REPAIR_ROUNDS } = {}) {
  const job = await base44.entities.GenerationJob.get(jobId);
  if (!job) return { ok: false, error: 'המשימה לא נמצאה', status: 404 };
  if (!job.scripts || !job.scripts.general_script) {
    return { ok: false, error: 'למשימה אין תסריטים לבדיקה', status: 422 };
  }

  const systems = await base44.entities.SystemItem.filter({ project_id: job.project_id }, 'name_he', 500);
  const groups = await base44.entities.ScriptGroup.filter({ project_id: job.project_id }, 'order_index', 200);
  const activeGroups = (groups || []).filter((g) => !g.cancelled);

  const writerBlocking = dedupe(job.writer_blocking_issues);
  const writerGaps = dedupe(job.writer_documentation_gaps);

  let scripts = job.scripts;
  let deterministic = runDeterministicAudit(scripts, systems || [], activeGroups);
  let language = await runLanguageQa(base44, scriptEntries(scripts));

  const initialLanguageBlocking = language.blocking.map(issueText);
  const styleNotes = [...language.styleNotes];
  const warnings = [...language.warnings];
  const repairAttempts = [];
  let round = 0;

  // Auto-Repair רק כשהחסימה היחידה היא Language/Content — לא מייצרים מחדש שום תסריט
  while (
    language.blocking.length > 0 &&
    deterministic.blocking.length === 0 &&
    writerBlocking.length === 0 &&
    round < maxRepairRounds
  ) {
    round += 1;
    await base44.entities.GenerationJob.update(jobId, { status: 'repairing' });

    const repair = await repairScripts(base44, scripts, language.blocking);
    warnings.push(...repair.warnings);
    repairAttempts.push({
      round,
      issues: language.blocking.map((i) => ({ script_key: i.script_key, category: i.category, issue: i.issue })),
      repaired: repair.log
    });
    if (repair.repaired_keys.length === 0) break;

    scripts = repair.scripts;
    await base44.entities.GenerationJob.update(jobId, { scripts, status: 'qa' });

    // QA אמיתי מחדש: דטרמיניסטי על כל התסריטים, שפה על התסריטים שתוקנו
    deterministic = runDeterministicAudit(scripts, systems || [], activeGroups);
    const rechecked = scriptEntries(scripts).filter((e) => repair.repaired_keys.includes(e.script_key));
    language = await runLanguageQa(base44, rechecked);
    styleNotes.push(...language.styleNotes);
    warnings.push(...language.warnings);
  }

  const finalLanguageBlocking = language.blocking.map(issueText);
  const blockingIssues = dedupe([...deterministic.blocking, ...writerBlocking, ...finalLanguageBlocking]);
  // documentation_gaps = מידע שלא אומת במקורות בלבד. הערות סגנון נשמרות בנפרד.
  const documentationGaps = dedupe([...writerGaps, ...deterministic.gaps]);
  const styleNoteTexts = dedupe(styleNotes.map((n) => n.note));
  const qaWarnings = dedupe(warnings);
  const passed = blockingIssues.length === 0;

  await base44.entities.GenerationJob.update(jobId, {
    status: passed ? 'passed' : 'failed',
    scripts,
    qa_results: {
      initial_language_blocking_issues: initialLanguageBlocking,
      repair_attempts: repairAttempts,
      repair_rounds: round,
      final_language_blocking_issues: finalLanguageBlocking,
      final_deterministic_blocking_issues: deterministic.blocking,
      deterministic_gaps: deterministic.gaps,
      writer_blocking_issues: writerBlocking,
      writer_documentation_gaps: writerGaps,
      language_style_notes: styleNoteTexts,
      warnings: qaWarnings,
      passed
    },
    blocking_issues: blockingIssues,
    documentation_gaps: documentationGaps,
    qa_style_notes: styleNoteTexts,
    qa_warnings: qaWarnings,
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
    job_id: jobId,
    blocking_issues: blockingIssues,
    documentation_gaps: documentationGaps,
    style_notes: styleNoteTexts,
    warnings: qaWarnings,
    repair_rounds: round,
    repair_attempts: repairAttempts
  };
}