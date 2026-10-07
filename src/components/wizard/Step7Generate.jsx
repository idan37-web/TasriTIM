import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Loader2, Sparkles, XCircle, CheckCircle2, ExternalLink, FileText, Circle, Search, PenLine, ShieldCheck, Wrench,
} from 'lucide-react';
import GenerationProgress from './GenerationProgress';
import JobIssues from './JobIssues';

const JOB_STATUS = {
  generating: { label: 'כותב תסריטים...', cls: 'bg-sky-50 text-sky-700' },
  qa: { label: 'בבדיקות איכות', cls: 'bg-signal-50 text-signal-700' },
  repairing: { label: 'בתיקון ממוקד', cls: 'bg-indigo-50 text-indigo-700' },
  passed: { label: 'עבר את כל הבדיקות', cls: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'נכשל בבדיקות', cls: 'bg-red-50 text-red-700' },
  doc_created: { label: 'מסמך נוצר', cls: 'bg-emerald-100 text-emerald-800' },
};

const MAX_WRITE_ATTEMPTS = 3;
const MAX_REPAIR_ROUNDS = 2;

// מצב כל תסריט בצינור: ממתין ← איתור מקורות ← כתיבה ← נכתב / נכשל
const TASK_STATE = {
  pending: { label: 'ממתין', icon: Circle, cls: 'text-stone-300' },
  evidence: { label: 'Claude מאתר מקורות בספר הנהג', icon: Search, cls: 'text-signal-500', spin: true },
  writing: { label: 'Claude כותב את התסריט', icon: PenLine, cls: 'text-signal-500', spin: true },
  retry: { label: 'ניסיון נוסף במאמץ מהיר יותר', icon: PenLine, cls: 'text-signal-600', spin: true },
  done: { label: 'נכתב', icon: CheckCircle2, cls: 'text-emerald-500' },
  error: { label: 'נכשל', icon: XCircle, cls: 'text-red-500' },
};

