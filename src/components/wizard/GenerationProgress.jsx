import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes === 0) return `כ‑${rest} שניות`;
  return `כ‑${minutes} דק׳${rest > 0 ? ` ו‑${rest} שניות` : ''}`;
}

// בר התקדמות לצינור היצירה: אימות ← כתיבת תסריטים ← בדיקות איכות
export default function GenerationProgress({ label, completedSteps, totalSteps, elapsedSeconds }) {
  const percent = totalSteps > 0 ? Math.min(99, Math.round((completedSteps / totalSteps) * 100)) : 0;
  const remainingSteps = Math.max(0, totalSteps - completedSteps);
  const eta = completedSteps > 0 && elapsedSeconds > 0
    ? formatEta((elapsedSeconds / completedSteps) * remainingSteps)
    : null;

  return (
    <div className="mt-4 bg-stone-50 border border-stone-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 text-sm text-stone-700">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{label}</span>
        </div>
        <span className="text-xs text-stone-500 shrink-0">{percent}%</span>
      </div>
      <Progress value={percent} className="h-2" />
      <div className="flex items-center justify-between mt-2 text-xs text-stone-500">
        <span>שלב {Math.min(completedSteps + 1, totalSteps)} מתוך {totalSteps}</span>
        <span>{eta ? `צפי סיום: ${eta}` : 'מחשב צפי סיום...'}</span>
      </div>
    </div>
  );
}