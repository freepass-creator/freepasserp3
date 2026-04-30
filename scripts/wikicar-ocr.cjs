/**
 * wikicar 가격표 이미지 → Gemini Vision OCR → 우리 카탈로그 JSON
 *
 * 사용:
 *   node scripts/wikicar-ocr.cjs <image-file>            # 단일 이미지 테스트
 *   node scripts/wikicar-ocr.cjs --post <post-url>       # wikicar 게시글 URL → 모든 첨부 OCR
 *
 * 환경: GEMINI_API_KEY (.env 또는 환경변수)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// .env 자동 로드 (간단한 파서)
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}
loadEnv();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) {
  console.error('GEMINI_API_KEY 누락 — .env 확인');
  process.exit(1);
}

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

const PRICE_SHEET_PROMPT = `이 이미지는 한국 자동차 제조사 가격표입니다. 트림별 옵션과 가격 정보를 추출하세요.

**가격 추출 규칙 (가장 중요):**
- **부가세(VAT) 포함 소비자가격만 추출**. 표에 둘 다 있으면 큰 숫자(부가세 포함)
- "공급가액", "VAT 별도", "부가세 별도", "공급가" 표기된 가격은 절대 추출하지 말 것
- 일반 소비자가 매장에서 사는 가격 = 부가세 포함 가격
- "판매가격" 또는 "가격" 큰 글씨 숫자가 price_before_tax_5 (개별소비세 5% 적용)
- "친환경차 세제혜택 후" 또는 "혜택 후" 가격이 price_after_tax_5
- 환경부 보조금/지원금 적용 가격은 무시
- 표에 적힌 숫자 그대로 (계산하지 말 것)
- 원 단위 (예: 28,980,000 → 28980000)

**옵션 추출 규칙:**
- "기본품목" → basic
- "선택품목" / "선택사양" / "옵션" → select
- "X 트림 기본품목 외" 같은 표현은 카테고리가 아니라 "이전 트림 기본 + 추가" 의미. 이 경우 추가된 옵션만 추출
- 카테고리는 가격표 표제 (시트/안전/편의/외관/내장/멀티미디어 등) 그대로
- 트림명은 한글 등급명만 (예: 프리미엄, 익스클루시브, 인스퍼레이션, 캘리그래피, 스마트, 모던, 노블레스, 시그니처 등 짧은 등급 명칭). 영문 트림명은 한글로 변환 (Premium → 프리미엄)
- **트림명에 "엔진", "L", "T", "휠 사이즈(16/17/18인치)", 배기량(2.0/1.6) 등 사양 정보가 들어가면 그건 트림이 아니라 사양표 행이므로 추출 X**
- **이미지가 가격표가 아니라 사양 비교표/계기판/내장 사진이면 trims 빈 배열로 반환**
- 정보 없으면 빈 배열/빈 문자열, 거짓 정보 만들지 말 것`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: '차종 전체 이름 (예: 2025 쏘나타 디 엣지)' },
    variant: { type: 'STRING', description: '엔진/연료 변형 라벨 (예: 가솔린 1.6, 하이브리드, LPi). 가격표 1장이면 빈값' },
    valid_date: { type: 'STRING', description: '가격표 적용일 (예: 2024-10-25). 없으면 빈값' },
    trims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '트림 한글명 (예: 익스클루시브)' },
          price_before_tax_5: { type: 'INTEGER', description: '개별소비세 5% 적용 전 / 또는 단일 가격, 원 단위' },
          price_after_tax_5: { type: 'INTEGER', description: '개별소비세 5% 적용 후 (세제혜택), 원 단위. 없으면 0' },
          price_before_tax_3_5: { type: 'INTEGER', description: '개별소비세 3.5% 적용 전, 원 단위. 없으면 0' },
          price_after_tax_3_5: { type: 'INTEGER', description: '개별소비세 3.5% 적용 후, 원 단위. 없으면 0' },
          basic: {
            type: 'ARRAY',
            description: '기본품목 — 카테고리별 분류된 옵션 묶음',
            items: {
              type: 'OBJECT',
              properties: {
                category: { type: 'STRING', description: '카테고리명 (예: 시트, 안전, 편의)' },
                options: { type: 'ARRAY', items: { type: 'STRING' }, description: '옵션 한글명 배열' }
              },
              required: ['category', 'options']
            }
          },
          select: {
            type: 'ARRAY',
            description: '선택품목 — 패키지/단품 그룹별',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING', description: '패키지명 또는 옵션명' },
                options: { type: 'ARRAY', items: { type: 'STRING' }, description: '패키지에 포함된 세부 옵션 (단품이면 1개)' },
                price: { type: 'INTEGER', description: '가격 원 단위' }
              },
              required: ['name', 'options', 'price']
            }
          }
        },
        required: ['name', 'price_before_tax_5', 'price_after_tax_5', 'price_before_tax_3_5', 'price_after_tax_3_5', 'basic', 'select']
      }
    }
  },
  required: ['title', 'variant', 'valid_date', 'trims']
};

function callGemini(imageBase64, mimeType) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: PRICE_SHEET_PROMPT }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    const url = new URL(ENDPOINT);
    const req = https.request({
      method: 'POST',
      host: url.hostname,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}: ${data.slice(0,500)}`));
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve({ text, usage: json.usageMetadata });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function ocrImage(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const b64 = buf.toString('base64');
  console.log(`[ocr] ${imagePath} (${(buf.length/1024).toFixed(0)}KB)`);
  const t0 = Date.now();
  const { text, usage } = await callGemini(b64, mime);
  const dt = Date.now() - t0;
  console.log(`[ocr] ${dt}ms | tokens in=${usage?.promptTokenCount || '?'} out=${usage?.candidatesTokenCount || '?'}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error('JSON 파싱 실패:', e.message);
    console.error('raw:', text.slice(0, 500));
    return null;
  }
  return parsed;
}

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: node wikicar-ocr.cjs <image-file>');
    process.exit(1);
  }
  ocrImage(arg).then(result => {
    if (!result) process.exit(1);
    console.log('\n=== 결과 ===');
    console.log('title:', result.title);
    console.log('variant:', result.variant);
    console.log('valid_date:', result.valid_date);
    console.log('trims:', result.trims.length);
    result.trims.forEach(t => {
      console.log(`\n  [${t.name}]`);
      console.log(`    가격: ${t.price_after_tax_5 || t.price_before_tax_5}원`);
      console.log(`    기본 카테고리: ${t.basic.length} | 선택: ${t.select.length}`);
      t.basic.slice(0, 3).forEach(b => console.log(`      - ${b.category}: ${b.options.length}개`));
      t.select.slice(0, 3).forEach(s => console.log(`      [선택] ${s.name} ${(s.price/10000).toFixed(0)}만`));
    });
    // 결과 dump
    fs.writeFileSync('./_ocr_result.json', JSON.stringify(result, null, 2));
    console.log('\n→ _ocr_result.json');
  }, e => { console.error(e); process.exit(1); });
}

module.exports = { ocrImage, callGemini };
