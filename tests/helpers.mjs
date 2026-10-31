import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const demo = (f) => path.join(root, 'public', 'demo', f);
export const readDemo = (f) => readFileSync(demo(f), 'utf8');

/** Same extraction as src/core/ingest/pdfExtract.js, using pdf.js's Node build. */
export async function extractPdfNode(file, password) {
  const data = new Uint8Array(readFileSync(file));
  const task = pdfjs.getDocument({ data, password, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const c = await page.getTextContent();
    pages.push({ items: c.items.filter((it) => typeof it.str === 'string').map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })) });
  }
  await task.destroy();
  return pages;
}
