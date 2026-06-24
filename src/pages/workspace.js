/**
 * pages/workspace.js — 업무 소통 (대화 중심) 페이지 (v3 ERP)
 *
 * 4패널: 대화목록 | 대화창(채팅) | 계약진행 | 차량상세
 *
 * Export:
 *   - renderRoomList(rooms)
 *   - selectRoom(roomId)
 *   - renderRoomDetail(room)        // contract.bindContractWorkV2 reRender 콜백에서 호출
 *   - renderChatMessages(msgs, room)
 *   - bindChatInput()
 *   - bindRoomCreate()
 *   - createRoomFromProduct(product)  // search 의 setSearchCallbacks 로 주입됨
 *
 * 의존: store, firebase/db, core/collections, core/chat-render, core/ui-helpers,
 *      core/notify, pages/contract, pages/search
 */
import { store } from '../core/store.js';
import { watchCollection, watchRecord, pushRecord, updateRecord, fetchRecord, incrementAtomic } from '../firebase/db.js';
import { markRoomRead } from '../firebase/collections.js';
import { renderChatMessages as v2RenderChatMessages, getPeerReadAt } from '../core/chat-render.js';
import { showToast } from '../core/toast.js';
import { notifyProviderAndAdmin } from '../core/notify.js';
import {
  esc, fmtTime, fmtDate,
  listBody, emptyState, renderRoomItem,
  isMobileViewport,
  providerNameByCode, formatMainLine, chatCodeOf,
} from '../core/ui-helpers.js';
import {
  renderContractWorkV2, bindContractWorkV2,
  createContractFromRoomLocal, renderContractDocs,
} from './contract.js';
import { openFullscreen, renderDetailSections } from '../core/product-detail-render.js';
import { renderSearchDetail } from './search.js';

/* ── 모듈 state ── */
let _activeRoomId = null;
let _msgUnsub = null;       // 현재 룸 메시지 구독 해제 함수
let _contractUnsub = null;  // 계약 서류 실시간 구독 해제 함수
let _currentMessages = [];  // 활성 룸 메시지 캐시
let _prevPeerReadAt = 0;    // 상대 마지막 읽음 시각 (변경 감지)

export function getActiveRoomId() { return _activeRoomId; }
export function getCurrentMessages() { return _currentMessages; }
export function getPrevPeerReadAt() { return _prevPeerReadAt; }
export function setPrevPeerReadAt(v) { _prevPeerReadAt = v; }

