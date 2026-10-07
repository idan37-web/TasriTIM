import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { REQUIRED_MODEL, REQUIRED_MODEL_LABEL } from '../../shared/constants.ts';
import { validatePlan } from '../../shared/plan.ts';
import { buildEvidencePackets, buildSourceReferences } from '../../shared/evidence.ts';
import { normalizeNarrationEnding, scriptMetrics, runFullScriptQa, dedupe } from '../../shared/scriptQa.ts';

// צינור היצירה מפוצל לשלבים כדי לא לחרוג ממגבלת זמן הבקשה (120 שניות):
// action="start"  → אימות תוכנית, מודל ופרומפט + יצירת משימה והחזרת רשימת תסריטים לכתיבה
// action="write"  → כתיבת תסריט אחד (כללי או קבוצה ממוקדת) עם gpt-5.6-sol. אידמפוטנטי לפי target.
// action="qa"     → בדיקת דיוק דטרמיניסטית + בדיקת תוכן ועברית וסיום המשימה
//
// הפרדת יסוד: blocking_issues (הפרת No-Hallucination) חוסמות את המשימה.
// documentation_gaps (מידע שאינו מתועד ולכן הושמט) אינם חוסמים — הם נשמרים לשקיפות.

const MAX_WRITE_ATTEMPTS = 2;

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    script: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        included_system_ids: { type: 'array', items: { type: 'string' } },
        narration: { type: 'string' }
      },
      required: ['title', 'narration', 'included_system_ids']
    },
    blocking_issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'הפרות אמת בלבד: טענה שאינה נתמכת בראיות, צעד תפעולי שהומצא, סתירה מפורשת לספר הנהג, מערכת מוחרגת, מידע מגרסה לא מאושרת שנכתב כוודאי'
    },
    documentation_gaps: {
      type: 'array',
      items: { type: 'string' },
      description: 'מידע תפעולי שאינו מתועד במקורות ולכן הושמט מהקריינות (נתיב תפריט, שם בקר, תת-גרסה, מקור OCR חלקי)'
    }
  },
  required: ['script', 'blocking_issues', 'documentation_gaps']
};

async function getActivePromptByVersion(base44, versionNumber) {
  const rows = await base44.entities.PromptVersion.filter({ version_number: versionNumber }, '-version_number', 1);
  return rows && rows[0];
}

function vehicleData(project) {
  return {
    manufacturer: project.manufacturer,
    model: project.model,
    model_year: project.model_year,
    market: project.market,
    trim_level: project.trim_level,
    drivetrain: project.drivetrain,
    seats: project.seats,
    notes: project.notes
  };
}

function disableCapability(system) {
  if (system.disable_capability) return system.disable_capability;
  // תאימות לאחור: רשומות ישנות עם can_disable=false אינן ראיה ל"לא ניתן להשבית"
  return system.can_disable ? 'yes' : 'unknown';
}

async function failJob(base44, jobId, message) {
  await base44.entities.GenerationJob.update(jobId, {
    status: 'failed',
    error_message: message,
    finished_at: new Date().toISOString()
  });
}

