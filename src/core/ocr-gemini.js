/**
 * ocr-gemini.js — /api/ocr-extract Gemini 호출 클라이언트.
 *
 * 입력: File (image / PDF) + docType
 * 출력: { ok, extracted, error? }
 *
 * Gemini 가 PDF 직접 처리하므로 PDF→이미지 변환 불필요. base64 변환만 하면 됨.
 */

const ENDPOINT = '/api/ocr-extract';

/** File → base64 (data URL prefix 제거) */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.replace(/^data:[^;]+;base64,/, ''));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 문서 OCR — Gemini schema-based extraction.
 * @param {File} file
 * @param {'vehicle_reg'|'business_reg'|'bankbook'} docType
 * @param {object} [opts]
 * @param {(stage:string)=>void} [opts.onProgress]
 * @returns {Promise<{ok:boolean, extracted?:object, error?:string}>}
 */
export async function extractDocument(file, docType, opts = {}) {
  const { onProgress } = opts;
  if (!file) return { ok: false, error: 'file 없음' };
  try {
    onProgress?.('파일 인코딩 중...');
    const base64 = await fileToBase64(file);
    const mimeType = file.type
      || (file.name?.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

    onProgress?.('Gemini OCR 분석 중...');
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64, mimeType, docType }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, extracted: data.extracted || {} };
  } catch (e) {
    console.error('[ocr-gemini]', e);
    return { ok: false, error: e?.message || String(e) };
  }
}