export function renderRoomList(rooms) {
  const body = listBody('workspace');
  if (!body) return;
  if (!Array.isArray(rooms)) return;   // 미로드 — prototype 보존
  const role = store.currentUser?.role;
  const uid = store.currentUser?.uid;
  const myCompany = store.currentUser?.company_code;
  const myChannel = store.currentUser?.agent_channel_code || store.currentUser?.channel_code;

  // v2 필터링 — 삭제·숨김·역할별 가시성
  // 관리자 소통 룸(is_admin_chat) 은 별도 페이지(#admin-chat) 에서만 노출 → workspace 에서 제외
  let visible = (rooms || []).filter(r => !r._deleted && !r.is_admin_chat);
  if (role === 'agent') visible = visible.filter(r => !r.hidden_for_agent && r.agent_uid === uid);
  // 영업관리자 — 본인이 직접 참여한 룸만 (소속 영업자 대화는 안 보임 — 정책)
  else if (role === 'agent_admin') visible = visible.filter(r => !r.hidden_for_agent && r.agent_uid === uid);
  else if (role === 'provider') visible = visible.filter(r => !r.hidden_for_provider && (r.provider_uid === uid || r.provider_company_code === myCompany));
  else if (role === 'admin') visible = visible.filter(r => !r.hidden_for_admin);

  // 출고불가 차량 채팅방 기본 숨김 — 안읽음 메시지 있으면 예외 표시
  if (store.products?.length) {
    const unreadKey = (role === 'agent' || role === 'agent_admin') ? 'unread_for_agent'
                    : role === 'provider' ? 'unread_for_provider' : 'unread_for_admin';
    visible = visible.filter(r => {
      const prod = store.products.find(
        p => p._key === r.product_uid || (r.product_code && p.product_code === r.product_code)
      );
      if (!prod || prod.vehicle_status !== '출고불가') return true;
      return Number(r[unreadKey] || r.unread || 0) > 0;
    });
  }

  if (!visible.length) {
    body.innerHTML = emptyState('대화방이 없습니다');
    _activeRoomId = null;
    selectRoom(null);
    return;
  }

  const unreadOf = (r) => Number((role === 'agent' ? r.unread_for_agent : role === 'provider' ? r.unread_for_provider : (r.unread_for_admin || r.unread)) || 0);
  const sorted = [...visible].sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));

  if (_activeRoomId && !sorted.find(r => r._key === _activeRoomId)) _activeRoomId = null;

  // HH:MM 시간 — 보조줄 안 마지막메세지시간 표기
  const fmtHHMM = (ts) => {
    if (!ts) return '';
    const t = typeof ts === 'number' ? ts : Date.parse(ts) || 0;
    if (!t) return '';
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  body.innerHTML = sorted.map((r, i) => {
    const unread = unreadOf(r);
    // 메인: 차량번호 세부모델 공급사명(한글)  /  우측: 날짜
    const mainLine = formatMainLine(
      r.vehicle_number || r.car_number,
      r.sub_model,
      providerNameByCode(r.provider_company_code || r.provider_code, store),
    );
    // 보조: 영업채널코드 | 영업자계정코드 | 마지막메세지시간 | 마지막메시지
    const subParts = [
      r.agent_channel_code || r.agent_channel,
      r.agent_code,
      fmtHHMM(r.last_message_at),
      r.last_message,
    ].filter(Boolean);
    return renderRoomItem({
      id: r._key,
      icon: unread > 0 ? 'chat-circle-dots' : 'chat-circle',
      badge: unread > 0 ? '안읽' : '읽음',
      tone: unread > 0 ? 'blue' : 'gray',
      name: mainLine,
      time: fmtDate(r.last_message_at || r.created_at),    // 메인줄 우측 = 날짜 (YY.MM.DD)
      msg: subParts.join(' | ') || '-',
      meta: unread > 0 ? String(unread) : '',
      metaClass: unread > 0 ? 'cnt' : '',
      active: r._key === _activeRoomId || (i === 0 && !_activeRoomId),
    });
  }).join('');
  if (!_activeRoomId && sorted[0]) selectRoom(sorted[0]._key);
}

