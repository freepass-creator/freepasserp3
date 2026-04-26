/**
 * alimtalk.js — 카카오 알림톡 (Aligo) 전송 프론트 헬퍼
 *
 * Flask `/api/alimtalk/send` 프록시 경유. API 키는 서버 env에 보관.
 * 템플릿은 Aligo 콘솔에서 사전 승인 필요 — 본문 문자열을 variables._message로 그대로 전달.
 *
 * 사용 예:
 *   sendAlimtalk({
 *     template: 'new_inquiry',
 *     tel: '01012345678',
 *     message: '신규 문의: 12가3456 그랜저',
 *     subject: '문의 알림',
 *   });
 */

/** 저수준: Flask /api/alimtalk/send 호출
 *  실패해도 throw하지 않고 {ok:false} 리턴 — 알림 실패가 비즈니스 플로우 막으면 안됨 */
export async function sendAlimtalk({ template, tel, message, subject = '', variables = {} } = {}) {
  if (!template || !tel || !message) return { ok: false, error: 'required: template, tel, message' };
  try {
    const res = await fetch('/api/alimtalk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_code: template,
        receiver_tel: tel,
        variables: { ...variables, _message: message, _subject: subject },
      }),
    });
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[alimtalk] 전송 실패', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ── 템플릿별 헬퍼 (본문 포맷 일원화) ── */

/** 신규 문의가 공급사에 도착했을 때 */
export function notifyNewInquiry({ providerTel, agentName, carNo, model }) {
  return sendAlimtalk({
    template: 'new_inquiry',
    tel: providerTel,
    subject: '신규 문의',
    message: `[Freepass]\n${agentName || '에이전트'}님이 ${carNo || ''} ${model || ''} 문의를 보내셨습니다.\n앱에서 확인하세요.`,
  });
}

/** 계약서 발송 알림 (에이전트에게) */
export function notifyContractSent({ agentTel, carNo, link }) {
  return sendAlimtalk({
    template: 'contract_sent',
    tel: agentTel,
    subject: '계약서 발송',
    message: `[Freepass]\n${carNo || ''} 계약서가 발송되었습니다.\n${link || '앱에서 확인'}`,
  });
}

/** 계약 체결 완료 (양측에게) */
export function notifyContractDone({ tel, carNo, customerName }) {
  return sendAlimtalk({
    template: 'contract_done',
    tel,
    subject: '계약 체결',
    message: `[Freepass]\n${carNo || ''} ${customerName || '고객'} 계약이 체결됐습니다.`,
  });
}

/** 정산 지급 예정 */
export function notifySettleReady({ tel, amount, carNo }) {
  return sendAlimtalk({
    template: 'settle_ready',
    tel,
    subject: '정산 알림',
    message: `[Freepass]\n${carNo || ''} 정산금 ${Number(amount || 0).toLocaleString('ko-KR')}원이 지급 예정입니다.`,
  });
}
