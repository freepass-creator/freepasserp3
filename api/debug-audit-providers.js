/**
 * 임시 디버그용 — 15개 시트 동기화 소스의 provider_code 가 partners 컬렉션의 실제 등록명과
 * 그럴듯하게 맞는지 전수 점검 (렌트존/연카 사고 재발 방지). 확인 끝나면 삭제.
 */
import admin from 'firebase-admin';

const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

let _appPromise = null;
function getAdmin() {
  if (_appPromise) return _appPromise;
  const p = (async () => {
    if (admin.apps.length) return admin.app();
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || '';
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 Vercel에 설정되지 않았습니다');
    const trimmed = raw.trim();
    const decoded = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
    const creds = JSON.parse(decoded);
    return admin.initializeApp({ credential: admin.credential.cert(creds), databaseURL: DATABASE_URL });
  })();
  _appPromise = p;
  p.catch(() => { _appPromise = null; });
  return p;
}

// 시트 소스 라벨(한글 핵심 토큰) — external-sheet.js SHEET_CONFIGS 와 admin-ops.js SYNC_SOURCES 에서 그대로 옮김
const SOURCES = [
  { key: 'autoplus', code: 'RP023', name: '오토플러스' },
  { key: 'songogong', code: 'RP012', name: '손오공' },
  { key: 'aicar', code: 'RP004', name: '아이카' },
  { key: 'pacific', code: 'RP022', name: '퍼시픽' },
  { key: 'leaders', code: 'RP008', name: '리더스' },
  { key: 'star', code: 'RP018', name: '스타' },
  { key: 'rentzone', code: 'PT-0014', name: '렌트존' },
  { key: 'gyeongjinRent', code: 'RP015', name: '경진렌트카' },
  { key: 'gyeongjinCar', code: 'RP016', name: '경진카' },
  { key: 'wooriCapital', code: 'RP020', name: '우리캐피탈렌터카' },
  { key: 'kh', code: 'RP010', name: 'KH' },
  { key: 'centro', code: 'RP017', name: '센트로' },
  { key: 'billin', code: 'RP021', name: '빌린카' },
  { key: 'ian', code: 'RP006', name: '아이언' },
  { key: 'wellix', code: 'RP013', name: '웰릭스' },
  { key: 'sarent', code: 'PT-0023', name: 'SA렌터카' },
  { key: 'jnj', code: 'RP030', name: 'J&J렌트카' },
];

function coreToken(s) {
  return String(s || '').replace(/\(주\)|주식회사|렌터카|렌트카|모빌리티|캐피탈/g, '').trim();
}

export default async function handler(req, res) {
  try {
    await getAdmin();
    const db = admin.database();
    const snap = await db.ref('partners').once('value');
    const partners = snap.val() || {};
    const byCode = new Map();
    for (const [key, p] of Object.entries(partners)) {
      const code = p.partner_code || p.company_code || key;
      byCode.set(code, { key, name: p.partner_name || p.company_name || '', _deleted: !!p._deleted });
    }

    const results = SOURCES.map(s => {
      const partner = byCode.get(s.code);
      if (!partner) return { ...s, status: 'NO_PARTNER_RECORD', partnerName: null };
      const expected = coreToken(s.name);
      const actual = coreToken(partner.name);
      const match = actual.includes(expected) || expected.includes(actual);
      return {
        ...s,
        partnerName: partner.name,
        partnerDeleted: partner._deleted,
        status: partner._deleted ? 'PARTNER_DELETED' : (match ? 'OK' : 'MISMATCH'),
      };
    });

    res.json({ ok: true, results, problems: results.filter(r => r.status !== 'OK') });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
