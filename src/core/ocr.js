/**
 * ocr.js — Google Vision OCR (jpkerp/static/js/core/ocr.js 포팅)
 *
 * 이미지 → Vision API TEXT_DETECTION
 * PDF → pdf.js로 페이지별 이미지 변환 → OCR
 */

// Flask 프록시 경유 — API 키는 서버 env(GOOGLE_VISION_API_KEY)에 보관
const ENDPOINT = '/api/ocr';

// ─── pdf.js 동적 로드 ─────────────────────────────────────
let _pdfjsReady = null;
function loadPdfjs() {
  if (_pdfjsReady) return _pdfjsReady;
  _pdfjsReady = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs')
    .then(mod => {
      mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
      return mod;
    })
    .catch(err => { _pdfjsReady = null; throw err; });
  return _pdfjsReady;
}

async function pdfToImages(file, scale = 2.0) {
  const pdfjsLib = await loadPdfjs();
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const images = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
  }
  return images;
}

async function ocrBase64(base64) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) throw new Error(`OCR API: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || 'OCR 실패');
  return data.text || '';
}

/**
 * 파일 → OCR 텍스트
 * @param {File} file
 * @param {object} [opts]
 * @returns {Promise<{text: string, lines: string[]}>}
 */
export async function ocrFile(file, opts = {}) {
  const { concurrency = 6, scale = 1.5, onProgress } = opts;
  const progress = (stage, done, total, message) => onProgress?.({ stage, done, total, message });
  const ext = file.name.split('.').pop().toLowerCase();
  let fullText = '';

  if (ext === 'pdf') {
    progress('render', 0, 1, 'PDF 분석 중...');
    const pdfjsLib = await loadPdfjs();
    const arrayBuf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    const total = pdf.numPages;

    // 1단계: 텍스트 레이어 직접 추출 시도 (디지털 PDF)
    const texts = new Array(total);
    let hasText = false;
    for (let i = 0; i < total; i++) {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => it.str).join(' ');
      texts[i] = pageText;
      if (pageText.replace(/\s/g, '').length > 30) hasText = true;
      progress('render', i + 1, total, `텍스트 ${i + 1}/${total}`);
    }

    if (hasText) {
      fullText = texts.join('\n\n--- 페이지 구분 ---\n\n');
    } else {
      const images = await pdfToImages(file, scale);
      const ocrTexts = new Array(total);
      let nextIdx = 0, done = 0;
      progress('ocr', 0, total, `OCR 0/${total}`);
      await Promise.all(Array.from({ length: Math.min(concurrency, total) }, async () => {
        while (true) {
          const i = nextIdx++;
          if (i >= total) break;
          try { ocrTexts[i] = await ocrBase64(images[i]); }
          catch (e) { ocrTexts[i] = ''; console.warn(`[OCR] page ${i + 1}`, e); }
          done++;
          progress('ocr', done, total, `OCR ${done}/${total}`);
        }
      }));
      fullText = ocrTexts.join('\n\n--- 페이지 구분 ---\n\n');
    }
  } else {
    progress('ocr', 0, 1, 'OCR 중...');
    const base64 = await fileToBase64(file);
    fullText = await ocrBase64(base64);
    progress('ocr', 1, 1, 'OCR 완료');
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  return { text: fullText, lines };
}

/* ── 공용 추출 유틸 ── */
export function extractCarNumber(text) {
  const m = text.match(/\d{2,3}[가-힣]\s?\d{4}/g);
  return m ? m[0].replace(/\s/g, '') : null;
}

export function extractVin(text) {
  const m = text.match(/[A-HJ-NPR-Z0-9]{17}/g);
  return m ? m[0] : null;
}

export function extractDate(text) {
  const patterns = [
    /(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?/,
    /(\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const y = m[1].length === 2 ? (Number(m[1]) < 50 ? 2000 + Number(m[1]) : 1900 + Number(m[1])) : Number(m[1]);
      return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    }
  }
  return null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
