import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../dialogs.js';

/* dialogs 의 순수 헬퍼 — DOM/store 의존 X */

describe('normalizePhone', () => {
  it('하이픈 제거', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
  });
  it('공백 제거', () => {
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
  });
  it('국가코드 + 하이픈', () => {
    expect(normalizePhone('+82-10-1234-5678')).toBe('821012345678');
  });
  it('전화번호 외 모든 비숫자 제거 (텍스트·기호 모두)', () => {
    expect(normalizePhone('Tel: (010) 1234-5678 ext.99')).toBe('0101234567899');
  });
  it('빈/null 처리', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
  it('숫자만 입력은 그대로', () => {
    expect(normalizePhone('01012345678')).toBe('01012345678');
  });
});
