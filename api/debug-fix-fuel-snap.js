/**
 * 임시 디버그용 — ssot-snap.js 연료 판정 수정(74fb3e7) 반영해서, 이미 DB에 저장된 매물 중
 * 재계산 결과가 달라지는 것만 찾아 variant/trim_name 을 즉시 보정. 확인 끝나면 삭제.
 * GET  = 미리보기만 (diff 목록)
 * POST = 실제 적용
 */
import admin from 'firebase-admin';
import { syncFromSheet } from './sync/external-sheet.js';
import { buildSnapIndex, snapToSsot } from '../src/core/ssot-snap.js';

const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const MATCH_URL = 'https://raw.githubusercontent.com/freepass-creator/vehicle-master/main/dist/match-index.json';

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

function toEntries(d) {
  return (d.entries || []).map(e => ({
    maker: e.maker, model: e.model, sub_model: e.sub_model, gen_code: e.gen_code || '',
    year_start: e.year_start, year_end: e.year_end, title: e.title, status: e.status,
    variants: e.variants || [], trims: e.trims || [],
  }));
}

const SOURCES = ['autoplus', 'songogong', 'aicar', 'pacific', 'leaders', 'star', 'rentzone',
  'gyeongjinRent', 'gyeongjinCar', 'wooriCapital', 'kh', 'centro', 'billin', 'ian', 'wellix', 'sarent', 'jnj'];

export default async function handler(req, res) {
  try {
    await getAdmin();
    const db = admin.database();

    const matchData = await fetch(MATCH_URL, { cache: 'no-store' }).then(r => r.json());
    const snapIndex = buildSnapIndex(toEntries(matchData));

    const prodSnap = await db.ref('products').once('value');
    const prodVal = prodSnap.val() || {};
    const byCarNumber = new Map();
    for (const [key, pr] of Object.entries(prodVal)) {
      if (pr._deleted) continue;
      if (!pr.car_number) continue;
      byCarNumber.set(pr.car_number, { key, ...pr });
    }

    const diffs = [];
    for (const src of SOURCES) {
      let out;
      try { out = await syncFromSheet(src); } catch (e) { continue; }
      const items = Object.values(out.products || {});
      for (const p of items) {
        const existing = byCarNumber.get(p.car_number);
        if (!existing) continue;
        const snap = snapToSsot(p, snapIndex);
        if (!snap) continue;
        const rawTrim = p.trim_name;
        const newVariant = snap.variant;
        const newTrim = rawTrim || snap.trim_name;
        const newSub = snap.sub_model;
        if (existing.variant !== newVariant || existing.sub_model !== newSub) {
          diffs.push({
            key: existing.key, car_number: p.car_number, source: src,
            old_sub_model: existing.sub_model, new_sub_model: newSub,
            old_variant: existing.variant, new_variant: newVariant,
            old_trim: existing.trim_name, new_trim: newTrim,
          });
        }
      }
    }

    if (req.method === 'POST') {
      const updates = {};
      for (const d of diffs) {
        updates[`products/${d.key}/sub_model`] = d.new_sub_model;
        updates[`products/${d.key}/variant`] = d.new_variant;
        updates[`products/${d.key}/trim_name`] = d.new_trim;
        updates[`products/${d.key}/updated_at`] = Date.now();
      }
      await db.ref().update(updates);
      return res.json({ ok: true, applied: diffs.length, diffs });
    }

    res.json({ ok: true, wouldChange: diffs.length, diffs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
