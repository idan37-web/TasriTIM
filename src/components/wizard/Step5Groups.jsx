import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Sparkles, Loader2, GripVertical, Merge, Split, Pencil, Check, Ban, RotateCcw, Lock, ArrowLeft } from 'lucide-react';

export default function Step5Groups({ project, goToStep }) {
  const [groups, setGroups] = useState([]);
  const [systems, setSystems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  const refresh = async () => {
    const [g, s] = await Promise.all([
      base44.entities.ScriptGroup.filter({ project_id: project.id }, 'order_index', 200),
      base44.entities.SystemItem.filter({ project_id: project.id, included: true }, 'name_he', 500),
    ]);
    setGroups(g || []);
    setSystems(s || []);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const sysName = (id) => systems.find((s) => s.id === id)?.name_he || '';
  const focused = groups.filter((g) => g.script_type === 'focused').sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  const general = groups.find((g) => g.script_type === 'general');

  const suggest = async () => {
    setSuggesting(true);
    try {
      await base44.functions.invoke('suggestScriptGroups', { project_id: project.id });
    } finally {
      setSuggesting(false);
      refresh();
    }
  };

  const mergeSelected = async () => {
    const toMerge = focused.filter((g) => selected.includes(g.id) && !g.cancelled);
    if (toMerge.length < 2) return;
    const allIds = toMerge.flatMap((g) => g.system_ids || []);
    const first = toMerge[0];
    await base44.entities.ScriptGroup.update(first.id, {
      system_ids: allIds,
      title: toMerge.map((g) => g.title).join(' + '),
      user_modified: true,
    });
    for (const g of toMerge.slice(1)) await base44.entities.ScriptGroup.delete(g.id);
    setSelected([]);
    refresh();
  };

  const splitGroup = async (g) => {
    const ids = g.system_ids || [];
    if (ids.length < 2) return;
    await base44.entities.ScriptGroup.update(g.id, { system_ids: [ids[0]], title: sysName(ids[0]) || g.title, user_modified: true });
    let order = g.order_index || 0;
    await base44.entities.ScriptGroup.bulkCreate(
      ids.slice(1).map((id) => ({
        project_id: project.id,
        title: sysName(id) || 'תסריט',
        system_ids: [id],
        order_index: ++order,
        script_type: 'focused',
        user_modified: true,
      }))
    );
    refresh();
  };

  const saveTitle = async (g) => {
    setEditingId(null);
    if (editTitle.trim() && editTitle !== g.title) {
      await base44.entities.ScriptGroup.update(g.id, { title: editTitle.trim(), user_modified: true });
      refresh();
    }
  };

  const toggleCancel = async (g) => {
    await base44.entities.ScriptGroup.update(g.id, { cancelled: !g.cancelled, user_modified: true });
    refresh();
  };

  const onDragEnd = async (result) => {
    if (!result.destination) return;
    const items = [...focused];
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setGroups([general, ...items.map((g, i) => ({ ...g, order_index: i + 1 }))].filter(Boolean));
    for (let i = 0; i < items.length; i++) {
      await base44.entities.ScriptGroup.update(items[i].id, { order_index: i + 1, user_modified: true });
    }
  };

  const activeCount = focused.filter((g) => !g.cancelled).length;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-stone-900 mb-1">מפת התסריטים</h2>
            <p className="text-sm text-stone-500 max-w-xl">
              אחדו מערכות לתסריט אחד, פצלו, שנו שם וגררו לשינוי הסדר. החלטתכם גוברת על הצעת המערכת.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={mergeSelected} disabled={selected.length < 2} variant="outline" size="sm" className="rounded-lg">
              <Merge className="w-4 h-4 ml-1" /> איחוד לתסריט אחד
            </Button>
            <Button onClick={suggest} disabled={suggesting} size="sm" className="rounded-lg bg-stone-900 hover:bg-stone-700">
              {suggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4 ml-1" /> הצעת מפת תסריטים</>}
            </Button>
          </div>
        </div>
      </div>

      {/* הסרטון הכללי — יחידה נעולה, תמיד ראשונה */}
      <div className="bg-stone-900 text-white rounded-2xl p-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Lock className="w-4 h-4 text-stone-400" /> סרטון היכרות כללי
          </div>
          <p className="text-xs text-stone-400 mt-1">
            כ‑5 דקות · כניסה והנעה, התאמות אישיות, תאורה ואיתות, מולטימדיה וקישוריות, מערכות בטיחות · אינו ניתן לאיחוד
          </p>
        </div>
        <Badge className="bg-white/10 text-white border-0">ראשון תמיד</Badge>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="groups">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
              {focused.map((g, index) => (
                <Draggable key={g.id} draggableId={g.id} index={index}>
                  {(prov) => (
                    <div
                      ref={prov.innerRef}
                      {...prov.draggableProps}
                      className={`bg-white rounded-2xl border p-4 ${g.cancelled ? 'opacity-50 border-dashed border-stone-300' : 'border-stone-200'}`}
                    >
                      <div className="flex items-center gap-3">
                        <span {...prov.dragHandleProps} className="text-stone-300 cursor-grab">
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <Checkbox
                          checked={selected.includes(g.id)}
                          onCheckedChange={(v) =>
                            setSelected((prev) => (v ? [...prev, g.id] : prev.filter((x) => x !== g.id)))
                          }
                          disabled={g.cancelled}
                        />
                        <div className="flex-1 min-w-0">
                          {editingId === g.id ? (
                            <div className="flex items-center gap-1">
                              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-8 rounded-lg" autoFocus />
                              <button onClick={() => saveTitle(g)} className="text-emerald-600"><Check className="w-4 h-4" /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className={`font-medium text-sm ${g.cancelled ? 'line-through text-stone-400' : 'text-stone-900'}`}>
                                {g.title}
                              </span>
                              <button onClick={() => { setEditingId(g.id); setEditTitle(g.title); }} className="text-stone-300 hover:text-stone-600">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {(g.system_ids || []).length > 1 && (
                                <Badge variant="outline" className="text-[10px] rounded-md">מאוחד · {g.system_ids.length} מערכות</Badge>
                              )}
                              {g.user_modified && <Badge className="bg-blue-50 text-blue-600 border-0 text-[10px]">נערך ידנית</Badge>}
                            </div>
                          )}
                          <div className="text-xs text-stone-400 mt-1 truncate">
                            {(g.system_ids || []).map(sysName).filter(Boolean).join(' · ')}
                          </div>
                          {g.merge_reason && !g.user_modified && (
                            <div className="text-[11px] text-stone-400 mt-0.5">הצעת איחוד: {g.merge_reason}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {(g.system_ids || []).length > 1 && !g.cancelled && (
                            <button onClick={() => splitGroup(g)} title="פיצול" className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100">
                              <Split className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => toggleCancel(g)} title={g.cancelled ? 'שחזור' : 'ביטול תסריט'} className="p-1.5 text-stone-400 hover:text-red-500 rounded-lg hover:bg-stone-100">
                            {g.cancelled ? <RotateCcw className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {focused.length === 0 && (
        <div className="text-center py-10 text-sm text-stone-400 bg-white rounded-2xl border border-dashed border-stone-300">
          לחצו על "הצעת מפת תסריטים" כדי לקבל חלוקה מוצעת לפי המערכות שנבחרו.
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => goToStep(6)} disabled={activeCount === 0} className="rounded-xl bg-stone-900 hover:bg-stone-700">
          המשך לבדיקה ואישור <ArrowLeft className="w-4 h-4 mr-1" />
        </Button>
      </div>
    </div>
  );
}