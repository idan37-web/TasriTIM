import { PDFDocument } from 'pdf-lib';

// חילוץ הטקסט חייב להסתיים בתוך 120 שניות — לכן מפצלים לחלקים קטנים לפי עמודים
const MAX_PAGES = 15;

/**
 * מפצל קובץ PDF לחלקים של עד MAX_PAGES עמודים.
 * קבצים שאינם PDF, או PDF קצר, מוחזרים כמו שהם.
 */
export async function splitLargePdf(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) return [file];

  const bytes = await file.arrayBuffer();
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  if (pageCount <= MAX_PAGES) return [file];

  const baseName = file.name.replace(/\.pdf$/i, '');
  const out = [];
  for (let start = 0, idx = 1; start < pageCount; start += MAX_PAGES, idx++) {
    const doc = await PDFDocument.create();
    const indices = [];
    for (let p = start; p < Math.min(start + MAX_PAGES, pageCount); p++) indices.push(p);
    const copied = await doc.copyPages(src, indices);
    copied.forEach((p) => doc.addPage(p));
    const saved = await doc.save();
    out.push(new File([saved], `${baseName} - חלק ${idx}.pdf`, { type: 'application/pdf' }));
  }
  return out;
}