function TaskList({ tasks, states }) {
  if (!tasks.length) return null;
  return (
    <ol className="mt-4 divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden bg-white">
      {tasks.map((t, i) => {
        const st = TASK_STATE[states[t.target] || 'pending'];
        const Icon = st.icon;
        return (
          <li key={t.target} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="text-xs text-stone-400 tabular-nums w-5">{i + 1}</span>
              <span className="truncate text-stone-700">{t.title}</span>
            </span>
            <span className={`flex items-center gap-1.5 text-xs shrink-0 ${st.cls}`}>
              {st.spin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              {st.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ScriptCard({ s }) {
  const [tab, setTab] = useState('narration');
  const refs = s.source_references || [];
  return (
    <div className="bg-stone-50 rounded-xl border border-stone-200/70 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <span className="font-medium text-sm text-stone-800">{s.title}</span>
        <span className="text-xs text-stone-400 shrink-0 tabular-nums">{s.word_count} מילים · כ‑{s.estimated_duration_minutes} דק׳</span>
      </div>
      <div className="flex gap-1 px-3 pt-2">
        {[['narration', 'קריינות'], ['sources', `מקורות (${refs.length})`]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${tab === key ? 'bg-white shadow-card text-stone-900' : 'text-stone-500 hover:text-stone-800'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="px-4 py-3">
        {tab === 'narration' ? (
          <p className="text-[15px] text-stone-700 whitespace-pre-wrap leading-8">{s.narration}</p>
        ) : (
          <div className="text-xs text-stone-500 space-y-1">
            <div className="eyebrow mb-1">לאימות בלבד, לא לקריינות</div>
            {refs.length ? refs.map((r, k) => <div key={k}>{r}</div>) : <div>אין הפניות</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Step7Generate({ project }) {
  const [jobs, setJobs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [message, setMessage] = useState(null);
  const [progress, setProgress] = useState('');
  const [steps, setSteps] = useState({ completed: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [tasks, setTasks] = useState([]);
  const [taskStates, setTaskStates] = useState({});

  useEffect(() => {
    if (!generating) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  const refresh = async () => {
    const [j, o] = await Promise.all([
      base44.entities.GenerationJob.filter({ project_id: project.id }, '-created_date', 20),
      base44.entities.OutputDocument.filter({ project_id: project.id }, '-created_date', 20),
    ]);
    setJobs(j || []);
    setOutputs(o || []);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const invoke = (payload) => base44.functions.invoke('generateVehicleScripts', payload);
  const setTaskState = (target, state) => setTaskStates((prev) => ({ ...prev, [target]: state }));

  // כתיבת תסריט אחד עם ניסיונות חוזרים. הקריאה אידמפוטנטית — target שהושלם לא ייכתב שוב.
  const writeTask = async (job_id, task) => {
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      setTaskState(task.target, attempt === 1 ? 'writing' : 'retry');
      try {
        await invoke({ action: 'write', job_id, target: task.target, attempt });
        setTaskState(task.target, 'done');
        return;
      } catch (writeError) {
        const d = writeError.response?.data;
        if (d?.retryable === false || attempt === MAX_WRITE_ATTEMPTS) {
          setTaskState(task.target, 'error');
          throw writeError;
        }
      }
    }
  };

  // היצירה מפוצלת לשלבים קצרים — כל בקשה נשארת בתוך מגבלת הזמן של השרת
  const generate = async () => {
    setGenerating(true);
    setMessage(null);
    setTasks([]);
    setTaskStates({});
    setSteps({ completed: 0, total: 3 });
    try {
      setProgress('בודק את התוכנית ואת זמינות המודל...');
      const startRes = await invoke({ action: 'start', project_id: project.id });
      const { job_id, tasks: jobTasks } = startRes.data;
      setTasks(jobTasks);
      const total = jobTasks.length + 2;
      setSteps({ completed: 1, total });
      refresh();

      for (let i = 0; i < jobTasks.length; i++) {
        const task = jobTasks[i];
        setProgress(`תסריט ${i + 1} מתוך ${jobTasks.length}: ${task.title}`);
        // ניתוב ראיות סמנטי — כשל בו אינו עוצר את הכתיבה (נשארת השליפה הדטרמיניסטית)
        setTaskState(task.target, 'evidence');
        try {
          await invoke({ action: 'evidence', job_id, target: task.target });
        } catch (_e) { /* ממשיכים לכתיבה */ }
        await writeTask(job_id, task);
        setSteps({ completed: i + 2, total });
      }

      // QA ותיקון ממוקד — כל סבב הוא בקשה נפרדת
      setProgress('מריץ בדיקות דיוק, תוכן ועברית...');
      let qaRes = await invoke({ action: 'qa', job_id, max_repair_rounds: MAX_REPAIR_ROUNDS });
      while (qaRes.data?.needs_repair) {
        setProgress(`מתקן ניסוחים בתסריטים שסומנו (סבב ${qaRes.data.repair_round})...`);
        await invoke({ action: 'repair', job_id });
        setProgress('בודק שוב את התסריטים לאחר התיקון...');
        qaRes = await invoke({ action: 'qa', job_id, max_repair_rounds: MAX_REPAIR_ROUNDS });
      }

      const gaps = qaRes.data?.documentation_gaps || [];
      const notes = qaRes.data?.style_notes || [];
      const rounds = qaRes.data?.repair_rounds || 0;
      if (qaRes.data?.ok) {
        const parts = ['התסריטים נוצרו ועברו את כל בדיקות האיכות.'];
        if (rounds > 0) parts.push(`בוצע תיקון ממוקד ב-${rounds} סבבים.`);
        if (gaps.length > 0) parts.push(`${gaps.length} פערי תיעוד נרשמו בנפרד.`);
        setMessage({ type: 'success', text: parts.join(' '), gaps, notes });
        // המסמך נוצר אוטומטית לאחר PASS; הכפתור נשמר כ-Retry
        setProgress('יוצר מסמך Google Docs...');
        try {
          const docRes = await base44.functions.invoke('createGoogleDocsDocument', { job_id });
          if (docRes.data?.doc_url) {
            setMessage({ type: 'success', text: `${parts.join(' ')} המסמך נוצר ב‑Google Docs.`, gaps, notes });
          }
        } catch (_docError) {
          setMessage({
            type: 'success',
            text: `${parts.join(' ')} יצירת המסמך נכשלה — נסו שוב באמצעות הכפתור.`,
            gaps, notes,
          });
        }
      } else {
        setMessage({ type: 'error', list: qaRes.data?.blocking_issues || [qaRes.data?.error], gaps, notes });
      }
    } catch (e) {
      const d = e.response?.data;
      setMessage({
        type: 'error',
        list: d?.blocking_issues || d?.blockers || [d?.error || e.message],
        gaps: d?.documentation_gaps || [],
        notes: d?.style_notes || [],
      });
    } finally {
      setGenerating(false);
      setProgress('');
      setSteps({ completed: 0, total: 0 });
      refresh();
    }
  };

  const createDoc = async (job) => {
    setCreatingDoc(true);
    setMessage(null);
    try {
      const res = await base44.functions.invoke('createGoogleDocsDocument', { job_id: job.id });
      if (res.data?.doc_url) setMessage({ type: 'success', text: 'המסמך נוצר ב‑Google Docs.' });
      else setMessage({ type: 'error', list: [res.data?.error] });
    } catch (e) {
      setMessage({ type: 'error', list: [e.response?.data?.error || e.message] });
    } finally {
      setCreatingDoc(false);
      refresh();
    }
  };

  const latestPassed = jobs.find((j) => j.status === 'passed' || j.status === 'doc_created');
  // משימה שנשארה "פועלת" אחרי שהדף נסגר באמצע — היא חוסמת יצירה חדשה עד לשחרורה
  const stuckJob = !generating && jobs.find((j) => ['generating', 'qa', 'repairing'].includes(j.status));

  const releaseStuckJob = async () => {
    await base44.entities.GenerationJob.update(stuckJob.id, {
      status: 'failed',
      error_message: 'המשימה בוטלה — היצירה הופסקה באמצע',
      finished_at: new Date().toISOString(),
    });
    setMessage(null);
    refresh();
  };

  const PIPELINE = [
    { icon: Search, label: 'איתור מקורות' },
    { icon: PenLine, label: 'כתיבה' },
    { icon: ShieldCheck, label: 'בדיקות דיוק ועברית' },
    { icon: Wrench, label: 'תיקון ממוקד' },
    { icon: FileText, label: 'Google Docs' },
  ];

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="surface p-6 md:p-8">
        <div className="eyebrow mb-1">שלב 7</div>
        <h2 className="text-xl font-bold text-stone-900 mb-1">יצירת התסריטים והמסמך</h2>
        <p className="text-sm text-stone-500 mb-5 leading-relaxed">
          Claude כותב כל תסריט רק מתוך הראיות שבספר הנהג. מידע שלא נמצא מושמט מהקריינות ומדווח כפער תיעוד.
          מסמך Google Docs נוצר רק אחרי שכל הבדיקות עברו.
        </p>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-6 text-xs text-stone-500">
          {PIPELINE.map(({ icon: Icon, label }, i) => (
            <li key={label} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5">
                <Icon className="w-3.5 h-3.5 text-stone-400" /> {label}
              </span>
              {i < PIPELINE.length - 1 && <span className="text-stone-300">←</span>}
            </li>
          ))}
        </ol>
        <div className="flex gap-3 flex-wrap">
          <Button onClick={generate} disabled={generating || !!stuckJob} className="rounded-xl bg-stone-900 hover:bg-stone-700 h-11 px-6">
            {generating ? (
              <><Loader2 className="w-4 h-4 ml-1 animate-spin" /> יוצר תסריטים...</>
            ) : (
              <><Sparkles className="w-4 h-4 ml-1 text-signal-300" /> {jobs.length ? 'יצירה מחדש (גרסה חדשה)' : 'יצירת התסריטים'}</>
            )}
          </Button>
          {latestPassed && (
            <Button onClick={() => createDoc(latestPassed)} disabled={creatingDoc || generating} variant="outline" className="rounded-xl h-11">
              {creatingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileText className="w-4 h-4 ml-1" /> יצירת מסמך Google Docs</>}
            </Button>
          )}
        </div>
        {generating && (
          <GenerationProgress
            label={progress || 'מתחיל...'}
            completedSteps={steps.completed}
            totalSteps={steps.total}
            elapsedSeconds={elapsed}
          />
        )}
        {(generating || Object.keys(taskStates).length > 0) && <TaskList tasks={tasks} states={taskStates} />}
        {stuckJob && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-signal-700 bg-signal-50 rounded-xl p-3">
            <span>משימת יצירה נשארה פתוחה מריצה קודמת שנקטעה. יש לשחרר אותה כדי להתחיל יצירה חדשה.</span>
            <Button size="sm" variant="outline" className="rounded-lg shrink-0" onClick={releaseStuckJob}>
              שחרור המשימה
            </Button>
          </div>
        )}
        {message?.type === 'success' && (
          <>
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl p-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> {message.text}
            </div>
            <JobIssues gaps={message.gaps} styleNotes={message.notes} className="mt-3" />
          </>
        )}
        {message?.type === 'error' && (
          <>
            <div className="mt-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-xl p-3">
              <XCircle className="w-4 h-4 shrink-0" /> היצירה לא הושלמה. הטיוטה נשמרה בהיסטוריה.
            </div>
            <JobIssues blocking={message.list} gaps={message.gaps} styleNotes={message.notes} className="mt-3" />
          </>
        )}
      </div>

      {outputs.length > 0 && (
        <div className="surface p-6">
          <h3 className="font-semibold text-stone-800 text-sm mb-3">מסמכים שנוצרו</h3>
          <div className="space-y-2">
            {outputs.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 bg-stone-50 rounded-xl px-4 py-3">
                <div className="text-sm text-stone-700 min-w-0 truncate">
                  {o.title} <span className="text-xs text-stone-400">v{o.version_number}</span>
                </div>
                <a href={o.doc_url} target="_blank" rel="noreferrer" className="shrink-0">
                  <Button size="sm" className="rounded-lg bg-stone-900"><ExternalLink className="w-3.5 h-3.5 ml-1" /> פתיחה</Button>
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="surface p-6">
          <h3 className="font-semibold text-stone-800 text-sm mb-3">היסטוריית יצירה</h3>
          <Accordion type="single" collapsible>
            {jobs.map((j) => {
              const st = JOB_STATUS[j.status] || { label: j.status, cls: 'bg-stone-100 text-stone-500' };
              const scripts = j.scripts?.general_script ? [j.scripts.general_script, ...(j.scripts.focused_scripts || [])] : [];
              return (
                <AccordionItem key={j.id} value={j.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-sm flex-wrap">
                      <Badge className={`${st.cls} border-0`}>{st.label}</Badge>
                      <span className="text-stone-500">{new Date(j.created_date).toLocaleString('he-IL')}</span>
                      <span className="text-xs text-stone-400">פרומפט v{j.prompt_version} · {j.required_model}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <JobIssues
                      blocking={j.blocking_issues || j.validation_issues}
                      gaps={j.documentation_gaps}
                      styleNotes={j.qa_style_notes}
                      className="mb-3"
                    />
                    {j.status !== 'passed' && j.status !== 'doc_created' && j.error_message && (
                      <p className="text-sm text-red-600 mb-3">{j.error_message}</p>
                    )}
                    {scripts.length > 0 && (
                      <div className="space-y-3">
                        {scripts.map((s, i) => <ScriptCard key={i} s={s} />)}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      )}
    </div>
  );
}
