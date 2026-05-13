/**
 * vehicle-matcher.js — vehicle_master 기반 차종 매칭
 *
 * v1 freepasserp/static/js/pages/admin.js 의 matchVehicle() 포팅.
 * 외부 시트(오토플러스 등) 의 raw 차종/풀네임/등록일 → maker/model/sub_model/trim_name 엔리치.
 *
 * v3 차이점:
 *  - vehicle_master 필드명이 model_name → model 로 변경됨 (v1: e.model_name, v3: e.model)
 *  - sub_model 은 v3 에서 m.sub_model (또는 m.sub) — car-models.js subscribe 가 정규화함
 */

/** 매칭 인덱스 빌드 — store.carModels (vehicle_master) 로부터 1회 생성 후 매칭 호출 시 재사용 */
export function buildVehicleIndex(carModels) {
  const entries = (carModels || []).filter(m => m && m.status !== 'deleted' && !m.archived);
  const modelToMaker = {};
  const modelSubs = {};
  const modelsArr = [];
  for (const e of entries) {
    if (!e.maker || !e.model) continue;
    modelToMaker[e.model] = e.maker;
    if (!modelsArr.includes(e.model)) modelsArr.push(e.model);
    if (!modelSubs[e.model]) modelSubs[e.model] = [];
    if (e.sub_model && !modelSubs[e.model].includes(e.sub_model)) {
      modelSubs[e.model].push(e.sub_model);
    }
  }
  // 긴 모델명 우선 매칭 (e.g., "쏘나타 뉴라이즈" 가 "쏘나타" 보다 먼저 매칭되어야 함)
  const modelsSet = modelsArr.sort((a, b) => b.length - a.length);
  return { entries, modelToMaker, modelSubs, modelsSet };
}

/**
 * 차종 매칭 — raw 차종(short)/풀네임(full)/등록일(YYYY-MM-DD) → maker/model/sub_model/trim_name
 * @param {string} shortName - 시트의 "차종" 컬럼 (예: "그랜저")
 * @param {string} fullName  - 시트의 풀네임 컬럼 (예: "그랜저 IG 3.0 익스클루시브")
 * @param {string} regDate   - 최초등록일 ('YYYY-MM-DD' 또는 'YYYY' 시작)
 * @param {object} index     - buildVehicleIndex() 결과
 */