/* 룸 선택 — 메시지 구독 교체 + 우측 패널 갱신 */
export function selectRoom(roomId) {
  _activeRoomId = roomId;
  if (_msgUnsub) { try { _msgUnsub(); } catch (_) {} _msgUnsub = null; }
  if (!roomId) {
    const msgWrap = document.querySelector('[data-page="workspace"] .ws-chat-msgs');
    if (msgWrap) msgWrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);"><i class="ph ph-chat-circle" style="font-size:24px;display:block;margin-bottom:6px;"></i>대화방을 선택하세요</div>`;
    renderRoomDetail(null);
    return;
  }
  const room = (store.rooms || []).find(r => r._key === roomId);
  // 채팅 헤더 — 대화코드만 표시 (숨김/삭제는 하단 액션바로 이전됨)
  const chatHeadEl = document.querySelector('[data-page="workspace"] .ws4-card:nth-child(2) .ws4-head');
  if (chatHeadEl && room) {
    const code = chatCodeOf(room);
    chatHeadEl.innerHTML = `<span>채팅 ${esc(code)}</span>`;
  }
  renderRoomDetail(room);

  // 채팅 영역 — 일단 로딩 표시
  const msgWrap = document.querySelector('[data-page="workspace"] .ws-chat-msgs');
  if (msgWrap) msgWrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);">대화 불러오는 중...</div>';

  // 메시지 구독 — messages/{roomId} (v2 구조)
  let received = false;
  const me = store.currentUser;
  try {
    _msgUnsub = watchCollection(`messages/${roomId}`, (msgs) => {
      received = true;
      _currentMessages = msgs || [];
      // 활성 룸 + 탭 visible 시 즉시 읽음 처리
      if (_activeRoomId === roomId && !document.hidden && me?.uid && me?.role) {
        const r = (store.rooms || []).find(x => x._key === roomId);
        markRoomRead(roomId, me.role, me.uid, r).catch(() => {});
      }
      try {
        renderChatMessages(_currentMessages, (store.rooms || []).find(x => x._key === roomId));
      } catch (re) {
        console.error('[chat] render fail', re);
        const w = document.querySelector('[data-page="workspace"] .ws-chat-msgs');
        if (w) w.innerHTML = `<div style="padding:24px;text-align:center;color:var(--alert-red-text);">렌더 에러: ${esc(re.message || re)}</div>`;
      }
    });
  } catch (e) {
    console.error('[chat] messages subscribe fail', e);
    if (msgWrap) msgWrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--alert-red-text);">메시지 로드 실패: ${esc(e.message || e)}</div>`;
    received = true;
  }
  // 1.5초 안에 콜백 못 받으면 — Firebase 권한/연결/데이터 없음
  setTimeout(() => {
    if (!received && _activeRoomId === roomId) {
      console.warn(`[chat] no callback within 1.5s for messages/${roomId}`);
      const w = document.querySelector('[data-page="workspace"] .ws-chat-msgs');
      if (w && w.textContent.includes('대화 불러오는 중')) {
        w.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);">메시지가 없거나 Firebase 권한 거부<br><span style="font-size:12px;">(브라우저 콘솔 확인)</span></div>';
      }
    }
  }, 1500);

  // 읽음 처리
  if (me?.uid && me?.role && room) {
    markRoomRead(roomId, me.role, me.uid, room).catch(() => {});
  }

  // 입력창 자동 포커스 — 데스크톱만
  if (!isMobileViewport()) {
    setTimeout(() => {
      const chatInput = document.querySelector('[data-page="workspace"] .ws-input input, [data-page="workspace"] .ws-input textarea');
      chatInput?.focus();
    }, 30);
  }
}

/* 채팅 메시지 렌더 — v2 chat-render.js 위임 */
export function renderChatMessages(msgs, room) {
  const msgWrap = document.querySelector('[data-page="workspace"] .ws-chat-msgs');
  if (!msgWrap) return;
  if (!msgs || !msgs.length) {
    msgWrap.innerHTML = '<div style="padding:24px; text-align:center; color:var(--text-muted);">메시지가 없습니다</div>';
    return;
  }
  const me = store.currentUser || {};
  const sorted = [...msgs].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  msgWrap.innerHTML = v2RenderChatMessages(sorted, {
    uid: me.uid,
    peerReadAt: getPeerReadAt(room, me.role),
  });
  alignChatSpacers(msgWrap);
  msgWrap.scrollTop = msgWrap.scrollHeight;
}

/* 발신자 뱃지(.chat-sender) 폭 측정 → 같은 발신자 연속 메시지 spacer 폭 일치 */
function alignChatSpacers(msgWrap) {
  const rows = [...msgWrap.querySelectorAll('.chat-row.is-other')];
  let lastBadgeW = 0;
  rows.forEach(row => {
    const badge = row.querySelector('.chat-sender');
    const spacer = row.querySelector('.chat-sender-spacer');
    if (badge) {
      lastBadgeW = badge.offsetWidth;
    } else if (spacer && lastBadgeW) {
      spacer.style.width = lastBadgeW + 'px';
    }
  });
}

