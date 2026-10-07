import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';

const FIELDS = [
  { key: 'manufacturer', label: 'יצרן', required: false },
  { key: 'model', label: 'דגם', required: false },
  { key: 'model_year', label: 'שנת דגם', required: true },
  { key: 'market', label: 'שוק יעד / מדינה', required: true },
  { key: 'trim_level', label: 'רמת גימור', required: true },
  { key: 'drivetrain', label: 'סוג הנעה', required: false },
  { key: 'seats', label: 'מספר מושבים (אם רלוונטי)', required: false },
];

export default function Step1Details({ project, updateProject, goToStep }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries([...FIELDS.map((f) => [f.key, project[f.key] || '']), ['notes', project.notes || '']])
  );
  const [touched, setTouched] = useState(false);

  const save = (key) => {
    if (values[key] !== (project[key] || '')) updateProject({ [key]: values[key] });
  };

  const missing = FIELDS.filter((f) => f.required && !values[f.key]?.trim());
  const canContinue = missing.length === 0;

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 max-w-3xl">
      <h2 className="text-lg font-bold text-stone-900 mb-1">פרטי הדגם</h2>
      <p className="text-sm text-stone-500 mb-6">
        שנת הדגם, שוק היעד ורמת הגימור הם שדות חובה — ספרי נהג עשויים לתאר מספר גרסאות שונות.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <Label className="text-stone-700 mb-1.5 block">
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </Label>
            <Input
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onBlur={() => save(f.key)}
              className={`rounded-xl ${touched && f.required && !values[f.key]?.trim() ? 'border-red-300' : ''}`}
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <Label className="text-stone-700 mb-1.5 block">הערות מיוחדות לדגם</Label>
          <Textarea
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            onBlur={() => save('notes')}
            className="rounded-xl min-h-[90px]"
          />
        </div>
      </div>
      {touched && !canContinue && (
        <p className="text-sm text-red-600 mt-4">חסרים שדות חובה: {missing.map((f) => f.label).join(', ')}</p>
      )}
      <div className="flex justify-end mt-8">
        <Button
          onClick={() => {
            setTouched(true);
            if (canContinue) goToStep(2);
          }}
          className="rounded-xl bg-stone-900 hover:bg-stone-700"
        >
          המשך להעלאת מסמכים <ArrowLeft className="w-4 h-4 mr-1" />
        </Button>
      </div>
    </div>
  );
}