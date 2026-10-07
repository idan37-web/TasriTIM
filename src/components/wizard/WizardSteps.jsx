import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';

const STEPS = [
  { label: 'פרטי הדגם', hint: 'שנה, שוק ורמת גימור' },
  { label: 'העלאת מסמכים', hint: 'ספר נהג ומפרט' },
  { label: 'זיהוי מערכות', hint: 'ניתוח המקורות' },
  { label: 'בחירת מערכות', hint: 'אישור והחרגה' },
  { label: 'איחוד וסידור', hint: 'קבוצות תסריטים' },
  { label: 'בדיקה ואישור', hint: 'חוסמים ואזהרות' },
  { label: 'יצירה ומסמך', hint: 'כתיבה, QA ו‑Google Docs' },
];

function StepBadge({ step, done, active }) {
  return (
    <span
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
        active
          ? 'bg-stone-900 text-white ring-4 ring-signal-200'
          : done
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-stone-100 text-stone-400'
      }`}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : step}
    </span>
  );
}

// בדסקטופ: סרגל אנכי דביק בצד; במסך צר: שורה אופקית נגללת
export default function WizardSteps({ current, maxReached, onSelect }) {
  const mobileActiveRef = useRef(null);

  // במסך צר השלב הפעיל עלול להיות מחוץ לתצוגה — גוללים אליו אופקית בלבד
  useEffect(() => {
    const el = mobileActiveRef.current;
    const scroller = el?.closest('nav');
    if (!el || !scroller || scroller.offsetParent === null) return;
    const target = el.offsetLeft - (scroller.clientWidth - el.clientWidth) / 2;
    scroller.scrollTo({ left: target, behavior: 'smooth' });
  }, [current]);

  return (
    <>
      <nav className="lg:hidden overflow-x-auto pb-1 mb-6 -mx-4 px-4" aria-label="שלבי האשף">
        <ol className="flex items-center gap-1 min-w-max">
          {STEPS.map(({ label }, i) => {
            const step = i + 1;
            const done = step < current;
            const active = step === current;
            const reachable = step <= maxReached;
            return (
              <li key={step} className="flex items-center" ref={active ? mobileActiveRef : undefined}>
                <button
                  onClick={() => reachable && onSelect(step)}
                  disabled={!reachable}
                  aria-current={active ? 'step' : undefined}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    active ? 'bg-white shadow-card text-stone-900' : reachable ? 'text-stone-500 hover:bg-white' : 'text-stone-300'
                  }`}
                >
                  <StepBadge step={step} done={done} active={active} />
                  {label}
                </button>
                {step < STEPS.length && <span className="w-3 h-px bg-stone-200" />}
              </li>
            );
          })}
        </ol>
      </nav>

      <nav className="hidden lg:block sticky top-24" aria-label="שלבי האשף">
        <div className="eyebrow px-3 mb-3">התקדמות הפרויקט</div>
        <ol className="relative">
          {STEPS.map(({ label, hint }, i) => {
            const step = i + 1;
            const done = step < current;
            const active = step === current;
            const reachable = step <= maxReached;
            return (
              <li key={step} className="relative">
                {step < STEPS.length && (
                  <span
                    className={`absolute right-[25px] top-11 bottom-[-6px] w-px ${step < maxReached ? 'bg-emerald-200' : 'bg-stone-200'}`}
                    aria-hidden="true"
                  />
                )}
                <button
                  onClick={() => reachable && onSelect(step)}
                  disabled={!reachable}
                  aria-current={active ? 'step' : undefined}
                  className={`relative w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-right transition-colors ${
                    active ? 'bg-white shadow-card' : reachable ? 'hover:bg-white/70' : 'cursor-default'
                  }`}
                >
                  <StepBadge step={step} done={done} active={active} />
                  <span className="min-w-0 pt-0.5">
                    <span className={`block text-sm font-medium ${active ? 'text-stone-900' : reachable ? 'text-stone-600' : 'text-stone-300'}`}>
                      {label}
                    </span>
                    <span className={`block text-xs ${reachable ? 'text-stone-400' : 'text-stone-300'}`}>{hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
