// Browser-only: extracts positioned text items from a PDF with pdf.js, entirely on-device.
// The file never leaves the browser. Supports password-protected statements.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfPasswordError extends Error {
  constructor(kind) {
    super(kind === 'incorrect' ? 'Incorrect PDF password' : 'This PDF is password protected');
    this.name = 'PdfPasswordError';
    this.kind = kind; // 'required' | 'incorrect'
  }
}

export class ScannedPdfError extends Error {
  constructor() {
    super('This PDF has no selectable text (looks scanned). OCR support is planned — please use a text PDF or CSV for now.');
    this.name = 'ScannedPdfError';
  }
}

export async function extractPdfPages(arrayBuffer, password) {
  if (arrayBuffer.byteLength > 15 * 1024 * 1024) throw new Error('PDF too large (max 15 MB)');
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    password: password || undefined,
    isEvalSupported: false, // hardening: never evaluate code from fonts
    disableAutoFetch: true,
    enableXfa: false,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') {
      throw new PdfPasswordError(e.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required');
    }
    throw e;
  }
  const pages = [];
  let chars = 0;
  const maxPages = Math.min(pdf.numPages, 60);
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => typeof it.str === 'string')
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    chars += items.reduce((a, it) => a + it.str.trim().length, 0);
    pages.push({ items });
  }
  await task.destroy();
  if (chars < 30) throw new ScannedPdfError();
  return pages;
}