export function matchVehicle(shortName, fullName, regDate, index) {
  const { entries, modelToMaker, modelSubs, modelsSet } = index;
  const regYear = regDate ? Number(String(regDate).slice(0, 4)) || 0 : 0;
  let maker = '', model = '';

  // ── 1단계: 제조사 + 모델 ──
  if (modelToMaker[shortName]) {
    maker = modelToMaker[shortName];
    model = shortName;
  } else {
    // 풀네임+차종에서 마스터 모델명 키워드 검색 (긴 이름 우선)
    const searchText = `${shortName} ${fullName}`;
    for (const m of modelsSet) {
      if (searchText.includes(m)) {
        maker = modelToMaker[m]; model = m; break;
      }
    }
    // 수입차: "BMW 740d" → 첫 단어가 제조사
    if (!maker && shortName.includes(' ')) {
      const parts = shortName.split(/\s+/);
      for (const e of entries) {
        if (e.maker === parts[0] || e.maker.includes(parts[0]) || parts[0].includes(e.maker)) {
          maker = e.maker;
          const rest = parts.slice(1).join(' ');
          if (modelToMaker[rest]) { model = rest; break; }
          for (const m of modelsSet) {
            if (modelToMaker[m] === maker && (rest.includes(m) || m.includes(rest))) {
              model = m; break;
            }
          }
          if (model) break;
        }
      }
    }
    // 접두사 제거: "더 뉴 / 신형 / 올 뉴 / 디 올 뉴"
    if (!maker) {
      const RE_PREFIX = /^(더\s*뉴|신형|올\s*뉴|디\s*올\s*뉴)\s*/g;
      const cleaned = shortName.replace(RE_PREFIX, '').trim();
      if (cleaned !== shortName && modelToMaker[cleaned]) {
        maker = modelToMaker[cleaned]; model = cleaned;
      }
      if (!maker) {
        const cleanedFull = fullName.replace(RE_PREFIX, '').trim();
        for (const m of modelsSet) {
          if (cleanedFull.includes(m)) { maker = modelToMaker[m]; model = m; break; }
        }
      }
    }
    // partial: catalog model_root 가 shortName 으로 시작 (시트 "렉스턴" → catalog "렉스턴 스포츠")
    //   짧은 것 우선 (덜 특수한 model_root). fullName 에 추가 토큰 있으면 그것 매칭 우선.
    if (!maker && shortName && shortName.length >= 2) {
      const partial = modelsSet.filter(m => m !== shortName && m.startsWith(shortName + ' '));
      if (partial.length) {
        // fullName 에 더 자세한 토큰 (예: "칸") 있으면 그것 매칭
        const searchText = `${shortName} ${fullName}`;
        const detailed = partial.find(m => m !== shortName && searchText.includes(m));
        if (detailed) { model = detailed; maker = modelToMaker[detailed]; }
        else {
          // 가장 짧은 model_root (덜 특수, 가장 일반화)
          const sorted = [...partial].sort((a, b) => a.length - b.length);
          model = sorted[0]; maker = modelToMaker[model];
        }
      }
    }
  }

  // ── 2단계: 세부모델 ──
  let sub_model = '';
  if (model && modelSubs[model]) {
    const subs = modelSubs[model];
    const sorted = [...subs].sort((a, b) => b.length - a.length);
    const fullNoSpace = String(fullName || '').replace(/\s/g, '').toLowerCase();
    const shortNoSpace = String(shortName || '').replace(/\s/g, '').toLowerCase();
    const searchNoSpace = `${shortNoSpace}${fullNoSpace}`;

    // 방법1: 풀네임에 세부모델 문자열 직접 포함 (공백·연도 제거 비교)
    for (const s of sorted) {
      if (fullName && fullName.includes(s)) { sub_model = s; break; }
      const sClean = s.replace(/\s/g, '').replace(/\d+~?\d*$/g, '').toLowerCase().trim();
      if (sClean.length >= 2 && searchNoSpace.includes(sClean)) { sub_model = s; break; }
    }

    // 방법2: 세대코드 검색 (CN7, DN8, MQ4, NQ5, MX5, QL, BD 등) — sub_model 어디든
    if (!sub_model) {
      const searchText = `${shortName || ''} ${fullName || ''}`;
      const candidates = [];
      for (const s of subs) {
        // 영문 1-4자 + 선택 숫자 0-2자 (DN8, NQ5, QL, BD 등 모두)
        const codes = s.match(/[A-Z]{1,4}\d{0,2}/g) || [];
        for (const code of codes) {
          if (code.length < 2) continue;
          // 영문만 있는 코드(QL, BD 등) → word boundary 매칭 (오탐 방지)
          // 숫자 포함 코드(DN8, NQ5 등) → substring 매칭 (자유롭게)
          const isAlphaOnly = /^[A-Z]+$/.test(code);
          const matched = isAlphaOnly
            ? new RegExp(`\\b${code}\\b`).test(searchText)
            : searchText.includes(code);
          if (matched) candidates.push({ s, code, len: code.length, isAlphaOnly });
        }
      }
      // 우선순위: 숫자포함 코드 > 코드 길이 긴 것 > sub_model 길이 긴 것
      candidates.sort((a, b) =>
        (Number(a.isAlphaOnly) - Number(b.isAlphaOnly)) ||  // false(숫자포함) 먼저
        (b.len - a.len) ||
        (b.s.length - a.s.length)
      );
      if (candidates.length) sub_model = candidates[0].s;
    }

    // 방법3: 등록 연도 → catalog year_start/year_end 범위 매칭
    if (!sub_model && regYear) {
      const candidates = entries.filter(e => e.model === model);
      // 1차: catalog 의 year_start/year_end 직접 매칭 (catalog 기반 carModels)
      const inRange = candidates.filter(e => {
        const ys = Number(String(e.year_start || '').slice(0, 4));
        const ye = e.year_end === '현재' ? 9999 : Number(String(e.year_end || '').slice(0, 4));
        if (!ys) return false;
        return regYear >= ys && regYear <= (ye || 9999);
      });
      if (inRange.length) {
        // 동력원 매칭 (raw 의 fuel_type 가 fullName 에 있을 수도)
        const fullSearch = `${shortName || ''} ${fullName || ''}`;
        const isHybrid = /하이브리드|HEV|hybrid/i.test(fullSearch);
        const isEV = /일렉트릭|EV|electric|일렉트리파이드/i.test(fullSearch);
        let fuelMatch = inRange;
        if (isHybrid) fuelMatch = inRange.filter(e => /하이브리드|HEV/i.test(e.title || '')) || inRange;
        else if (isEV) fuelMatch = inRange.filter(e => /EV|일렉트릭|일렉트리파이드/i.test(e.title || '')) || inRange;
        else fuelMatch = inRange.filter(e => !/하이브리드|HEV|EV|일렉트릭|일렉트리파이드/i.test(e.title || ''));
        const final = fuelMatch.length ? fuelMatch : inRange;
        // 최신 출시 우선
        final.sort((a, b) => (b.year_start || '').localeCompare(a.year_start || ''));
        sub_model = final[0].sub_model;
      }
      // 2차: 기존 패턴 (sub_model 에 "20~" 같은 표기 있는 경우)
      if (!sub_model) {
        for (const e of candidates) {
          const period = e.sub_model || '';
          const yearMatch = period.match(/(\d{2})~(\d{2})?/);
          if (yearMatch) {
            const from = 2000 + Number(yearMatch[1]);
            const to = yearMatch[2] ? 2000 + Number(yearMatch[2]) : 2099;
            if (regYear >= from && regYear <= to) { sub_model = e.sub_model; break; }
          }
        }
      }
    }

    // 방법4: 세부모델 1개뿐이면 그걸로
    if (!sub_model && subs.length === 1) sub_model = subs[0];
  }

  // ── 3단계: 트림 = 풀네임에서 모델명 이후 ──
  let trim_name = '';
  if (fullName && model) {
    const idx = fullName.indexOf(model);
    if (idx >= 0) trim_name = fullName.slice(idx + model.length).trim();
    if (!trim_name && shortName) {
      const idx2 = fullName.indexOf(shortName);
      if (idx2 >= 0) trim_name = fullName.slice(idx2 + shortName.length).trim();
    }
  }

  return { maker, model, sub_model, trim_name };
}
