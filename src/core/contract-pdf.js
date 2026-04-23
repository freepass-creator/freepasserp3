/**
 * 계약서 PDF 생성 + 서명 임베딩 (2026 방식)
 * - html2canvas: iframe의 HTML 템플릿을 캔버스로 캡처
 * - jsPDF: 캔버스를 PDF로 변환 (A4 멀티페이지)
 * - pdf-lib: 기존 PDF에 서명 PNG 임베딩
 * - Firebase Storage: 최종 PDF 저장
 */
import { uploadFile } from '../firebase/storage-helper.js';

const CDN = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  jsPDF: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  pdfLib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureHtml2canvas() {
  if (!window.html2canvas) await loadScript(CDN.html2canvas);
  return window.html2canvas;
}
async function ensureJsPDF() {
  if (!window.jspdf) await loadScript(CDN.jsPDF);
  return window.jspdf.jsPDF;
}
async function ensurePdfLib() {
  if (!window.PDFLib) await loadScript(CDN.pdfLib);
  return window.PDFLib;
}

/**
 * iframe 문서 → PDF Blob (A4 멀티페이지)
 */
export async function generatePdfFromIframe(iframeEl) {
  const html2canvas = await ensureHtml2canvas();
  const jsPDF = await ensureJsPDF();

  const doc = iframeEl.contentDocument;
  const body = doc.body;

  // 고해상도 캡처
  const canvas = await html2canvas(body, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    windowWidth: body.scrollWidth,
    windowHeight: body.scrollHeight,
  });

  // A4: 210 × 297 mm
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;

  let remaining = imgH;
  let position = 0;
  pdf.addImage(canvas, 'JPEG', 0, position, imgW, imgH, '', 'FAST');
  remaining -= pageH;
  while (remaining > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(canvas, 'JPEG', 0, position, imgW, imgH, '', 'FAST');
    remaining -= pageH;
  }

  return pdf.output('blob');
}

/**
 * 계약서 PDF를 Firebase에 업로드
 */
export async function uploadContractPdf(contractCode, blob, { suffix = 'unsigned' } = {}) {
  const ts = Date.now();
  const path = `contracts/${contractCode}/contract_${suffix}_${ts}.pdf`;
  const file = new File([blob], `contract_${suffix}.pdf`, { type: 'application/pdf' });
  return uploadFile(path, file); // { url, path }
}

/**
 * 기존 PDF에 서명 이미지 임베딩 (마지막 페이지에)
 * @param {Blob|ArrayBuffer|string(url)} pdfSource
 * @param {string} signaturePngDataUrl - base64 data URL
 * @param {object} opts - { x, y, width, height, pageIndex } (mm 단위 / 0-based pageIndex, -1 = 마지막)
 */
export async function embedSignatureInPdf(pdfSource, signaturePngDataUrl, opts = {}) {
  const { PDFDocument } = await ensurePdfLib();

  let pdfBytes;
  if (pdfSource instanceof ArrayBuffer) {
    pdfBytes = pdfSource;
  } else if (pdfSource instanceof Blob) {
    pdfBytes = await pdfSource.arrayBuffer();
  } else if (typeof pdfSource === 'string') {
    const res = await fetch(pdfSource);
    pdfBytes = await res.arrayBuffer();
  } else {
    throw new Error('지원하지 않는 PDF 소스');
  }

  const pdf = await PDFDocument.load(pdfBytes);
  // base64 → Uint8Array
  const base64 = signaturePngDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const pngImage = await pdf.embedPng(bytes);

  const pageCount = pdf.getPageCount();
  const pageIdx = opts.pageIndex == null || opts.pageIndex === -1 ? pageCount - 1 : opts.pageIndex;
  const page = pdf.getPage(pageIdx);
  const { width: pw, height: ph } = page.getSize();

  // mm → PDF 포인트 (1mm = 2.834645pt)
  const mmToPt = 2.834645;
  const sigW = (opts.width || 60) * mmToPt;
  const sigH = (opts.height || 25) * mmToPt;
  // 기본 위치: 페이지 하단 우측 (70mm from bottom, right side)
  const x = opts.x != null ? opts.x * mmToPt : pw - sigW - 20 * mmToPt;
  const y = opts.y != null ? opts.y * mmToPt : 30 * mmToPt;

  page.drawImage(pngImage, { x, y, width: sigW, height: sigH });

  const out = await pdf.save();
  return new Blob([out], { type: 'application/pdf' });
}

/**
 * 바로 다운로드
 */
export function downloadPdf(blob, filename = 'contract.pdf') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