async function handleStart(base44, body) {
  const { project_id } = body;
  if (!project_id) return Response.json({ error: 'חסר מזהה פרויקט' }, { status: 400 });

  // 1. אימות התוכנית — אין יצירה כשיש חוסמים
  const plan = await validatePlan(base44, project_id);
  if (plan.blockers.length > 0) {
    return Response.json({ ok: false, blockers: plan.blockers }, { status: 422 });
  }
  const { docs, groups } = plan;

  // מניעת כפילות: משימה פעילה קיימת
  const running = await base44.entities.GenerationJob.filter({ project_id, status: 'generating' }, '-created_date', 1);
  if (running && running[0] && Date.now() - new Date(running[0].created_date).getTime() < 10 * 60 * 1000) {
    return Response.json({ ok: false, error: 'משימת יצירה כבר פועלת עבור פרויקט זה', job_id: running[0].id }, { status: 409 });
  }

  // 2. אימות המודל הקשיח — ללא fallback
  try {
    await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: 'השב במילה אחת: תקין', model: REQUIRED_MODEL });
  } catch (_e) {
    return Response.json({ ok: false, blockers: [`המודל ${REQUIRED_MODEL_LABEL} אינו זמין — היצירה חסומה`] }, { status: 422 });
  }

  // 3. פרומפט נעול פעיל
  const activePrompts = await base44.entities.PromptVersion.filter({ is_active: true }, '-version_number', 1);
  const activePrompt = activePrompts && activePrompts[0];
  if (!activePrompt) return Response.json({ ok: false, blockers: ['אין גרסת פרומפט פעילה'] }, { status: 422 });

  const signature = (docs || []).map((d) => `${d.id}:${d.updated_date}`).sort().join('|');
  const job = await base44.entities.GenerationJob.create({
    project_id,
    status: 'generating',
    prompt_version: activePrompt.version_number,
    required_model: REQUIRED_MODEL_LABEL,
    actual_model: REQUIRED_MODEL,
    sources_signature: signature,
    started_at: new Date().toISOString(),
    blocking_issues: [],
    documentation_gaps: [],
    writer_blocking_issues: [],
    writer_documentation_gaps: [],
    qa_style_notes: [],
    qa_warnings: []
  });

  const activeGroups = (groups || []).filter((g) => !g.cancelled).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  const focusedGroups = activeGroups.filter((g) => g.script_type === 'focused');
  const tasks = [
    { target: 'general', title: 'תסריט כללי' },
    ...focusedGroups.map((g) => ({ target: g.id, title: g.title }))
  ];

  return Response.json({ ok: true, job_id: job.id, tasks });
}

