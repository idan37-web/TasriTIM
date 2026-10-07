import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Car, ChevronLeft } from 'lucide-react';

const STATUS_LABELS = {
  draft: { label: 'טיוטה', cls: 'bg-stone-100 text-stone-600' },
  systems_identified: { label: 'מערכות זוהו', cls: 'bg-blue-50 text-blue-700' },
  plan_approved: { label: 'תוכנית אושרה', cls: 'bg-amber-50 text-amber-700' },
  generated: { label: 'תסריטים נוצרו', cls: 'bg-emerald-50 text-emerald-700' },
  published: { label: 'פורסם', cls: 'bg-emerald-100 text-emerald-800' },
};

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    base44.entities.VehicleProject.list('-updated_date', 100).then(setProjects);
  }, []);

  const createProject = async () => {
    setCreating(true);
    const project = await base44.entities.VehicleProject.create({ status: 'draft', current_step: 1 });
    navigate(`/project/${project.id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">הפרויקטים שלי</h1>
          <p className="text-stone-500 text-sm mt-1">תסריטי הדרכה לפי דגם רכב</p>
        </div>
        <Button onClick={createProject} disabled={creating} className="rounded-xl bg-stone-900 hover:bg-stone-700">
          <Plus className="w-4 h-4 ml-1" /> פרויקט חדש
        </Button>
      </div>

      {!projects ? (
        <div className="flex justify-center py-20">
          <div className="w-7 h-7 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-2xl border border-dashed border-stone-300">
          <Car className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-stone-500 mb-4">עדיין אין פרויקטים. פתחו פרויקט לדגם חדש כדי להתחיל.</p>
          <Button onClick={createProject} disabled={creating} variant="outline" className="rounded-xl">
            <Plus className="w-4 h-4 ml-1" /> פתיחת פרויקט ראשון
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => {
            const st = STATUS_LABELS[p.status] || STATUS_LABELS.draft;
            return (
              <button
                key={p.id}
                onClick={() => navigate(`/project/${p.id}`)}
                className="flex items-center justify-between bg-white rounded-2xl border border-stone-200 p-5 text-right hover:shadow-md hover:border-stone-300 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-stone-100 flex items-center justify-center">
                    <Car className="w-5 h-5 text-stone-500" />
                  </div>
                  <div>
                    <div className="font-semibold text-stone-900">
                      {p.manufacturer || p.model ? `${p.manufacturer || ''} ${p.model || ''} ${p.model_year || ''}` : 'פרויקט ללא שם'}
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5">
                      {[p.trim_level, p.market].filter(Boolean).join(' · ') || 'טרם הוזנו פרטי דגם'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className={`${st.cls} border-0 font-medium`}>{st.label}</Badge>
                  <ChevronLeft className="w-4 h-4 text-stone-300" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}