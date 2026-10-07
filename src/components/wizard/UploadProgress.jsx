import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';

// סרגל התקדמות לעיבוד חלקי הקבצים, כולל הערכת זמן שנותר
export default function UploadProgress({ docs }) {
  const total = docs.length;
  if (!total) return null;

  const done = docs.filter((d) => d.extraction_status === 'done').length;
  const errors = docs.filter((d) => d.extraction_status === 'error').length;
  const remaining = total - done - errors;
  const pct = Math.round(((done + errors) / total) * 100);

  // זמן ממוצע לחלק שהושלם, ומכיוון שמעובדים 6 חלקים במקביל — הזמן מחולק ב‑6
  const durations = docs
    .filter((d) => d.extraction_status === 'done')
    .map((d) => (new Date(d.updated_date) - new Date(d.created_date)) / 1000)
    .filter((s) => s > 1 && s < 600);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 90;
  const etaSec = Math.round((remaining / 6) * avg);
  const etaLabel =
    etaSec < 60 ? 'פחות מדקה' : `כ‑${Math.ceil(etaSec / 60)} דקות`;

  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between mb-2 text-sm">
        <div className="font-medium text-stone-800 flex items-center gap-2">
          {remaining > 0 && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
          {remaining > 0 ? 'מעבד את הקבצים' : 'העיבוד הושלם'}
        </div>
        <div className="text-stone-500">
          {done} מתוך {total} חלקים עובדו
          {errors > 0 && <span className="text-red-500"> · {errors} בשגיאה</span>}
        </div>
      </div>
      <Progress value={pct} className="h-2" />
      <div className="flex items-center justify-between mt-2 text-xs text-stone-400">
        <span>{pct}%</span>
        {remaining > 0 && <span>זמן משוער לסיום: {etaLabel}</span>}
      </div>
    </div>
  );
}