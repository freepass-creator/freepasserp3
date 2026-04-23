/**
 * Vercel Serverless Function — Claude Vision OCR for 차량등록증
 * POST /api/claude-vision  { image: base64, media_type?: 'image/jpeg' }
 * → { ok: true, data: { car_number, maker, model, sub_model, year, vin, ... } }
 *
 * Env: ANTHROPIC_API_KEY
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, message: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  try {
    const { image, media_type = 'image/jpeg', doc_type = 'registration' } = req.body || {};
    if (!image) {
      res.status(400).json({ ok: false, message: 'image (base64) required' });
      return;
    }

    const PROMPTS = {
      // 차량등록증
      registration: `이 이미지는 대한민국 자동차 등록증입니다. 다음 정보를 JSON으로 추출하세요. 확실하지 않으면 빈 문자열을 넣으세요.

{
  "car_number": "차량번호 (예: 146하7728)",
  "maker": "제조사 (예: 현대, 기아, BMW, 벤츠 - 한글로)",
  "model": "모델명 (예: 투싼, K5, 5시리즈)",
  "sub_model": "세부모델 (형식: 더 뉴 투싼 NX4 페리)",
  "year": "연식 4자리 (예: 2024)",
  "vin": "차대번호",
  "fuel_type": "연료 (가솔린/디젤/하이브리드/전기/LPG 중 한글)",
  "displacement": "배기량 (cc 단위 숫자)",
  "registration_date": "최초등록일 YYYY-MM-DD",
  "owner": "소유자명"
}`,
      // 자동차 보험증
      insurance: `이 이미지는 대한민국 자동차 보험증입니다. 다음 정보를 JSON으로 추출하세요.

{
  "car_number": "차량번호",
  "insurer": "보험사명 (삼성화재, KB손해보험, 현대해상 등)",
  "policy_number": "증권번호",
  "insured_name": "피보험자명",
  "vin": "차대번호",
  "start_date": "보험시작일 YYYY-MM-DD",
  "end_date": "보험종료일 YYYY-MM-DD",
  "coverage_bodily": "대인배상 (무한/1억 등)",
  "coverage_property": "대물배상 (1억/2억 등)",
  "coverage_self_body": "자기신체사고 (3000만 등)",
  "coverage_uninsured": "무보험차상해 (2억 등)",
  "coverage_own_damage": "자차 (차량가액/협의 등)",
  "deductible": "자차 자기부담금",
  "premium": "보험료 (숫자만)"
}`,
      // 운전면허 위반기록 / 교통범칙금
      violation: `이 이미지는 대한민국 운전면허 위반기록 또는 교통범칙금 고지서입니다. 다음 정보를 JSON으로 추출하세요. 여러 건이면 violations 배열에 모두 담아주세요.

{
  "driver_name": "운전자명",
  "license_number": "면허번호",
  "violations": [
    {
      "date": "위반일 YYYY-MM-DD",
      "type": "위반항목 (예: 신호위반, 속도위반, 음주운전)",
      "location": "위반장소",
      "penalty_points": "벌점 (숫자)",
      "fine_amount": "범칙금 (숫자)",
      "status": "처리상태 (미납/완납/이의신청)"
    }
  ],
  "total_points": "총 벌점",
  "total_fine": "총 범칙금"
}`,
    };

    const prompt = (PROMPTS[doc_type] || PROMPTS.registration) + '\n\nJSON만 반환하세요. 설명이나 마크다운 없이 순수 JSON 객체만 출력하세요.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type, data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ ok: false, message: `Anthropic API: ${response.status}`, detail: errText });
      return;
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || '';

    // JSON 파싱 (마크다운 ```json ``` 감싸진 경우 대응)
    let data = {};
    try {
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      data = JSON.parse(cleaned);
    } catch (e) {
      res.status(200).json({ ok: true, data: {}, raw: text, parse_error: e.message });
      return;
    }

    res.status(200).json({ ok: true, data, raw: text });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}
