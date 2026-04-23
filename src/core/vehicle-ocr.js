/**
 * 차량등록증 OCR — Claude Vision
 * 이미지 파일 업로드 → 차량번호/제조사/모델/세부모델 추출
 */
import { findCarModel } from './car-models.js';

/**
 * File → base64 (data URL 헤더 제거)
 */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * PDF 첫 페이지 → base64 JPEG
 */
async function pdfFirstPageToBase64(file) {
  const pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
}

/**
 * 차량등록증 이미지 OCR
 * @param {File} file - 이미지 파일 (jpg/png)
 * @returns {Promise<{car_number, maker, model, sub_model, year, vin, fuel_type, displacement, registration_date, matched: {maker, model, sub_model}}>}
 */
/**
 * 범용 차량 문서 OCR
 * @param {File} file
 * @param {'registration'|'insurance'|'violation'} docType
 */
export async function ocrVehicleDoc(file, docType = 'registration') {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const base64 = isPdf ? await pdfFirstPageToBase64(file) : await fileToBase64(file);
  const mediaType = isPdf ? 'image/jpeg' : (file.type || 'image/jpeg');

  const res = await fetch('/api/claude-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, media_type: mediaType, doc_type: docType }),
  });

  if (!res.ok) throw new Error(`OCR API: ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.message || 'OCR 실패');

  return json.data || {};
}

export async function ocrVehicleRegistration(file) {
  const data = await ocrVehicleDoc(file, 'registration');
  const matched = findCarModel({ maker: data.maker, model: data.model }) || {};
  return {
    ...data,
    matched: {
      maker: matched.maker || data.maker || '',
      model: matched.model || data.model || '',
      sub_model: matched.sub_model || data.sub_model || '',
    },
  };
}

/** 보험증 OCR */
export async function ocrInsurance(file) {
  return ocrVehicleDoc(file, 'insurance');
}

/** 위반기록 OCR */
export async function ocrViolation(file) {
  return ocrVehicleDoc(file, 'violation');
}
