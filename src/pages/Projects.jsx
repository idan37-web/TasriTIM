import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Car, Search, ChevronLeft } from 'lucide-react';

const STATUS_LABELS = {
  draft: { label: 'טיוטה', cls: 'bg-stone-100 text-stone-600', dot: 'bg-stone-400' },
  systems_identified: { label: 'מערכות זוהו', cls: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  plan_approved: { label: 'תוכנית אושרה', cls: 'bg-signal-50 text-signal-700', dot: 'bg-signal-500' },
  generated: { label: 'תסריטים נוצרו', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  published: { label: 'פורסם', cls: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-600' },
};

const TOTAL_STEPS = 7;

function projectName(p) {
  return p.manufacturer || p.model
    ? `${p.manufacturer || ''} ${p.model || ''} ${p.model_year || ''}`.trim()
    : 'פרויקט ללא שם';
}

function StatTile({ label, value }) {
  return (
    <div className="surface px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="text-2xl font-heading font-semibold text-stone-900 mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    base44.entities.VehicleProject.list('-updated_date', 100).then(setProjects);
  }, []);

  const createProject = async () => {
    setCreating(true);
    const project = await base44.entities.VehicleProject.create({ status: 'draft', current_step: 1 });
    navigate(`/project/${project.id}`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!projects || !q) return projects;
    return projects.filter((p) =>
      [p.manufacturer, p.model, p.model_year, p.trim_level, p.market].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [projects, query]);

  const stats = useMemo(() => {
    const list = projects || [];
    return {
      total: list.length,
      inProgress: list.filter((p) => !['generated', 'published'].includes(p.status)).length,
      published: list.filter((p) => p.status === 'published').length,
    };
  }, [projects]);

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="eyebrow mb-1">סביבת עבודה</div>
          <h1 className="text-3xl font-bold text-stone-900">הפרויקטים שלי</h1>
          <p className="text-stone-500 text-sm mt-1">מספר הנהג ועד תסריט מוכן להפקה, דגם אחר דגם</p>
        </div>
        <Button onClick={createProject} disabled={creating} className="rounded-xl bg-stone-900 hover:bg-stone-700 h-11 px-5">
          <Plus className="w-4 h-4 ml-1" /> פרויקט חדש
        </Button>
      </div>

      {projects && projects.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6 max-w-xl">
          <StatTile label="פרויקטים" value={stats.total} />
          <StatTile label="בעבודה" value={stats.inProgress} />
          <StatTile label="פורסמו" value={stats.published} />
        </div>
      )}

      {!projects ? (
        <div className="flex justify-center py-20">
          <div className="w-7 h-7 border-4 border-stone-200 border-t-signal-500 rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 px-6 surface border-dashed">
          <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
            <Car className="w-7 h-7 text-stone-400" />
          </div>
          <h2 className="font-semibold text-stone-900 mb-1">עדיין אין פרויקטים</h2>
          <p className="text-stone-500 text-sm mb-5">פותחים פרויקט לדגם, מעלים את ספר הנהג והמפרט, והאשף מוביל משם.</p>
          <Button onClick={createProject} disabled={creating} className="rounded-xl bg-stone-900 hover:bg-stone-700">
            <Plus className="w-4 h-4 ml-1" /> פתיחת פרויקט ראשון
          </Button>
        </div>
      ) : (
        <>
          <div className="relative max-w-sm mb-4">
            <Search className="w-4 h-4 text-stone-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש לפי יצרן, דגם או שנה"
              className="rounded-xl pr-9 bg-white"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const st = STATUS_LABELS[p.status] || STATUS_LABELS.draft;
              const step = Math.min(TOTAL_STEPS, p.current_step || 1);
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/project/${p.id}`)}
                  className="group surface p-5 text-right hover:shadow-lift hover:border-stone-300 transition-all flex flex-col gap-4"
                >
                  <div className="flex items-start justify-between gap-3 w-full">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-stone-100 group-hover:bg-stone-900 transition-colors flex items-center justify-center shrink-0">
                        <Car className="w-5 h-5 text-stone-500 group-hover:text-white transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-stone-900 truncate">{projectName(p)}</div>
                        <div className="text-xs text-stone-400 mt-0.5 truncate">
                          {[p.trim_level, p.market].filter(Boolean).join(' · ') || 'טרם הוזנו פרטי דגם'}
                        </div>
                      </div>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-stone-300 group-hover:text-stone-600 shrink-0 mt-1 transition-colors" />
                  </div>
                  <div className="w-full">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-medium ${st.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} /> {st.label}
                      </span>
                      <span className="text-stone-400 tabular-nums">שלב {step} מתוך {TOTAL_STEPS}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                      <div className="h-full rounded-full bg-signal-400" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && <p className="text-sm text-stone-400 mt-4">לא נמצאו פרויקטים שתואמים לחיפוש.</p>}
        </>
      )}
    </div>
  );
}
