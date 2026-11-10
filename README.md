# Paddock

> **가상 코인 전용 · 현금 가치 없음 · 환전 불가.**
> Paddock의 코인은 게임 안에서만 쓰이는 가상 포인트입니다. 실제 돈으로 사거나 바꿀 수 없고, 어떤 형태의 상금도 없습니다.

친구 커뮤니티를 위해 직접 운영한 실시간 멀티플레이 가상 코인 게임 플랫폼.
난수·판정·정산을 모두 Postgres 함수에서 처리하고, 클라이언트는 아무것도 신뢰하지 않는 구조입니다.

- 스택: Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, RLS, Realtime, pg_cron) · Vercel
- 대표 기능: 경마(몬테카를로 고정배당, 레이스 중계), 서버 판정 4게임(룰렛·슬롯·하이로우·키노), 1:1 대전, P2P 거래와 원장

## 로컬 실행

필요한 것: Node.js 20+, Docker Desktop(실행 중).

```bash
npm install
npm run db:start                    # 로컬 Supabase(Postgres · Auth · Storage · Realtime) 기동
npm run db:reset                    # supabase/migrations 전부 + supabase/seed.sql 적용
cp .env.local.example .env.local    # 키는 npx supabase status 의 Publishable key
npm run dev
```

로컬 데모 계정: `demo01` ~ `demo03` / `paddock-demo`, 관리자 `admin` / `paddock-admin` (seed.sql — 로컬 전용).

DB 구조는 `supabase/migrations/` 에 도메인별로 나뉘어 있다(core · items · games · trade · arena · social · admin · missions · explore · race · rules · platform). 같은 함수의 몸통은 한 파일에만 있고, 운영 DB 변경은 새 마이그레이션 파일로만 추가한다.

공개 정리 진행 상황은 [docs/PLAN.md](docs/PLAN.md)를 보세요.

## 라이선스

[MIT](LICENSE)
