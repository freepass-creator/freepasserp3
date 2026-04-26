import { describe, it, expect } from 'vitest';
import { parseVehicleRegistration } from '../ocr-parsers/vehicle-registration.js';
import { extractCarNumber, extractVin, extractDate } from '../ocr.js';

/* OCR 텍스트 → 차량 필드 매핑 검증 — 실제 등록증 OCR 결과를 흉내낸 텍스트로 테스트 */

describe('extractCarNumber', () => {
  it('표준 차량번호 (3자리·한글·4자리)', () => {
    expect(extractCarNumber('차량번호 123가 4567 \n기타...')).toBe('123가4567');
  });
  it('2자리 형식', () => {
    expect(extractCarNumber('번호: 56다 1234')).toBe('56다1234');
  });
  it('공백 제거', () => {
    expect(extractCarNumber('  56다1234  ')).toBe('56다1234');
  });
  it('매칭 실패 → null', () => {
    expect(extractCarNumber('아무 차량번호 없음')).toBeNull();
  });
});

describe('extractVin', () => {
  it('17자리 VIN 추출', () => {
    expect(extractVin('VIN: KMHJ281ABNU123456')).toBe('KMHJ281ABNU123456');
  });
  it('I/O/Q 등 금지문자 미포함만 매칭', () => {
    // VIN 은 I, O, Q 제외이므로 17자리 모두 [A-HJ-NPR-Z0-9]
    const text = 'KMHJ281BNU1234567';
    expect(extractVin(text)).toBe('KMHJ281BNU1234567');
  });
  it('짧은 문자열 → null', () => {
    expect(extractVin('SHORT123')).toBeNull();
  });
});

describe('extractDate', () => {
  it('YYYY.MM.DD 형식', () => {
    expect(extractDate('등록일: 2018.05.10')).toBe('2018-05-10');
  });
  it('YYYY-MM-DD 형식', () => {
    expect(extractDate('2020-12-31')).toBe('2020-12-31');
  });
  it('한글 형식 (년월일)', () => {
    expect(extractDate('2019년 3월 7일')).toBe('2019-03-07');
  });
  it('두자리 연도 (50 미만은 2000년대)', () => {
    expect(extractDate('22.06.15')).toBe('2022-06-15');
  });
  it('두자리 연도 (50 이상은 1900년대)', () => {
    expect(extractDate('99.01.20')).toBe('1999-01-20');
  });
});

describe('parseVehicleRegistration', () => {
  it('차량번호·VIN·등록일·연식·제조사·모델·연료·배기량 통합 추출', () => {
    const text = `
      자동차등록증
      차량번호 12가 3456
      차대번호 KMHJ281ABNU123456
      차명 그랜저
      최초등록일 2018.05.10
      현대 그랜저
      가솔린
      배기량 2,998 cc
    `;
    const result = parseVehicleRegistration(text);
    expect(result.car_number).toBe('12가3456');
    expect(result.vin).toBe('KMHJ281ABNU123456');
    expect(result.first_registration_date).toBe('2018.05.10');
    expect(result.year).toBe('2018');
    expect(result.maker).toBe('현대');
    expect(result.model).toBe('그랜저');
    expect(result.fuel_type).toBe('가솔린');
    expect(result.engine_cc).toBe('2998');
  });

  it('빈 텍스트 → 빈 객체에 가까움 (필드별 fallback)', () => {
    const result = parseVehicleRegistration('');
    expect(result.car_number).toBeUndefined();
    expect(result.vin).toBeUndefined();
    expect(result.maker).toBeUndefined();
  });

  it('연료 매핑 별칭 (휘발유 → 가솔린)', () => {
    const result = parseVehicleRegistration('차량번호 12가 3456\n휘발유');
    expect(result.fuel_type).toBe('가솔린');
  });

  it('연료 매핑 별칭 (경유 → 디젤)', () => {
    const result = parseVehicleRegistration('차량번호 12가 3456\n경유');
    expect(result.fuel_type).toBe('디젤');
  });
});
