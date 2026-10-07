// בניית חבילות ראיות: שליפת מקטעי ספר נהג רלוונטיים לכל מערכת והקשר רציף מאותו מסמך בלבד.
import { MANUAL_DOC_TYPES } from './constants.ts';

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[&/־–—-]+/g, ' ')
    .replace(/[^a-z0-9\u0590-\u05ff\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function systemTerms(system) {
  const terms = [system.name_he, system.name_commercial, ...(system.aliases || [])]
    .map(normalize)
    .filter((term) => term.length > 1);
  return [...new Set(terms)];
}

const GENERIC_WORDS = new Set([
  'מערכת', 'מערכות', 'בקרת', 'התרעת', 'התרעה', 'אוטומטי', 'אוטומטית',
  'אקטיבית', 'חשמלי', 'אלחוטי', 'הפעלה', 'פעולה', 'נהיגה', 'רכב',
  'system', 'control', 'active', 'automatic', 'auto'
]);

function canonicalWord(word) {
  let value = normalize(word);
  if (value.length >= 5 && /^[והבלמשכ]/.test(value)) value = value.slice(1);
  if (/^(?:תרעת|תראת|התרעת|התראת)$/.test(value)) return 'התרא';
  // ריבוי עברי: "אורות"→"אור", "גבוהים"→"גבוה", "אוטומטיים"→"אוטומטי"
  if (value.length >= 5 && /(?:יים|ים|ות)$/.test(value)) value = value.replace(/(?:יים|ים|ות)$/, '');
  if (value.length > 5 && /[הת]$/.test(value)) value = value.slice(0, -1);
  return value;
}

function tokenSet(value) {
  return new Set(normalize(value).split(/\s+/).map(canonicalWord).filter(Boolean));
}

function canonicalPhrase(value) {
  return normalize(value).split(/\s+/).map(canonicalWord).filter(Boolean).join(' ');
}

function meaningfulTermWords(term) {
  return [...new Set(normalize(term)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !GENERIC_WORDS.has(word))
    .map(canonicalWord)
    .filter((word) => word.length > 1))];
}

function termMatchesSection(term, sectionSearch) {
  const canonicalTerm = canonicalPhrase(term);
  if (canonicalTerm && sectionSearch.phrase.includes(canonicalTerm)) return true;
  const words = meaningfulTermWords(term);
  if (words.length >= 2) {
    const required = words.length === 2 ? 2 : Math.max(2, Math.ceil(words.length * 0.66));
    return words.filter((word) => sectionSearch.words.has(word)).length >= required;
  }
  return words.length === 1 && words[0].length >= 4 && sectionSearch.words.has(words[0]);
}

function termsOverlap(first, second) {
  const a = new Set(meaningfulTermWords(first));
  const b = new Set(meaningfulTermWords(second));
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

function significantWords(system) {
  return [...new Set(systemTerms(system)
    .join(' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !GENERIC_WORDS.has(word))
    .map(canonicalWord)
    .filter((word) => word.length > 2))];
}

export async function fetchAllSections(base44, projectId, documentIds = null) {
  const allowedIds = documentIds ? new Set(documentIds) : null;
  const all = [];
  let skip = 0;
  while (skip < 10000) {
    const batch = await base44.entities.ManualSection.filter(
      { project_id: projectId },
      'order_index',
      500,
      skip
    );
    all.push(...(batch || []).filter((section) => !allowedIds || allowedIds.has(section.document_id)));
    if (!batch || batch.length < 500) break;
    skip += 500;
  }
  return all;
}

function scoreSection(prepared, terms, words) {
  const { section, heading, headingWords, textWords, canonicalHeading, canonicalText } = prepared;
  const canonicalTerms = terms.map(canonicalPhrase);
  const exactHeading = canonicalTerms.filter((term) => canonicalHeading.includes(term));
  const exactText = canonicalTerms.filter((term) => canonicalText.includes(term));
  const matchedWords = words.filter((word) => headingWords.has(word) || textWords.has(word));
  const minimumWords = words.length <= 1 ? 1 : 2;

  // מילה כללית בודדת אינה ראיה למערכת שלמה.
  if (exactHeading.length === 0 && exactText.length === 0 && matchedWords.length < minimumWords) return 0;

  // עמודי אינדקס וחיווי מזכירים מערכות רבות אך אינם כוללים הוראות תפעול.
  const lowValueHeading = /(תוכן העניינים|מכשירים ובקרות בלוח המחוונים|נוריות אזהרה)/.test(heading);
  if (lowValueHeading && exactHeading.length === 0) return 0;

  return exactHeading.length * 120 + exactText.length * 80 + matchedWords.reduce(
    (total, word) => total + (headingWords.has(word) ? 18 : 6),
    0
  );
}

// חישוב מקדים פעם אחת לכל מקטע — מונע נרמול חוזר של כל ספר הנהג עבור כל מערכת בנפרד.
const preparedCache = new WeakMap();

function prepareSections(allSections) {
  const cached = preparedCache.get(allSections);
  if (cached) return cached;
  const prepared = allSections.map((section) => {
    const heading = normalize(section.heading);
    const text = normalize(section.text);
    const content = `${heading} ${text}`;
    const canonicalHeading = canonicalPhrase(heading);
    const canonicalText = canonicalPhrase(text);
    return {
      section,
      heading,
      headingWords: tokenSet(heading),
      textWords: tokenSet(text),
      canonicalHeading,
      canonicalText,
      phrase: `${canonicalHeading} ${canonicalText}`,
      words: tokenSet(content),
      operational: hasOperationalText(content)
    };
  });
  preparedCache.set(allSections, prepared);
  return prepared;
}

// זיהוי טקסט תפעולי — רחב דיו לספרי נהג מתורגמים/OCR.
// חשוב: זו אינדיקציה לכך שיש ראיה שימושית למערכת, ולא הוכחה שכל תרחיש התפעול מתועד.
const OPERATIONAL_PATTERN = /(?:לחצו|לחיצה|לחצן|לחיצה ממושכת|החזיקו|געו|הקישו|סובבו|סיבוב|הזיזו|משכו|דחפו|בחרו|בחירה|הגדירו|הגדרה|הגדרות|הפעילו|הפעלה|הפעלה מחדש|כבו|כיבוי|השבתה|ביטול|הגבירו|הנמיכו|כוונו|כוונון|הפשירו|באמצעות|בתצוגה|במסך|בצג|בלוח הבקרה|תפריט|מתג|גלגלון|ידית|מצב|ניתן|כדי|press|long press|hold|touch|tap|rotate|turn|slide|pull|push|select|choose|adjust|increase|decrease|setting|settings|menu|switch|display|screen|dashboard|turn on|turn off|activate|deactivate|disable|enable|restart)/;

function hasOperationalText(content) {
  return OPERATIONAL_PATTERN.test(content);
}

// הפניות מקור דטרמיניסטיות — נבנות מהראיות שסופקו, ולא מהחזרה של המודל.
export function buildSourceReferences(packets) {
  const refs = [];
  const seen = new Set();
  for (const packet of packets || []) {
    for (const excerpt of packet.excerpts || []) {
      const key = `${excerpt.file_name}|${excerpt.page}|${excerpt.heading}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = [excerpt.file_name, excerpt.page != null ? `עמוד ${excerpt.page}` : null, excerpt.heading]
        .filter(Boolean)
        .join(', ');
      if (parts) refs.push(parts);
    }
  }
  return refs.slice(0, 60);
}

function addUnique(target, seen, section) {
  if (!section || seen.has(section.id)) return;
  seen.add(section.id);
  target.push(section);
}

function excerptAroundMatch(section, terms, words, maxLength) {
  const rawText = String(section.text || '');
  const normalizedText = normalize(rawText);
  let matchIndex = -1;

  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const index = normalizedText.indexOf(term);
    if (index >= 0) {
      matchIndex = index;
      break;
    }
  }
  if (matchIndex < 0) {
    let offset = 0;
    for (const token of normalizedText.split(/\s+/)) {
      if (words.includes(canonicalWord(token))) {
        matchIndex = offset;
        break;
      }
      offset += token.length + 1;
    }
  }

  // האינדקס בטקסט המנורמל קרוב מספיק לאינדקס המקורי ושומר את הטקסט המקורי לקריאה.
  const start = matchIndex < 0 ? 0 : Math.max(0, matchIndex - 500);
  return rawText.slice(start, start + maxLength);
}

export function buildPacketForSystem(system, allSections, maxChars = 8000) {
  const terms = systemTerms(system);
  const words = significantWords(system);
  const prepared = prepareSections(allSections);
  const matchedTerms = terms.filter((term) =>
    prepared.some((sectionSearch) => termMatchesSection(term, sectionSearch))
  );
  // מערכות מגיעות אטומיות (splitSystemName/atomizeSystem), ולכן כל שם מייצג מערכת אחת:
  // ראיה מספיקה = מקטע בספר הנהג שתואם את המערכת ומכיל תוכן תפעולי ממשי.
  const requiredComponentTerms = [];
  const unmatchedComponentTerms = [];
  const ranked = prepared
    .map((item) => ({ section: item.section, operational: item.operational, score: scoreSection(item, terms, words) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.section.order_index || 0) - (b.section.order_index || 0));
  const operationalMatches = ranked.filter((item) => item.operational);

  const byDocument = new Map();
  for (const section of allSections) {
    if (!byDocument.has(section.document_id)) byDocument.set(section.document_id, []);
    byDocument.get(section.document_id).push(section);
  }
  for (const sections of byDocument.values()) {
    sections.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  }

  // קודם מוסיפים את כל ההתאמות עצמן; רק אחר כך הקשר סמוך. כך תקציב קצר לעולם לא נצרך לפני המקור הרלוונטי.
  const ordered = [];
  const seen = new Set();
  // מקטעים עם הוראות תפעול קודמים לאזכורים כלליים, כדי שלא ייחתכו מתקציב הראיות.
  const strongest = [...operationalMatches.slice(0, 14), ...ranked.slice(0, 16)];
  for (const { section } of strongest) addUnique(ordered, seen, section);
  for (const { section } of strongest.slice(0, 6)) {
    const documentSections = byDocument.get(section.document_id) || [];
    const index = documentSections.findIndex((candidate) => candidate.id === section.id);
    for (const offset of [-1, 1, 2]) {
      addUnique(ordered, seen, documentSections[index + offset]);
    }
  }
  for (const { section } of ranked) addUnique(ordered, seen, section);

  const excerpts = [];
  let total = 0;
  for (const section of ordered) {
    const remaining = maxChars - total;
    if (remaining <= 0) break;
    // מקטע בודד לא יצרוך את כל התקציב — כך נכנסות יותר כותרות תפעוליות שונות לחבילת הראיות
    const text = excerptAroundMatch(section, terms, words, Math.min(2200, remaining));
    if (!text.trim()) continue;
    total += text.length;
    excerpts.push({
      file_name: section.file_name || '',
      page: section.page,
      heading: section.heading || '',
      text
    });
  }

  return {
    system_id: system.id,
    system_name: system.name_he,
    terms,
    matched_terms: matchedTerms,
    required_component_terms: requiredComponentTerms,
    unmatched_component_terms: unmatchedComponentTerms,
    evidence_sufficient: excerpts.length > 0 && operationalMatches.length > 0,
    operational_match_count: operationalMatches.length,
    excerpt_count: excerpts.length,
    excerpts
  };
}

export async function buildEvidencePackets(base44, projectId, systems, maxCharsPerSystem = 8000) {
  const documents = await base44.entities.SourceDocument.filter({ project_id: projectId });
  const manualDocumentIds = (documents || [])
    .filter((document) => MANUAL_DOC_TYPES.includes(document.doc_type) && document.extraction_status === 'done')
    .map((document) => document.id);
  const allSections = await fetchAllSections(base44, projectId, manualDocumentIds);
  return systems.map((system) => buildPacketForSystem(system, allSections, maxCharsPerSystem));
}