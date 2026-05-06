/**
 * Gemini 기반 문서 구조화 OCR (jpkerp-v4 패턴 포팅).
 *
 *   POST /api/ocr-extract  (JSON)
 *     - file: base64 (string, 데이터 URL 가능)
 *     - mimeType: 'image/jpeg' | 'image/png' | 'application/pdf'
 *     - docType: 'vehicle_reg' | 'business_reg' | 'bankbook'
 *
 *   → { ok: true, extracted: { ... }, raw?: string }
 *
 *   GEMINI_API_KEY 필요. 503/429 자동 재시도.
 *
 *   Vercel serverless / vite dev (api/ 하위 자동 매핑) 모두 지원.
 */
const MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 3;

const PROMPTS = {
  vehicle_reg: `이 문서는 한국 자동차등록증 (별지 제1호서식) 입니다. 핵심 항목을 JSON 으로 추출하세요.

추출 규칙:
- car_number: ① 자동차등록번호 (예: 12다2400). 한국 plate 패턴 \\d{2,3}[가-힣]\\d{4} 만 인정. 17자리 영문+숫자 = VIN 이라 절대 car_number 아님.
- car_name: ④ 차명 — 등록증에 적힌 그대로 보존 (예: "그랜저 하이브리드")
- type_number: ⑤ 형식 (예: IG43BBG-7)
- car_year_month: ⑤ 제작연월 YYYY-MM
- vin: ⑥ 차대번호 17자리 영문+숫자 (I, O, Q 제외)
- engine_type: ⑦ 원동기형식 (예: G4KK)
- usage_type: ③ 용도 (자가용/영업용/관용)
- category_hint: ② 차종 (대형/중형/소형/경형 + 승용/승합/화물 — 그대로)
- engine_cc: ⑱ 배기량 (cc, 정수)
- seats: ⑯ 승차정원 (정수)
- fuel_type: ㉑ 연료 (가솔린/디젤/LPG/하이브리드/전기/수소 중 정규화)
- first_registration_date: 헤더 "최초등록일" YYYY-MM-DD (또는 표 안의 최초등록일)
- owner_name: ⑨ 성명(명칭) — 회사면 "스위치플랜(주)" 형태 그대로
- owner_biz_no: ⑩ 생년월일/법인등록번호 XXXXXX-XXXXXXX
- owner_address: ⑧ 사용본거지

값 없으면 null.`,

  business_reg: `이 문서는 한국 사업자등록증 (법인 또는 개인) 입니다. JSON 으로 추출하세요.

- biz_no: 등록번호 XXX-XX-XXXXX
- corp_no: 법인등록번호 XXXXXX-XXXXXXX (개인이면 null)
- partner_name: 법인명/단체명 (예: "주식회사 OOO" 그대로)
- ceo: 대표자 이름
- open_date: 개업연월일 YYYY-MM-DD
- address: 사업장 소재지
- hq_address: 본점 소재지 (사업장과 같으면 동일 값)
- industry: 업태 (여러 개면 "서비스, 부동산업" 콤마 join)
- category: 종목
- tax_office: 세무서명 (예: "강서세무서")
- entity_type: "corporate" | "individual"

값 없으면 null.`,

  bankbook: `이 문서는 한국 은행 통장사본 또는 계좌증명서입니다. JSON 으로 추출하세요.

- bank_name: 은행명 (KB국민/신한/우리/하나/농협/기업/카카오뱅크 등 표준명)
- bank_account: 계좌번호 (하이픈 포함 그대로, 예: "110-123-456789")
- bank_holder: 예금주 (성명 또는 법인명)

값 없으면 null.`,
};

/** Vercel 은 req.body 자동 파싱하지만 vite localServerless wrapper 는 안 함 — stream 수동 파싱. */
async function readJsonBody(req) {
  if (req.body) return req.body;   // 이미 파싱된 경우 (Vercel)
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', chunk => { buf += chunk; if (buf.length > 50 * 1024 * 1024) reject(new Error('payload too large (>50MB)')); });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'POST only' });
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, message: 'GEMINI_API_KEY not configured (.env.local)' });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const { file, mimeType = 'image/jpeg', docType = 'vehicle_reg' } = body;
    if (!file) {
      res.status(400).json({ ok: false, message: 'file (base64) required' });
      return;
    }
    // 데이터 URL prefix 제거
    const base64 = String(file).replace(/^data:[^;]+;base64,/, '');
    const prompt = (PROMPTS[docType] || PROMPTS.vehicle_reg);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const geminiBody = {
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: prompt + '\n\n반드시 JSON 객체만 반환하세요. 설명/마크다운 없이.' },
        ],
      }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0,
        maxOutputTokens: 2048,
      },
    };

    let response, errText;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });
      if (response.ok) break;
      errText = await response.text();
      const status = response.status;
      const retryable = status === 503 || status === 429 || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(errText);
      if (!retryable || attempt === MAX_RETRIES - 1) break;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000) + Math.random() * 1000;
      await new Promise(r => setTimeout(r, delay));
    }

    if (!response.ok) {
      res.status(response.status).json({ ok: false, message: `Gemini API: ${response.status}`, detail: errText });
      return;
    }
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      res.status(502).json({ ok: false, message: 'Gemini 응답에 텍스트 없음', raw: result });
      return;
    }
    let extracted;
    try {
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      extracted = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ ok: false, message: `JSON 파싱 실패: ${e.message}`, raw: text });
      return;
    }
    res.status(200).json({ ok: true, extracted, raw: text });
  } catch (e) {
    console.error('[ocr-extract]', e);
    res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
}