/* 패널 3 (계약 진행) + 패널 4 (차량 정보) 갱신 */
export function renderRoomDetail(room) {
  const page = document.querySelector('.pt-page[data-page="workspace"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  // [목록(0), 채팅(1), 계약진행(2), 차량상세(3)]
  const stepCard = cards[2];
  const carCard = cards[3];

  if (!room) {
    if (stepCard) stepCard.querySelector('.ws4-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);"><i class="ph ph-chat-circle" style="font-size:24px;display:block;margin-bottom:6px;"></i>대화방을 선택하세요</div>`;
    if (carCard) carCard.querySelector('.ws4-body').innerHTML = '';
    return;
  }
  const role = store.currentUser?.role;

  // 계약 진행 — contracts 다층 lookup
  const productUid = room.product_uid || room.product_id;
  const carNumberRoom = room.vehicle_number || room.car_number;
  const linkedContract = room.linked_contract;
  const normCar = s => String(s || '').replace(/\s/g, '');
  const contract = (store.contracts || []).filter(c => !c._deleted).find(c =>
    c.product_uid === productUid ||
    c.seed_product_key === productUid ||
    (linkedContract && c.contract_code === linkedContract) ||
    (carNumberRoom && normCar(c.car_number_snapshot) === normCar(carNumberRoom))
  );
  // 3번 패널(계약 진행): 진행 단계 + 메모
  if (stepCard) {
    if (!contract) {
      stepCard.querySelector('.ws4-body').innerHTML = `
        <div style="padding: 12px; text-align: center; color: var(--text-muted);">
          <i class="ph ph-file-text" style="font-size:24px; display:block; margin-bottom:6px;"></i>
          <div style="margin-bottom: 8px;">연결된 계약 없음</div>
          ${(role === 'agent' || role === 'agent_admin' || role === 'admin') ? `<button class="btn btn-sm btn-primary" id="wsCreateContract"><i class="ph ph-plus"></i> 계약 생성</button>` : ''}
        </div>
      `;
      stepCard.querySelector('#wsCreateContract')?.addEventListener('click', () => createContractFromRoomLocal(room));
    } else {
      stepCard.querySelector('.ws4-body').innerHTML = renderContractWorkV2(contract);
      bindContractWorkV2(stepCard, contract, {
        reRender: () => {
          const r = (store.rooms || []).find(x => x._key === _activeRoomId);
          if (r) renderRoomDetail(r);
        },
      });
    }
  }

  // 4번 패널(차량 정보): 차량정보 + 계약 있으면 서류 섹션도 같이
  if (carCard) {
    const carNumber = room.vehicle_number || room.car_number;
    const contractCar = contract?.car_number_snapshot;
    const norm = s => String(s || '').replace(/\s/g, '');
    let p = (store.products || []).find(x =>
      x._key === productUid ||
      x.product_uid === productUid ||
      norm(x.car_number) === norm(carNumber) ||
      (contractCar && norm(x.car_number) === norm(contractCar)) ||
      x.product_code === productUid
    );

    const _finishCarPanel = () => {
      if (!contract) return;
      // 서류 섹션을 차량 정보 패널에 추가
      renderContractDocs(carCard, contract);
      if (_contractUnsub) { try { _contractUnsub(); } catch (_) {} }
      _contractUnsub = watchRecord(`contracts/${contract._key}`, (latest) => {
        if (!latest) return;
        const docChanged =
          latest.doc_license !== contract.doc_license ||
          latest.customer_license_url !== contract.customer_license_url ||
          JSON.stringify(latest.doc_attachments) !== JSON.stringify(contract.doc_attachments) ||
          JSON.stringify(latest.customer_docs) !== JSON.stringify(contract.customer_docs);
        if (!docChanged) return;
        Object.assign(contract, {
          doc_license: latest.doc_license,
          customer_license_url: latest.customer_license_url,
          doc_attachments: latest.doc_attachments,
          customer_docs: latest.customer_docs,
        });
        renderContractDocs(carCard, contract);
      });
    };

    if (p) {
      renderSearchDetail(p, carCard, { skipHead: true });
      _finishCarPanel();
    } else if (productUid) {
      carCard.querySelector('.ws4-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">불러오는 중...</div>`;
      const _enriched = (store.policies || []);
      fetchRecord(`products/${productUid}`).then(raw => {
        if (raw) {
          p = { _key: productUid, ...raw };
          if (p.policy_code) p._policy = _enriched.find(pol => pol.policy_code === p.policy_code) || {};
          renderSearchDetail(p, carCard, { skipHead: true });
        } else {
          carCard.querySelector('.ws4-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">${esc(carNumber || productUid)} — 상품 정보 없음</div>`;
        }
        _finishCarPanel();
      }).catch(() => { _finishCarPanel(); });
    } else {
      carCard.querySelector('.ws4-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">${carNumber ? esc(carNumber) + ' — 상품 정보 없음' : '차량 정보 없음'}</div>`;
      _finishCarPanel();
    }
  }
}

/* 채팅 입력 — Enter 또는 전송 클릭 */
export function bindChatInput() {
  const page = document.querySelector('.pt-page[data-page="workspace"]');
  if (!page) return;
  const inputBar = page.querySelector('.ws-input');
  if (!inputBar) return;
  const input = inputBar.querySelector('input.input');
  const sendBtn = inputBar.querySelector('.btn-primary');
  if (!input || !sendBtn) return;

  const send = async () => {
    const text = input.value.trim();
    if (!text || !_activeRoomId) return;
    input.focus();           // PWA 키보드 유지 — await 전에 동기 focus
    input.value = '';
    try {
      await pushRecord(`messages/${_activeRoomId}`, {
        text,
        sender_uid: store.currentUser?.uid || '',
        sender_role: store.currentUser?.role || '',
        sender_code: store.currentUser?.user_code || '',  // 개인 식별자만 — company_code 폴백 금지 (공유 임시채널 노출 방지)
        sender_name: store.currentUser?.name || '',
        sender_email: store.currentUser?.email || '',
        created_at: Date.now(),
      });
      // 룸 메타 갱신
      const role = store.currentUser?.role;
      const senderCode = store.currentUser?.user_code || '';
      const update = {
        last_message: text,
        last_message_at: Date.now(),
        last_sender_uid: store.currentUser?.uid || '',
        last_sender_code: senderCode,
        last_sender_role: role,
      };
      updateRecord(`rooms/${_activeRoomId}`, update).catch(() => {});
      // unread 는 원자적 증가 — 동시 전송 race 방지 (mobile-workspace 와 동일 규격)
      const unreadField = (role === 'agent' || role === 'agent_admin') ? 'unread_for_provider'
                        : role === 'provider' ? 'unread_for_agent' : null;
      if (unreadField) incrementAtomic(`rooms/${_activeRoomId}/${unreadField}`).catch(() => {});
      // 상대편·관리자에게 FCM 푸시 (앱 닫혀있어도 알림) — 비차단
      import('../core/push.js').then(m => m.notifyNewMessage(_activeRoomId, text)).catch(() => {});
    } catch (e) {
      console.error('[chat] send fail', e);
      input.value = text;     // 실패 시 텍스트 복구
    }
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;  // 한글 IME 조합중 엔터 무시 (확정글자 재삽입 방지)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // 파일 첨부
  const fileInput = inputBar.querySelector('.ws-file-input');
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || !_activeRoomId) return;
    await sendChatFile(file, _activeRoomId);
  });
}

async function sendChatFile(file, roomId) {
  if (file.size > 20 * 1024 * 1024) { showToast('20MB 이하 파일만 첨부 가능합니다', 'error'); return; }
  try {
    showToast('업로드 중...', 'info');
    const { uploadFile, uploadImage } = await import('../firebase/storage-helper.js');
    const safe = file.name.replace(/[^\w.\-가-힣]/g, '_').slice(0, 100) || 'file';
    const path = `contract-files/chat-${roomId}/${Date.now()}_${safe}`;
    const isImage = file.type.startsWith('image/');
    const { url } = isImage ? await uploadImage(path, file) : await uploadFile(path, file);
    const user = store.currentUser || {};
    const msgData = {
      text: file.name,
      sender_uid: user.uid || '',
      sender_role: user.role || '',
      sender_code: user.user_code || '',
      sender_name: user.name || '',
      sender_email: user.email || '',
      created_at: Date.now(),
    };
    if (isImage) msgData.image_url = url; else msgData.file_url = url;
    await pushRecord(`messages/${roomId}`, msgData, { skipAudit: true });
    const lastMsg = isImage ? `[사진] ${file.name}` : `[파일] ${file.name}`;
    const role = user.role;
    updateRecord(`rooms/${roomId}`, {
      last_message: lastMsg, last_message_at: Date.now(),
      last_sender_uid: user.uid || '', last_sender_role: role,
      last_sender_code: user.user_code || '',
    }).catch(() => {});
    const unreadField = (role === 'agent' || role === 'agent_admin') ? 'unread_for_provider'
                      : role === 'provider' ? 'unread_for_agent' : null;
    if (unreadField) incrementAtomic(`rooms/${roomId}/${unreadField}`).catch(() => {});
    import('../core/push.js').then(m => m.notifyNewMessage(roomId, lastMsg)).catch(() => {});
  } catch (e) {
    console.error('[chat] file send fail', e);
    showToast('파일 전송 실패: ' + (e?.message || ''), 'error');
  }
}

/* 상품 → 대화방 생성 — 상품찾기 상세 / 업무소통 + 버튼 공용
 *  기존 룸 있으면 그쪽으로 이동 (중복 방지). 없으면 새로 생성. */
export async function createRoomFromProduct(product) {
  if (!product) return;
  // 동일 상품의 기존 룸 재사용
  const existing = (store.rooms || []).find(r =>
    r.product_uid === product._key ||
    r.product_id === product._key ||
    (r.car_number && r.car_number === product.car_number)
  );
  if (existing) {
    location.hash = 'workspace';
    selectRoom(existing._key);
    showToast('기존 대화방으로 이동', 'info');
    return;
  }
  try {
    const me = store.currentUser || {};
    const isAgent = me.role === 'agent' || me.role === 'agent_admin';
    const isProvider = me.role === 'provider';
    const isAdmin = me.role === 'admin';
    // 관리자가 공급사에 문의 시 — admin 이 영업자 역할 (admin_uid + agent_uid 동일하게)
    // 채팅에서 admin 메시지는 영업자 측 메시지로 표시됨
    const ref = await pushRecord('rooms', {
      car_number: product.car_number,
      maker: product.maker,
      model: product.model,
      sub_model: product.sub_model,
      product_id: product._key,
      product_uid: product._key,
      provider_company_code: product.provider_company_code,
      partner_code: product.partner_code,
      // 관리자/영업자 모두 agent_uid 채워서 공급사 측에서 "영업자가 문의" 형태로 받음
      agent_uid: (isAgent || isAdmin) ? (me.uid || '') : '',
      agent_name: (isAgent || isAdmin) ? (me.name || '') : '',
      agent_code: (isAgent || isAdmin) ? (me.user_code || '') : '',
      agent_channel_code: isAgent ? (me.agent_channel_code || me.channel_code || me.company_code || '') : (isAdmin ? 'ADMIN' : ''),
      provider_uid: isProvider ? (me.uid || '') : '',
      // admin 이 만들었음을 별도 표시 (UI 에서 "관리자 문의" 라벨 등 활용 가능)
      created_by_admin: isAdmin || false,
      unread: 0,
      created_at: Date.now(),
      created_by: me.uid || '',
    });
    const newKey = ref?.key || ref;
    location.hash = 'workspace';
    if (typeof newKey === 'string') selectRoom(newKey);

    // 알림 — 공급사 + 관리자에게 신규 대화 알림
    notifyProviderAndAdmin({
      template: 'new_inquiry',
      providerCode: product.provider_company_code,
      subject: '신규 대화',
      message: `[Freepass]\n${me?.name || '영업자'}님이 ${product.car_number || ''} ${product.maker || ''} ${product.sub_model || product.model || ''} 대화를 시작했습니다.`,
    }).catch(() => null);

    showToast('대화방 생성됨', 'success');
  } catch (e) {
    console.error('[room create]', e);
    showToast('생성 실패 — ' + (e.message || e), 'error');
  }
}

/* 새 대화방 — 업무소통 페이지 헤드 "+" 버튼 → 차량번호 prompt */
export function bindRoomCreate() {
  const btn = document.querySelector('[data-page="workspace"] .ws4-list .ws4-head button.btn-sm');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const carNumber = prompt('차량번호 (예: 56다 1234):');
    if (!carNumber?.trim()) return;
    const product = (store.products || []).find(p => p.car_number === carNumber.trim() || p.car_number?.replace(/\s/g, '') === carNumber.trim().replace(/\s/g, ''));
    if (!product) return alert('해당 차량번호 상품이 없습니다');
    await createRoomFromProduct(product);
  });
}