async function handleWrite(base44, body) {
  const { job_id, target } = body;
  const attempt = Number(body.attempt || 1);
  if (!job_id || !target) return Response.json({ error: 'חסרים פרטי משימה' }, { status: 400 });

  const job = await base44.entities.GenerationJob.get(job_id);
  if (!job) return Response.json({ error: 'המשימה לא נמצאה' }, { status: 404 });
  const project_id = job.project_id;

  // אידמפוטנטיות: אם ה-target הושלם כבר (גם אם התשובה אבדה ב-timeout) — אין קריאה חוזרת ל-LLM
  const existingScripts = job.scripts || {};
  const alreadyDone = target === 'general'
    ? !!existingScripts.general_script
    : (existingScripts.focused_scripts || []).some((s) => s.group_id === target);
  if (alreadyDone) {
    return Response.json({ ok: true, job_id, target, already_completed: true });
  }

  const activePrompt = await getActivePromptByVersion(base44, job.prompt_version);
  if (!activePrompt) return Response.json({ error: 'גרסת הפרומפט של המשימה לא נמצאה' }, { status: 422 });

  const project = await base44.entities.VehicleProject.get(project_id);
  const systems = await base44.entities.SystemItem.filter({ project_id }, 'name_he', 500);
  const groups = await base44.entities.ScriptGroup.filter({ project_id }, 'order_index', 100);
  const includedSystems = (systems || []).filter((s) => s.included);

  let scriptSystems, scriptTitle, groupId = null;
  if (target === 'general') {
    scriptSystems = includedSystems;
    scriptTitle = 'תסריט כללי — סקירת כלל המערכות';
  } else {
    const group = (groups || []).find((g) => g.id === target);
    if (!group) {
      await failJob(base44, job_id, 'קבוצת תסריט לא נמצאה');
      return Response.json({ error: 'קבוצת תסריט לא נמצאה' }, { status: 404 });
    }
    groupId = group.id;
    scriptSystems = includedSystems.filter((s) => (group.system_ids || []).includes(s.id));
    scriptTitle = group.title;
  }

  try {
    // התסריט הכללי סוקר בקצרה מערכות רבות — תקציב ראיות מצומצם שומר את הקריאה בתוך מגבלת הזמן
    const budgetPerSystem = target === 'general'
      ? Math.max(1500, Math.floor(40000 / Math.max(1, scriptSystems.length)))
      : 20000;
    const packets = await buildEvidencePackets(base44, project_id, scriptSystems, budgetPerSystem);

    const contextData = {
      vehicle: vehicleData(project),
      script_to_write: { type: target === 'general' ? 'general' : 'focused', title: scriptTitle },
      systems: scriptSystems.map((s) => ({
        id: s.id, name_he: s.name_he, name_commercial: s.name_commercial,
        aliases: s.aliases, category: s.category,
        disable_capability: disableCapability(s),
        availability_status: s.availability_status, has_ops_instructions: s.has_ops_instructions,
        allow_partial_evidence: !!s.allow_partial_evidence,
        source_note: s.source_note, source_pages: s.source_pages
      })),
      approved_grouping: (groups || []).filter((g) => !g.cancelled).map((g) => ({
        title: g.title,
        system_ids: (g.system_ids || []).filter((id) => scriptSystems.some((s) => s.id === id))
      })).filter((g) => g.system_ids.length > 0),
      excluded_system_names: (systems || []).filter((s) => !s.included).map((s) => s.name_he),
      evidence_packets: packets
    };

    const fullPrompt = activePrompt.content +
      `\n\n--- הנחיית ביצוע ---\nכתוב כעת תסריט אחד בלבד: "${scriptTitle}"` +
      (target === 'general'
        ? ' — תסריט כללי הסוקר את כלל המערכות שנבחרו. סדר הפרקים בפרומפט הוא תבנית סדר בלבד: השמטו בטבעיות פרקים שאין עבורם מערכת מאושרת, ואין לדווח על השמטתם כשגיאה.'
        : ' — תסריט ממוקד למערכות המפורטות בלבד.') +
      '\nמזהי מערכות חופפים המופיעים יחד ב-approved_grouping אושרו במפורש כנושא מאוחד. כתבו אותם פעם אחת תחת כותרת הקבוצה, כללו את כל המזהים, ואל תדווחו על החפיפה כשגיאה.' +
      '\n\nכלל No-Hallucination והדיווח (חובה):' +
      '\n1. פרט שאינו מאומת בראיות — אין להמציא אותו ואין להכניס אותו לקריינות. השמיטו אותו, המשיכו לכתוב את החלקים המאומתים, ורשמו את החוסר ב-documentation_gaps.' +
      '\n2. documentation_gaps הוא הדיווח הנכון עבור: נתיב תפריט שאינו מתועד, שם בקר שאינו מופיע, כמה תתי-גרסאות ללא זיהוי המותקנת, הליך צימוד חלקי, מקור OCR חלקי, וכל שלב שהושמט מחוסר תיעוד. אלו אינם שגיאות.' +
      '\n3. blocking_issues מיועד רק להפרה אמיתית: טענה עובדתית שאינה נתמכת בראיות, צעד תפעולי שהומצא, סתירה מפורשת לספר הנהג, אזכור מערכת מוחרגת, או מידע מגרסה שאינה מאושרת שנכתב כוודאי.' +
      '\n4. חובה להחזיר narration לא ריק. אין לסרב לכתוב תסריט בגלל חוסר בתיעוד — כתבו את המאומת ורשמו את החוסר ב-documentation_gaps.' +
      '\n5. disable_capability="unknown" פירושו שאין מידע על אפשרות השבתה — אין בכך סתירה לספר הנהג ואין לדווח על כך כ-blocking_issue. "no" בלבד מהווה קביעה שלא ניתן להשבית.' +
      '\n6. מערכת עם allow_partial_evidence=true אושרה במפורש לכתיבה גם ללא הסבר תפעולי פרטני: כתבו את הייעוד, החיוויים, האזהרות ועקרון ההפעלה המאומתים, והשמיטו צעדים שאינם בראיות.' +
      '\nאין להחזיר הפניות מקור או ספירת מילים — הם נבנים בצד השרת.' +
      '\n\n--- נתוני הפרויקט המאושרים (JSON) ---\n' +
      JSON.stringify(contextData);

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: fullPrompt,
      model: REQUIRED_MODEL,
      response_json_schema: SCRIPT_SCHEMA
    });

    const narration = normalizeNarrationEnding(result.script?.narration);
    if (!narration) {
      const blocking = result.blocking_issues || [];
      const gaps = result.documentation_gaps || [];
      const message = blocking.length > 0
        ? blocking.join(' ')
        : (gaps.length > 0
          ? `המודל לא כתב את התסריט "${scriptTitle}" בשל פערי תיעוד: ${gaps.join(' ')}`
          : `לא ניתן לכתוב את התסריט "${scriptTitle}" מהמקורות שסופקו`);
      // narration ריק הוא כשל אמיתי של ה-target; רק לאחר מיצוי הניסיונות נופלת כל המשימה
      if (attempt >= MAX_WRITE_ATTEMPTS) await failJob(base44, job_id, message);
      return Response.json({
        ok: false, job_id, target, attempt, retryable: attempt < MAX_WRITE_ATTEMPTS,
        error: message, blocking_issues: blocking, documentation_gaps: gaps
      }, { status: 422 });
    }

    const script = {
      title: result.script.title || scriptTitle,
      narration,
      ...scriptMetrics(narration),
      included_system_ids: result.script.included_system_ids || scriptSystems.map((s) => s.id),
      source_references: buildSourceReferences(packets)
    };

    // upsert לפי group_id — retry לעולם אינו יוצר תסריט ממוקד כפול
    const current = await base44.entities.GenerationJob.get(job_id);
    const scripts = current.scripts || {};
    if (target === 'general') {
      scripts.general_script = script;
    } else {
      const focused = (scripts.focused_scripts || []).filter((s) => s.group_id !== groupId);
      focused.push({ ...script, group_id: groupId });
      scripts.focused_scripts = focused;
    }
    // שגיאות הכתיבה נשמרות בשדות ה-writer בלבד; blocking_issues הוא תמיד תוצאת ה-QA הנוכחית
    await base44.entities.GenerationJob.update(job_id, {
      scripts,
      writer_blocking_issues: dedupe([...(current.writer_blocking_issues || []), ...(result.blocking_issues || [])]),
      writer_documentation_gaps: dedupe([...(current.writer_documentation_gaps || []), ...(result.documentation_gaps || [])])
    });

    return Response.json({
      ok: true, job_id, target,
      blocking_issues: result.blocking_issues || [],
      documentation_gaps: result.documentation_gaps || []
    });
  } catch (innerError) {
    // תקלה זמנית (timeout / רשת / LLM) אינה מפילה את כל המשימה כל עוד נותר ניסיון
    if (attempt >= MAX_WRITE_ATTEMPTS) {
      await failJob(base44, job_id, innerError.message);
    } else {
      await base44.entities.GenerationJob.update(job_id, { error_message: `ניסיון ${attempt} ל-"${scriptTitle}" נכשל: ${innerError.message}` });
    }
    return Response.json({
      ok: false, job_id, target, attempt,
      retryable: attempt < MAX_WRITE_ATTEMPTS, error: innerError.message
    }, { status: 500 });
  }
}

// כל לוגיקת ה-QA וה-Repair חיה ב-shared/scriptQa.ts — מקור אמת יחיד ל-"passed"
async function handleQa(base44, body) {
  const { job_id } = body;
  if (!job_id) return Response.json({ error: 'חסר מזהה משימה' }, { status: 400 });

  try {
    await base44.entities.GenerationJob.update(job_id, { status: 'qa' });
    const result = await runFullScriptQa(base44, job_id, {
      maxRepairRounds: body.max_repair_rounds != null ? Number(body.max_repair_rounds) : undefined
    });
    if (result.error) return Response.json({ ok: false, error: result.error }, { status: result.status || 422 });
    return Response.json(result);
  } catch (innerError) {
    await failJob(base44, job_id, innerError.message);
    return Response.json({ ok: false, job_id, error: innerError.message }, { status: 500 });
  }
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const action = body.action || 'start';
    if (action === 'start') return await handleStart(base44, body);
    if (action === 'write') return await handleWrite(base44, body);
    if (action === 'qa') return await handleQa(base44, body);
    return Response.json({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}