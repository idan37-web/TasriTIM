import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AVAILABILITY } from './Step3Systems';
import { Search, Plus, Pencil, Check, ArrowLeft, Info } from 'lucide-react';

const CATEGORIES = ['בטיחות', 'נוחות', 'מולטימדיה', 'שימושיות', 'נהיגה', 'תאורה', 'אחרת'];

export default function Step4Checklist({ project, goToStep }) {
  const [systems, setSystems] = useState([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState('אחרת');
  const [addOpen, setAddOpen] = useState(false);
  const [infoId, setInfoId] = useState(null);

  const refresh = () =>
    base44.entities.SystemItem.filter({ project_id: project.id }, 'category', 500).then(setSystems);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const toggle = async (s, included) => {
    setSystems((prev) => prev.map((x) => (x.id === s.id ? { ...x, included } : x)));
    await base44.entities.SystemItem.update(s.id, { included });
  };

  const togglePartial = async (s, allow_partial_evidence) => {
    setSystems((prev) => prev.map((x) => (x.id === s.id ? { ...x, allow_partial_evidence } : x)));
    await base44.entities.SystemItem.update(s.id, { allow_partial_evidence });
  };

  const toggleCategory = async (cat, included) => {
    const items = systems.filter((s) => s.category === cat);
    setSystems((prev) => prev.map((x) => (x.category === cat ? { ...x, included } : x)));
    for (const s of items) await base44.entities.SystemItem.update(s.id, { included });
  };

  const saveName = async (s) => {
    setEditingId(null);
    if (editName.trim() && editName !== s.name_he) {
      await base44.entities.SystemItem.update(s.id, { name_he: editName.trim() });
      refresh();
    }
  };

  const addManual = async () => {
    if (!newName.trim()) return;
    await base44.entities.SystemItem.create({
      project_id: project.id,
      name_he: newName.trim(),
      category: newCat,
      availability_status: 'manual',
      included: true,
      manual_added: true,
      confidence: 'high',
      has_ops_instructions: false,
      why_training: 'נוספה ידנית על ידי המשתמש',
    });
    setNewName('');
    setAddOpen(false);
    refresh();
  };

  const filtered = systems.filter((s) => {
    if (search && !`${s.name_he} ${s.name_commercial || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (catFilter !== 'all' && s.category !== catFilter) return false;
    if (statusFilter !== 'all' && s.availability_status !== statusFilter) return false;
    return true;
  });

  const byCategory = CATEGORIES.map((cat) => ({ cat, items: filtered.filter((s) => s.category === cat) })).filter(
    (g) => g.items.length > 0
  );
  const includedCount = systems.filter((s) => s.included).length;

  return (
    <div className="space-y-5">
      <div className="surface p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-lg font-bold text-stone-900">בחירת מערכות לתסריטים</h2>
            <p className="text-sm text-stone-500">
              {includedCount} מתוך {systems.length} מערכות מסומנות להכללה. החרגה היא מחייבת — מערכת שבוטלה לא תוזכר בשום תוצר.
            </p>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-lg">
                <Plus className="w-4 h-4 ml-1" /> הוספת מערכת ידנית
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>הוספת מערכת ידנית</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם המערכת בעברית" className="rounded-xl" />
                <Select value={newCat} onValueChange={setNewCat}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={addManual} className="rounded-xl bg-stone-900 w-full">הוספה</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-stone-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש מערכת..." className="rounded-xl pr-9" />
          </div>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="rounded-xl w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הקטגוריות</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="rounded-xl w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              <SelectItem value="verified">מאומתת</SelectItem>
              <SelectItem value="not_in_spec">לא אושרה לדגם</SelectItem>
              <SelectItem value="missing_ops">חסר מקור תפעולי</SelectItem>
              <SelectItem value="manual">נוספה ידנית</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {byCategory.map(({ cat, items }) => (
        <div key={cat} className="surface overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
            <span className="font-semibold text-stone-800 text-sm">{cat} ({items.length})</span>
            <div className="flex gap-2">
              <button onClick={() => toggleCategory(cat, true)} className="text-xs text-emerald-600 hover:underline">בחירת הכל</button>
              <button onClick={() => toggleCategory(cat, false)} className="text-xs text-stone-400 hover:underline">ביטול הכל</button>
            </div>
          </div>
          <div className="divide-y divide-stone-100">
            {items.map((s) => {
              const av = AVAILABILITY[s.availability_status] || AVAILABILITY.verified;
              return (
                <div key={s.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {editingId === s.id ? (
                        <div className="flex items-center gap-1">
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 rounded-lg w-48" autoFocus />
                          <button onClick={() => saveName(s)} className="text-emerald-600"><Check className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <>
                          <span className="font-medium text-stone-900 text-sm">{s.name_he}</span>
                          <button onClick={() => { setEditingId(s.id); setEditName(s.name_he); }} className="text-stone-300 hover:text-stone-600">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {s.name_commercial && <span className="text-xs text-stone-400" dir="ltr">{s.name_commercial}</span>}
                      <Badge className={`${av.cls} border-0 text-[10px]`}>{av.label}</Badge>
                      <button onClick={() => setInfoId(infoId === s.id ? null : s.id)} className="text-stone-300 hover:text-stone-600">
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-stone-400 hidden sm:block">לכלול בתסריטים</span>
                      <Switch checked={!!s.included} onCheckedChange={(v) => toggle(s, v)} />
                    </div>
                  </div>
                  {s.included && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-stone-500 cursor-pointer">
                      <Checkbox
                        checked={!!s.allow_partial_evidence}
                        onCheckedChange={(v) => togglePartial(s, !!v)}
                      />
                      התעלמות מחוסר הסבר תפעולי פרטני — כתיבה לפי המידע המאומת בלבד
                    </label>
                  )}
                  {infoId === s.id && (
                    <div className="mt-2 text-xs text-stone-500 bg-stone-50 rounded-lg p-3 space-y-1">
                      <div>{s.why_training}</div>
                      {s.source_note && <div>מקור אימות: {s.source_note}</div>}
                      {s.source_pages?.length > 0 && <div>עמודים: {s.source_pages.join(', ')}</div>}
                      {s.aliases?.length > 0 && <div dir="ltr" className="text-left">{s.aliases.join(', ')}</div>}
                      {s.mismatch_note && <div className="text-amber-600">⚠ {s.mismatch_note}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <Button onClick={() => goToStep(5)} disabled={includedCount === 0} className="rounded-xl bg-stone-900 hover:bg-stone-700">
          המשך לאיחוד וסידור <ArrowLeft className="w-4 h-4 mr-1" />
        </Button>
      </div>
    </div>
  );
}