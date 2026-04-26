import { defineConfig } from 'vitest/config';

/* freepass v3 — 비즈니스 로직 격리 테스트
 *  vite.config.js 의 dev plugins(localServerless 등)는 분리.
 *  대상: store 의존 없는 순수 함수 (settlement-rules, vehicle-registration, etc.) */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'src/**/__tests__/**/*.test.js'],
    globals: false,
  },
});
