import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, Sparkles, XCircle, CheckCircle2, ExternalLink, FileText } from 'lucide-react';
import GenerationProgress from './GenerationProgress';
import JobIssues from './JobIssues';

const JOB_STATUS = {
  generating: { label: 'כותב תסריטים...', cls: 'bg-blue-50 text-blue-700' },
  qa: { label: 'בבדיקות איכות', cls: 'bg-amber-50 text-amber-700' },
  repairing: { label: 'בתיקון ממוקד', cls: 'bg-indigo-50 text-indigo-700' },
  passed: { label: 'עבר את כל הבדיקות', cls: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'נכשל בבדיקות', cls: 'bg-red-50 text-red-700' },
  doc_created: { label: 'מסמך נוצר', cls: 'bg-emerald-100 text-emerald-800' },
};

export default function Step7Generate({ project }) {
  const [jobs, setJobs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [message, setMessage] = useState(null);
  const [progress, setProgress] = useState('');
  const [steps, setSteps] = useState({ completed: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);

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

  // היצירה מפוצלת לשלבים קצרים — כל בקשה נשארת בתוך מגבלת הזמן של השרת
  const generate = async () => {
    setGenerating(true);
    setMessage(null);
    setSteps({ completed: 0, total: 3 });
    try {
      setProgress('בודק את התוכנית ומכין חבילות ראיות...');
      const startRes = await base44.functions.invoke('generateVehicleScripts', {
        action: 'start',
        project_id: project.id,
      });
      const { job_id, tasks } = startRes.data;
      setSteps({ completed: 1, total: tasks.length + 2 });
      refresh();

      for (let i = 0; i < tasks.length; i++) {
        setProgress(`כותב תסריט ${i + 1} מתוך ${tasks.length}: ${tasks[i].title}`);
        try {
          await base44.functions.invoke('generateVehicleScripts', { action: 'write', job_id, target: tasks[i].target, attempt: 1 });
        } catch (writeError) {
          // ניסיון חוזר יחיד — הקריאה אידמפוטנטית, ולכן target שהושלם לא ייכתב שוב
          setProgress(`כותב מחדש תסריט ${i + 1} מתוך ${tasks.length}: ${tasks[i].title}`);
          await base44.functions.invoke('generateVehicleScripts', { action: 'write', job_id, target: tasks[i].target, attempt: 2 });
        }
        setSteps({ completed: i + 2, total: tasks.length + 2 });
      }

      setProgress('מריץ בדיקות איכות ותיקון ממוקד אם נדרש...');
      const qaRes = await base44.functions.invoke('generateVehicleScripts', { action: 'qa', job_id });
      const gaps = qaRes.data?.documentation_gaps || [];
      const notes = qaRes.data?.style_notes || [];
      const rounds = qaRes.data?.repair_rounds || 0;
      if (qaRes.data?.ok) {
        const parts = ['התסריטים נוצרו ועברו את כל בדיקות האיכות.'];
        if (rounds > 0) parts.push(`בוצע תיקון ממוקד ב-${rounds} סבבים.`);
        if (gaps.length > 0) parts.push(`${gaps.length} פערי תיעוד נרשמו כהערות.`);
        setMessage({ type: 'success', text: parts.join(' '), gaps, notes });
        // המסמך נוצר אוטומטית לאחר PASS; הכפתור נשמר כ-Retry
        setProgress('יוצר מסמך Google Docs...');
        try {
          const docRes = await base44.functions.invoke('createGoogleDocsDocument', { job_id });
          if (docRes.data?.doc_url) {
            setMessage({ type: 'success', text: `${parts.join(' ')} המסמך נוצר ב‑Google Docs.`, gaps, notes });
          }
        } catch (docError) {
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
  const stuckJob = !generating && jobs.find((j) => j.status === 'generating' || j.status === 'qa');

  const releaseStuckJob = async () => {
    await base44.entities.GenerationJob.update(stuckJob.id, {
      status: 'failed',
      error_message: 'המשימה בוטלה — היצירה הופסקה באמצע',
      finished_at: new Date().toISOString(),
    });
    setMessage(null);
    refresh();
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8">
        <h2 className="text-lg font-bold text-stone-900 mb-1">יצירת התסריטים והמסמך</h2>
        <p className="text-sm text-stone-500 mb-5">
          היצירה מתבצעת עם gpt-5.6-sol בלבד, בשלבים: חבילות ראיות ← כתיבה ← בדיקת דיוק דטרמיניסטית ← בדיקת תוכן ועברית. מסמך Google Docs ייווצר רק אם כל הבדיקות עברו.
        </p>
        <div className="flex gap-3 flex-wrap">
          <Button onClick={generate} disabled={generating} className="rounded-xl bg-stone-900 hover:bg-stone-700 h-11 px-6">
            {generating ? (
              <><Loader2 className="w-4 h-4 ml-1 animate-spin" /> יוצר תסריטים...</>
            ) : (
              <><Sparkles className="w-4 h-4 ml-1" /> {jobs.length ? 'יצירה מחדש (גרסה חדשה)' : 'יצירת התסריטים'}</>
            )}
          </Button>
          {latestPassed && (
            <Button onClick={() => createDoc(latestPassed)} disabled={creatingDoc} variant="outline" className="rounded-xl h-11">
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
        {stuckJob && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-amber-800 bg-amber-50 rounded-xl p-3">
            <span>משימת יצירה נשארה פתוחה מריצה קודמת שנקטעה — יש לשחרר אותה כדי להתחיל יצירה חדשה.</span>
            <Button size="sm" variant="outline" className="rounded-lg shrink-0" onClick={releaseStuckJob}>
              שחרור המשימה
            </Button>
          </div>
        )}
        {message?.type === 'success' && (
          <>
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl p-3">
              <CheckCircle2 className="w-4 h-4" /> {message.text}
            </div>
            <JobIssues gaps={message.gaps} styleNotes={message.notes} className="mt-3" />
          </>
        )}
        {message?.type === 'error' && (
          <>
            <div className="mt-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-xl p-3">
              <XCircle className="w-4 h-4" /> היצירה לא הושלמה — הטיוטה נשמרה
            </div>
            <JobIssues blocking={message.list} gaps={message.gaps} styleNotes={message.notes} className="mt-3" />
          </>
        )}
      </div>

      {outputs.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6">
          <h3 className="font-semibold text-stone-800 text-sm mb-3">מסמכים שנוצרו</h3>
          <div className="space-y-2">
            {outputs.map((o) => (
              <div key={o.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-4 py-3">
                <div className="text-sm text-stone-700">{o.title} <span className="text-xs text-stone-400">v{o.version_number}</span></div>
                <a href={o.doc_url} target="_blank" rel="noreferrer">
                  <Button size="sm" className="rounded-lg bg-stone-900"><ExternalLink className="w-3.5 h-3.5 ml-1" /> פתיחה ב‑Google Docs</Button>
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6">
          <h3 className="font-semibold text-stone-800 text-sm mb-3">היסטוריית יצירה</h3>
          <Accordion type="single" collapsible>
            {jobs.map((j) => {
              const st = JOB_STATUS[j.status] || { label: j.status, cls: 'bg-stone-100 text-stone-500' };
              const scripts = j.scripts?.general_script ? [j.scripts.general_script, ...(j.scripts.focused_scripts || [])] : [];
              return (
                <AccordionItem key={j.id} value={j.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-sm">
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
                        {scripts.map((s, i) => (
                          <div key={i} className="bg-stone-50 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-sm text-stone-800">{s.title}</span>
                              <span className="text-xs text-stone-400">{s.word_count} מילים · כ‑{s.estimated_duration_minutes} דק׳</span>
                            </div>
                            <p className="text-sm text-stone-600 whitespace-pre-wrap leading-relaxed">{s.narration}</p>
                            {(s.source_references || []).length > 0 && (
                              <div className="mt-3 pt-3 border-t border-stone-200 text-xs text-stone-400">
                                <div className="font-medium mb-1">מקורות לאימות – לא לקריינות:</div>
                                {s.source_references.map((r, k) => <div key={k}>{r}</div>)}
                              </div>
                            )}
                          </div>
                        ))}
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