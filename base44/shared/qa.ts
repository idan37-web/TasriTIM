// בדיקות דיוק דטרמיניסטיות על תוצאת ה-JSON של התסריטים.
// מפריד בין הפרות אמת (blocking) לבין פערי תיעוד/סטייה סגנונית (gaps).
// gaps לעולם אינם מפילים משימה — הם נשמרים לשקיפות בלבד.

export function runDeterministicAudit(result, systems, groups) {
  const blocking = [];
  const gaps = [];
  if (!result || !result.general_script) {
    blocking.push("לא נוצר תסריט סרטון כללי");
    return { blocking, gaps };
  }
  const included = systems.filter((s) => s.included);
  const excluded = systems.filter((s) => !s.included);
  const includedIds = new Set(included.map((s) => s.id));
  const scripts = [result.general_script, ...(result.focused_scripts || [])];

  for (const script of scripts) {
    const narration = script.narration || "";
    const title = script.title || "ללא כותרת";
    const longPauses = (narration.match(/\(הפסקה ארוכה\)/g) || []).length;
    if (longPauses !== 1) {
      blocking.push(`בתסריט "${title}" נמצאו ${longPauses} סימוני "(הפסקה ארוכה)" במקום אחד בדיוק`);
    } else if (!narration.trim().endsWith("(הפסקה ארוכה)")) {
      blocking.push(`בתסריט "${title}" סימון "(הפסקה ארוכה)" אינו בסוף התסריט`);
    }
    if (/[{}]/.test(narration)) {
      blocking.push(`בתסריט "${title}" יש סוגריים מסולסלים בתוך טקסט הקריינות`);
    }
    for (const id of script.included_system_ids || []) {
      if (!includedIds.has(id)) {
        blocking.push(`בתסריט "${title}" מופיעה מערכת שאינה מסומנת להכללה`);
      }
    }
    for (const ex of excluded) {
      const names = [ex.name_he, ex.name_commercial].filter((n) => n && n.length > 3);
      for (const n of names) {
        if (narration.includes(n) || title.includes(n)) {
          blocking.push(`המערכת המוחרגת "${n}" מוזכרת בתסריט "${title}"`);
        }
      }
    }
    // הפניות המקור נבנות בצד השרת מחבילות הראיות — היעדרן מעיד על תקלת צינור אמיתית
    if (!Array.isArray(script.source_references) || script.source_references.length === 0) {
      blocking.push(`לתסריט "${title}" אין הפניות מקור לאימות`);
    }
  }

  // כל קבוצה מאושרת קיבלה תסריט אחד בדיוק, ואין תסריטים לקבוצות לא מאושרות
  const activeGroups = groups.filter((g) => g.script_type === "focused" && !g.cancelled);
  const byGroup = {};
  for (const fs of result.focused_scripts || []) {
    byGroup[fs.group_id] = (byGroup[fs.group_id] || 0) + 1;
  }
  for (const g of activeGroups) {
    if ((byGroup[g.id] || 0) !== 1) {
      blocking.push(`הקבוצה "${g.title}" לא קיבלה תסריט אחד בדיוק (התקבלו ${byGroup[g.id] || 0})`);
    }
  }
  for (const gid of Object.keys(byGroup)) {
    if (!activeGroups.some((g) => g.id === gid)) {
      blocking.push("נוצר תסריט לקבוצה שלא אושרה בתוכנית ההפקה");
    }
  }

  // אורך הסרטון הכללי — סטייה סגנונית, לא הפרת דיוק
  const wc = (result.general_script.narration || "").split(/\s+/).filter(Boolean).length;
  if (wc < 450 || wc > 850) {
    gaps.push(`אורך הסרטון הכללי הוא ${wc} מילים — מחוץ ליעד של כ‑600–700 מילים`);
  }

  return { blocking, gaps };
}