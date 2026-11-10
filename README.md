# Paddock

> **가상 코인 전용 · 현금 가치 없음 · 환전 불가.**
> Paddock의 코인은 게임 안에서만 쓰이는 가상 포인트입니다. 실제 돈으로 사거나 바꿀 수 없고, 어떤 형태의 상금도 없습니다.

친구 커뮤니티를 위해 직접 운영한 실시간 멀티플레이 가상 코인 게임 플랫폼.
난수·판정·정산을 모두 Postgres 함수에서 처리하고, 클라이언트는 아무것도 신뢰하지 않는 구조입니다.

- 스택: Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, RLS, Realtime, pg_cron) · Vercel
- 대표 기능: 경마(몬테카를로 고정배당, 레이스 중계), 서버 판정 4게임(룰렛·슬롯·하이로우·키노), 1:1 대전, P2P 거래와 원장

## 상태

공개 정리 작업 중입니다. 진행 계획과 단계별 완료 기준은 [docs/PLAN.md](docs/PLAN.md)를 보세요.
로컬 실행법(`supabase start` 기준)은 DB 재구성 단계(P2) 이후에 정리합니다.

```bash
npm install
cp .env.local.example .env.local   # Supabase URL / publishable key 입력
npm run dev
```

## 라이선스

[MIT](LICENSE)
