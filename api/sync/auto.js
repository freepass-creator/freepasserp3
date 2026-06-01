/**
 * /api/sync/auto — 시트 → Firebase 자동 동기화 (Vercel Cron)
 *
 * vercel.json crons 가 매일 1회 호출. 인증은 Authorization: Bearer ${CRON_SECRET} 헤더.
 * 수동 호출도 지원 (admin 이 같은 헤더로 POST).
 *
 * 처리 흐름:
 *   1) syncFromSheet() 로 source 3종(autoplus / general / supply) 각각 fetch
 *   2) 기존 external_sheet 매물 RTDB 에서 read
 *   3) 신규/업데이트/시트에서빠짐 분류 → multi-update
 *   4) sync_logs/auto/{timestamp} 에 결과 기록
 *
 * 카탈로그 매칭(maker/model/sub_model/trim_name)은 server-side 에서 skip.
 *   → autoplus 신규 매물은 maker/model 빈값으로 import. admin이 dev.js 수동 sync 로 채워줌.
 *   → general/supply 는 시트 컬럼에서 직접 maker/model/sub_model 받으므로 영향 없음.
 */
import admin from 'firebase-admin';
import { syncFromSheet } from './external-sheet.js';

const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

let _appPromise = null;
function getAdmin() {
  if (_appPromise) return _appPromise;
  _appPromise = (async () => {
    if (admin.apps.length) return admin.app();
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      || process.env.FIREBASE_SERVICE_ACCOUNT
      || '';
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var not set');
    let creds;
    try {
      const trimmed = raw.trim();
      const decoded = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
      creds = JSON.parse(decoded);
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON parse failed: ' + e.message);
    }
    return admin.initializeApp({
      credential: admin.credential.cert(creds),
      databaseURL: DATABASE_URL,
    });
  })();
  return _appPromise;
}

async function applyToFirebase(sheetResult, db) {
  const { products = {}, schema, provider_code } = sheetResult;
  const incomingUids = new Set(Object.keys(products));

  const snap = await db.ref('products').once('value');
  const allProducts = snap.val() || {};
  const incomingPartners = new Set(Object.values(products).map(x => x.partner_code).filter(Boolean));
  const existing = Object.values(allProducts).filter(p => {
    if (!p || p.source !== 'external_sheet' || p._deleted) return false;
    if (schema === 'autoplus')    return p.provider_company_code === provider_code;
    if (schema === 'general')     return p.source_schema === 'general';
    if (schema === 'auto-supply') return p.source_schema === 'general' && incomingPartners.has(p.partner_code);
    return false;
  });

  const updates = {};
  let added = 0, updated = 0;
  for (const [uid, p] of Object.entries(products)) {
    const found = existing.find(x => x.product_uid === uid || x._key === uid);
    if (found) {
      const k = `products/${found._key}`;
      updates[`${k}/price`]          = p.price;
      updates[`${k}/vehicle_status`] = p.vehicle_status;
      updates[`${k}/status`]         = p.status;
      updates[`${k}/status_label`]   = p.status_label;
      updates[`${k}/mileage`]        = p.mileage;
      updates[`${k}/options`]        = p.options;
      updates[`${k}/partner_memo`]   = p.partner_memo;
      updates[`${k}/location`]       = p.location;
      updates[`${k}/photo_link`]     = p.photo_link;
      updates[`${k}/updated_at`]     = p.updated_at;
      if (!found.maker     && p.maker)     updates[`${k}/maker`]     = p.maker;
      if (!found.model     && p.model)     updates[`${k}/model`]     = p.model;
      if (!found.sub_model && p.sub_model) updates[`${k}/sub_model`] = p.sub_model;
      if (!found.trim_name && p.trim_name) updates[`${k}/trim_name`] = p.trim_name;
      if (p.policy_code)           updates[`${k}/policy_code`]           = p.policy_code;
      if (p.provider_company_code) updates[`${k}/provider_company_code`] = p.provider_company_code;
      if (p.partner_code)          updates[`${k}/partner_code`]          = p.partner_code;
      updated++;
    } else {
      updates[`products/${uid}`] = p;
      added++;
    }
  }

  let dropped = 0;
  const now = Date.now();
  for (const x of existing) {
    if (!incomingUids.has(x.product_uid) && !incomingUids.has(x._key)) {
      const k = `products/${x._key}`;
      updates[`${k}/vehicle_status`] = '출고불가';
      updates[`${k}/status`]         = 'unavailable';
      updates[`${k}/status_label`]   = '시트에서 제거됨';
      updates[`${k}/updated_at`]     = now;
      dropped++;
    }
  }

  const keys = Object.keys(updates);
  const CHUNK = 400;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = {};
    for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
    await db.ref().update(slice);
  }
  return { added, updated, dropped, total_writes: keys.length };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, message: 'unauthorized' }));
    }
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const sources = ['autoplus', 'general', 'supply'];
  const result = { ok: true, started_at: startedAt, sources: {} };

  try {
    const app = await getAdmin();
    const db = admin.database(app);

    for (const source of sources) {
      const t0 = Date.now();
      try {
        const sheetOut = await syncFromSheet(source);
        if (!sheetOut.ok) {
          result.sources[source] = { ok: false, message: sheetOut.message, ms: Date.now() - t0 };
          continue;
        }
        const counts = await applyToFirebase(sheetOut, db);
        result.sources[source] = {
          ok: true,
          synced: sheetOut.synced,
          skipped: sheetOut.skipped,
          ...counts,
          tabs: Array.isArray(sheetOut.tabs_scanned) ? sheetOut.tabs_scanned.length : 1,
          ms: Date.now() - t0,
        };
      } catch (e) {
        console.error(`[auto-sync] ${source} 실패:`, e);
        result.sources[source] = { ok: false, message: e.message || String(e), ms: Date.now() - t0 };
      }
    }
    result.duration_ms = Date.now() - startMs;
    result.finished_at = new Date().toISOString();

    const logKey = startedAt.replace(/[:.]/g, '-');
    await db.ref(`sync_logs/auto/${logKey}`).set(result);

    // 최근 30일치만 유지 — 오래된 로그 정리
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const logsSnap = await db.ref('sync_logs/auto').once('value');
    const logs = logsSnap.val() || {};
    const oldKeys = Object.entries(logs)
      .filter(([, v]) => v && v.started_at && new Date(v.started_at).getTime() < cutoff)
      .map(([k]) => k);
    if (oldKeys.length) {
      const cleanup = {};
      for (const k of oldKeys) cleanup[`sync_logs/auto/${k}`] = null;
      await db.ref().update(cleanup);
      result.cleaned_old_logs = oldKeys.length;
    }
  } catch (e) {
    console.error('[auto-sync] 치명적 실패:', e);
    result.ok = false;
    result.message = e.message || String(e);
  }

  res.statusCode = result.ok ? 200 : 500;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(result));
}
