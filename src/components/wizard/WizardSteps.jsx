import { Check } from 'lucide-react';

const STEPS = [
  'פרטי הדגם',
  'העלאת מסמכים',
  'זיהוי מערכות',
  'בחירת מערכות',
  'איחוד וסידור',
  'בדיקה ואישור',
  'יצירה ב‑Google Docs',
];

export default function WizardSteps({ current, maxReached, onSelect }) {
  return (
    <div className="overflow-x-auto pb-1 mb-8">
      <div className="flex items-center gap-1 min-w-max">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;
          const reachable = step <= maxReached;
          return (
            <div key={step} className="flex items-center">
              <button
                onClick={() => reachable && onSelect(step)}
                disabled={!reachable}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  active
                    ? 'bg-stone-900 text-white'
                    : done
                    ? 'text-emerald-700 hover:bg-emerald-50'
                    : reachable
                    ? 'text-stone-500 hover:bg-stone-100'
                    : 'text-stone-300 cursor-default'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    active ? 'bg-white text-stone-900' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-400'
                  }`}
                >
                  {done ? <Check className="w-3 h-3" /> : step}
                </span>
                {label}
              </button>
              {step < 7 && <div className="w-4 h-px bg-stone-200 mx-0.5" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}