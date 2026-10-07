import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, FileCheck } from 'lucide-react';

export default function Step6Review({ project, updateProject, goToStep }) {
  const [data, setData] = useState(null);
  const [validation, setValidation] = useState(null);
  const [model, setModel] = useState(null);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    (async () => {
      const [docs, systems, groups] = await Promise.all([
        base44.entities.SourceDocument.filter({ project_id: project.id }, '-created_date', 100),
        base44.entities.SystemItem.filter({ project_id: project.id }, 'name_he', 500),
        base44.entities.ScriptGroup.filter({ project_id: project.id }, 'order_index', 200),
      ]);
      setData({ docs, systems, groups });
      const [v, m] = await Promise.all([
        base44.functions.invoke('validateApprovedPlan', { project_id: project.id }).then((r) => r.data).catch((e) => ({ blockers: [e.message] })),
        base44.functions.invoke('verifyRequiredModel', {}).then((r) => r.data).catch(() => ({ available: false })),
      ]);
      setValidation(v);
      setModel(m);
    })();
  }, [project.id]);

  if (!data || !validation || !model) {
    return (
      <div className="flex flex-col items-center py-20 gap-3">
        <div className="w-7 h-7 border-4 border-stone-200 border-t-signal-500 rounded-full animate-spin" />
        <p className="text-sm text-stone-400">מריץ בדיקות לפני יצירה...</p>
      </div>
    );
  }

  const included = data.systems.filter((s) => s.included);
  const excluded = data.systems.filter((s) => !s.included);
  const activeGroups = data.groups.filter((g) => !g.cancelled).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  const blockers = [...(validation.blockers || [])];
  if (!model.available) blockers.push(`המודל ${model.required_model || 'ה-AI'} אינו זמין, היצירה חסומה${model.error ? ` (${model.error})` : ''}`);
  const canApprove = blockers.length === 0;

  const approve = async () => {
    setApproving(true);
    await updateProject({ status: 'plan_approved' });
    goToStep(7);
  };

  const Section = ({ title, children }) => (
    <div className="surface p-5">
      <h3 className="font-semibold text-stone-800 text-sm mb-3">{title}</h3>
      {children}
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      {blockers.length > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 font-semibold text-red-700 mb-2">
            <XCircle className="w-5 h-5" /> לא ניתן ליצור — נדרש טיפול
          </div>
          <ul className="text-sm text-red-600 space-y-1 pr-6 list-disc">
            {blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center gap-2 text-emerald-700 font-semibold">
          <CheckCircle2 className="w-5 h-5" /> כל הבדיקות עברו — התוכנית מוכנה לאישור
        </div>
      )}
      {(validation.warnings || []).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-700">
          <div className="flex items-center gap-2 font-medium mb-1"><AlertTriangle className="w-4 h-4" /> {validation.needs_review_count || 0} פריטי מידע דורשים בדיקה</div>
          {(validation.warnings || []).map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <Section title="פרטי הרכב">
        <div className="text-sm text-stone-600">
          {project.manufacturer} {project.model} {project.model_year} · {project.trim_level} · {project.market}
          {project.drivetrain ? ` · ${project.drivetrain}` : ''}{project.seats ? ` · ${project.seats} מושבים` : ''}
        </div>
      </Section>

      <Section title={`קבצים שהועלו (${data.docs.length})`}>
        <div className="space-y-1 text-sm text-stone-600">
          {data.docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <FileCheck className="w-3.5 h-3.5 text-stone-400" /> {d.file_name}
              <span className="text-xs text-stone-400">({d.extraction_status === 'done' ? 'עובד' : d.extraction_status})</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid sm:grid-cols-2 gap-4">
        <Section title={`מערכות שייכללו (${included.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {included.map((s) => <Badge key={s.id} className="bg-emerald-50 text-emerald-700 border-0 font-normal">{s.name_he}</Badge>)}
          </div>
        </Section>
        <Section title={`מערכות שהוחרגו (${excluded.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {excluded.map((s) => <Badge key={s.id} className="bg-stone-100 text-stone-500 border-0 font-normal line-through">{s.name_he}</Badge>)}
            {excluded.length === 0 && <span className="text-xs text-stone-400">אין</span>}
          </div>
        </Section>
      </div>

      <Section title="מפת התסריטים וסדרם">
        <ol className="space-y-1.5 text-sm text-stone-700">
          <li className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-stone-900 text-white text-[10px] flex items-center justify-center font-bold">1</span>
            סרטון היכרות כללי (כ‑5 דקות: כניסה והנעה, התאמות אישיות, תאורה ואיתות, מולטימדיה וקישוריות, מערכות בטיחות)
          </li>
          {activeGroups.filter((g) => g.script_type === 'focused').map((g, i) => (
            <li key={g.id} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-[10px] flex items-center justify-center font-bold">{i + 2}</span>
              {g.title} {(g.system_ids || []).length > 1 && <span className="text-xs text-stone-400">(מאוחד)</span>}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="סטטוס תשתית">
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            {validation.google_connected ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
            חיבור Google: {validation.google_connected ? `מחובר (${validation.google_account || ''} · ${validation.google_folder || ''})` : 'אינו מחובר'}
          </div>
          <div className="flex items-center gap-2">
            {model.available ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
            מודל {model.required_model || 'ה-AI'}: {model.available ? 'זמין' : 'אינו זמין'}
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={approve} disabled={!canApprove || approving} className="rounded-xl bg-stone-900 hover:bg-stone-700 h-11 px-6">
          {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'אישור ויצירת התסריטים'}
        </Button>
      </div>
    </div>
  );
}