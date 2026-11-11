# Paddock

실시간 멀티플레이 가상 코인 게임 플랫폼 (Next.js App Router + TypeScript + Tailwind + Supabase + Vercel).
모든 난수·판정·정산은 Postgres 함수에서 처리하고 클라이언트는 신뢰하지 않는다.
가상 코인이며 현금 가치가 없다.

## 기준 문서
- 계획과 단계별 완료 기준: docs/PLAN.md (7~8절). 결정이 바뀌면 PLAN.md를 먼저 고친다.
- 원본: ../mini-casino (읽기 전용, 절대 수정하지 않는다)
- 원본 운영 패치 기록: _private/ (gitignore, 공개 금지. ops-log 작성 때만 참고)

## 작업 규칙
- 단계(P0~P6)는 하나씩 진행하고, 완료 기준을 통과하면 "P1: 용어 중립화"처럼 단계 이름으로 커밋한다.
- 원본 콘셉트의 잔재 용어를 코드·주석·SQL·이미지·문서 어디에도 남기지 않는다. 금지어 목록은 scripts/check-theme.sh에 있다.
- 용어 매핑은 docs/PLAN.md 3절의 표를 따른다 (에너지, 휴식 쿨다운, 캐주얼/아레나, 상점, 개인거래, 프로필, 피드백, 친구 피드).
- 경마의 수치와 함수 시그니처는 바꾸지 않는다. 문구와 주석만 중립화한다.
- 함수 몸통은 마이그레이션 한 파일에만 둔다. 같은 함수가 두 곳에 보이면 버그다.
- 라이브 DB에 적용하는 변경은 새 마이그레이션 파일로만 추가한다. 기존 마이그레이션을 고치지 않는다.
- 규칙 상수는 서버의 get_rules()가 정본이다. 클라이언트에 같은 값을 따로 적지 않는다.
- 비밀키(service_role, sb_secret_*)와 .env는 절대 커밋하지 않는다.
- 출처를 알 수 없는 이미지·폰트는 쓰지 않는다.
- 확신이 없는 동작은 코드를 읽어 확인하고 PLAN.md의 (확인 필요) 항목에 결과를 기록한다.

## 명령
- npm run dev / build / lint / typecheck / test (Vitest) / test:e2e (Playwright, 로컬은 PW_CHANNEL=chrome)
- node scripts/fixtures.mjs [--check]   # 서버 규칙 값 → tests/fixtures
- supabase start / supabase db reset / supabase test db
- bash scripts/check-theme.sh [경로...]   # 금지어 0건이어야 통과
