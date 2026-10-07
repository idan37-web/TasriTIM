// פיצול דטרמיניסטי של שמות מערכות מורכבים למערכות אטומיות.
// חל על כל פרויקט וכל ספר נהג — אינו תלוי בכך שהמודל יציית להנחיית הפרומפט.

const JOIN_SPLIT = /\s*(?:,|;|\/|\||\s\+\s|\sו־|\sו-|\sוגם\s|\sand\s)\s*/;

function cleanPart(value) {
  return String(value || '')
    .replace(/^\s*[-–—•*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "תאורה אוטומטית וחיישן גשם" → שני חלקים. ו' החיבור מפוצלת רק כשהיא פותחת מילה חדשה
// ואחריה נשארות לפחות שתי מילים משמעותיות, כדי לא לשבור שמות כמו "אור וצל".
function splitVavConjunction(part) {
  const words = part.split(' ');
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (!/^ו[\u0590-\u05ff]{3,}$/.test(word)) continue;
    const left = words.slice(0, i).join(' ');
    const right = [word.slice(1), ...words.slice(i + 1)].join(' ');
    if (left.split(' ').length >= 2 && right.split(' ').length >= 2) {
      return [left, ...splitVavConjunction(right)];
    }
  }
  return [part];
}

export function splitSystemName(name) {
  const parts = String(name || '')
    .split(JOIN_SPLIT)
    .map(cleanPart)
    .filter(Boolean)
    .flatMap(splitVavConjunction)
    .map(cleanPart)
    .filter((part) => part.length > 2);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique : [cleanPart(name)].filter(Boolean);
}

// מפרק רשומת מערכת שהמודל החזיר לכמה רשומות אטומיות, ומצמיד לכל אחת רק את הכינויים שלה.
export function atomizeSystem(system) {
  const names = splitSystemName(system.name_he);
  if (names.length <= 1) return [system];

  const aliasPool = [...(system.aliases || []), system.name_commercial]
    .filter(Boolean)
    .flatMap((alias) => splitSystemName(alias));

  return names.map((name) => {
    const key = name.toLowerCase();
    const aliases = [...new Set(aliasPool.filter((alias) => {
      const candidate = alias.toLowerCase();
      return candidate !== key && (candidate.includes(key) || key.includes(candidate));
    }))];
    return {
      ...system,
      name_he: name,
      name_commercial: aliases.find((alias) => /[a-z]/i.test(alias)) || '',
      aliases,
      // כל חלק נבדק בנפרד מול ספר הנהג, ולכן הערות התאמה נקבעות מחדש בהמשך
      mismatch_note: ''
    };
  });
}