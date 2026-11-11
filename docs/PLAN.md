# mini-casino → 공개용 클론 프로젝트 구상

Nov 10, 2026 · @무토

mini-casino는 콘셉트 문구를 갈아끼우는 리스킨만으로 공개용 포트폴리오 프로젝트로 정리할 수 있다. 테마 용어는 많지만 문구 파일과 상수에 몰려 있고, 판정과 정산 로직은 상당 부분 테마와 분리돼 있기 때문이다. 이 문서는 README, 헤더 주석, 파일 구조, 경마 SQL과 클라이언트 앞부분을 읽고 쓴 것이며 각 모듈의 본문 로직은 다 읽지 못했다. 코드로 직접 검증해야 할 부분은 (확인 필요)로 표시했다.

## 1. 현재 규모와 콘셉트 결합도

| 구분 | 규모 |
| --- | --- |
| SQL | 25개 파일, 약 1.6만 줄 (`02_schema.sql` 한 파일이 약 4천 줄) |
| 클라이언트 | 약 2만 줄. `AdminPanel` 2583줄, `Record` 2435줄, `Casino` 979줄이 특히 큼 |
| 공개 RPC | 100여 개 |
| 경마 | SQL 1021줄 + `race.ts` 285줄 + `race/` 컴포넌트 4개 약 980줄 |

콘셉트 용어는 병동 271회, 가축 208회, 배급소 110회, 밀거래 108회 등으로 많이 나온다. 이 용어들은 `copy.ts`(문구 864줄), `rules.ts`, 상수 몇 군데에 집중돼 있다.

## 2. 새 정체성

프로젝트를 "카지노"가 아니라 서버가 모든 판정을 하는 실시간 리아트타임 플랫폼으로 재정의한다.

- **한 줄 정의**: 친구 커뮤니티를 위해 직접 운영한, 실시간 멀티플레이 가상 코인 게임 플랫폼. 난수·판정·정산을 모두 Postgres 함수에서 처리하고 클라이언트는 아무것도 신뢰하지 않는 구조다.
- **이름**: `Paddock`(경마장 경주마 대기장)로 확정했다. 카지노와 수감 이미지를 모두 지우는 이름이다. 경마가 간판 기능이 되기도 한다.
- **톤**: 건조한 공문체와 반말 카피를 버리고 중립적인 UI 문구로 맞춘다.
- **필수 고지**: "가상 코인, 현금 가치 없음, 환전 불가"를 README와 사이트 푸터에 명시한다. 도박 서비스로 오해받는 것을 막는 가장 싼 방법이다. 하우스 엣지 계산은 확률 설계 문서로만 소개한다.

## 3. 살릴 것, 바꿀 것, 뺄 것

경마를 포함한 서버 판정 게임과 거래/원장이 핵심 전시물이고, 서사와 시설 설정에 묶인 부분은 바꾸거나 뺄다.

### 살릴 것 (핵심 전시물)

- **경마장**: 말 20두의 능력치 모델, 숨은 컨디션 5단계, 공개 정보만으로 돌리는 몰테카를로(1500회) 고정배당, 공제율 파라미터, 단승·연승·복승, 10구간 스플릿 타임을 보간해 그리는 레이스 중계, 정산 `pg_cron` + lazy 보조 정산, 시험 경주 모드
- 서버 판정 4게임(룰렛·슬롯·하이로우·키노)과 `play_game()`, RLS 구조
- 1:1 대전(주사위·인디언포커·블랙잭)
- ~~라스트카드~~ → 제외 (P1에서 확인: 밀거래 해금·특별 상품 전용 미니게임이라 밀거래와 함께 뺐다. 필요하면 Arena 종목으로 다시 붙인다.)
- 개인 거래와 원장(ledger), 아이템/상점, 관리자 패널
- Realtime Presence 접속자, 실시간 결과 피드, 일일 리셋(KST, cron)
- `usePendingSettle`: 애니메이션이 끊기더라도 정산은 반드시 흘려보내는 훅

* **탐험 고양이**(`24`): 탐험 중 유저·날짜마다 정해진 자리에서 고양이를 만나 간식주기·쓰다듬기로 친해지고, 이름을 지어 주면 확률적으로 보은 선물(거래 불가)을 받는 이벤트. 보은 효과가 판돈 보너스, 훔치기 성공률, 작업 보상에 걸려 있어 탐험·작업·훔치기 로직 일부는 남기고 중립화하거나 다른 효과로 대체해야 한다(확인 필요). 공개 스위치 `app.cat_public()`과 시험 계정 패널 처리도 정리 대상이다.

### 이름과 규칙만 바꿀 것 (메커니즘은 유지)

| 현재 | 중립 버전 |
| --- | --- |
| 체력, 병동(사다리 시간) | 에너지, 휴식 쿨다운 |
| 백색구역 / 흑색구역 | Casual / Arena |
| 배급소 | 상점 |
| 작업장 | 일일 미션 |
| 탐색 | 탐험(드랍) |
| 수용실 주간 재배치 | 룸 주간 재배치 |
| 수감기록(`Record`) | 프로필 |
| 진정함 | 피드백 게시판 |
| 소식(관계) | 친구 피드 |
| 라디오 CH2 속보 | 인사이더 팁 (경마의 핵심이라 유지) |
| `FACILITY`, `FORM_NO` 등 시설 상수 | 설정 상수로 교체 |

### 뺄 것

- 가축 지목권, 호칭권, 담배·약물·의약품류 아이템, 훔치기·밀거래 서사(`05`, `15`, `16`의 테마 부분)
- 추석 송편(`20`), 병동 세부 사다리(`12`, `14`)
- `public/npc/smuggler.jpg`, `public/guide/*.png`: 출처와 저작권을 확인할 수 없는 이미지는 모두 교체한다.
- README와 SQL 주석의 실명처럼 보이는 예시(`윤태강`)와 "죄수번호-코드" 로그인 형식은 없애고, 일반적인 **아이디/비밀번호** 형식으로 바꾼다. 아이디는 영문·숫자, 예시 값은 `demo01` 같은 중립 값을 쓴다. 현재 `auth.ts`가 이름을 가짜 이메일로 인코딩하는 방식이라 아이디 변환 규칙과 화면의 `NO.` 표기(수용번호)를 함께 손봐야 한다(확인 필요).

## 4. 클론 가능한 프로젝트로 만들기

지금은 "Supabase 프로젝트를 만들고 SQL 25개를 순서대로 붙여넣기"가 설치 방법이다. 이것을 `supabase start`와 `supabase db reset` 두 줄로 끝나게 바꾸는 것이 "클론 프로젝트"의 본체다.

1. **새 공개 저장소를 새 히스토리로 시작한다.** 기존 private 저장소는 "실제 운영 원본"으로 남기고 이력서에 언급한다. 시작 전에 `gitleaks` 같은 도구로 키와 개인정보를 스캔한다. (얻은 사본이 얇은 클론이라 과거 커밋은 확인하지 못했다.)
2. **DB를 Supabase CLI 마이그레이션 구조로 재편한다.** `supabase/migrations/`에 날짜순 파일을 두고 `seed.sql`을 분리한다. `02_schema.sql`(약 4천 줄)에서 핵심만 뽑아 쪼개는 일이 전체에서 가장 크다.
3. **`repair/`와 `APPLY.md`는 버린다.** 다만 실제 운영 기록은 포트폴리오 자산이니 버리지 않는다. 날짜·문제·원인·수정·확인 방법을 표로 정리한 `docs/ops-log.md`에 테마와 무관한 10\~15건만 남기고, 대표 사례는 정식 마이그레이션과 회귀 테스트로 옮긴다(6절 참고). 새 히스토리로 시작하면 커밋 날짜 기록이 사라지므로 이 요약본이 그 증거를 대신한다.
4. **규칙 상수를 한 곳으로 모은다.** 지금은 `00_rules.sql`과 `game.ts`에 같은 값을 따로 적어 두는 구조라 어긋날 수 있다. 서버의 규칙 값을 RPC로 내려주는 방식으로 일원화하면 그 자체가 개선 사례가 된다.
5. **큰 컴포넌트를 쪼갬다.** `Record`, `AdminPanel`, `Casino`가 대상이다. 리뷰어는 2천 줄짜리 파일을 먼저 본다.
6. **데모를 연결한다.** 별도 Supabase 프로젝트에 계정 발급 없이 들어오는 "게스트 체험" RPC(임시 계정, 코인은 cron으로 주기 초기화)를 추가한다. 무료 티어는 오래 접속이 없으면 일시정지될 수 있으니 면접이나 지원 전에 깨워 둔다.

## 5. 작업 순서와 기간

전체 정리는 2\~3주, MVP 범위(경마, 4게임, 거래/원장, 관리자)는 약 1.5주다. 기간은 저의 감각적 추정이고 하루 작업 시간에 따라 달라진다. 어느 쪽이든 경마를 먼저 처음부터 끝까지 중립화해 돌려 보고 나머지를 확장한다.

| 단계 | 내용 | 기간 |
| --- | --- | --- |
| P0 | 비밀·개인정보 스캔, 새 저장소, 이미지 교체, 면책 문구 | 0.5일 |
| P1 | 카피 팩 교체, 시설 상수와 용어 중립화 | 2\~3일 |
| P2 | DB 재구성 (core 마이그레이션 + seed + `supabase start`) | 3\~5일 |
| P3 | 대형 컴포넌트 분할, 규칙 일원화 | 2\~3일 |
| P4 | 테스트와 CI | 3일 |
| P5 | 게스트 체험, 데모 배포, 경주 중계 GIF | 1\~2일 |
| P6 | README, 아키텍처 그림, 케이스 스터디 | 2\~3일 |

### 테스트에서 꼭 넣을 것

- 룰렛 색/숫자의 하우스 엣지가 2.00%라는 계산, 키노 배당표 기대값
- 경마 배당의 기대값이 `1 − 공제율`에 수렴하는지 (몰테카를로 시뮬레이션)
- pgTAP: anon 키가 코인이나 판 수를 직접 수정할 수 없는지, 마감 전에는 경주 결과가 어디에도 없는지, 정산 함수를 두 번 호출해도 지급이 한 번만 되는지
- Playwright로 로그인 → 경마 베팅 → 결과 확인 E2E 한 개, 그리고 GitHub Actions

## 6. 포트폴리오에서 설명할 것

이 프로젝트의 강점은 "클라이언트를 신뢰하지 않는 서버 중심 설계"와 "실제로 운영하며 배운 것"이다. 실제 이용자는 약 30명, 운영 기간은 약 2개월이다. 규모가 작으니 확장성은 과장하지 말고, 소규모 실사용 환경에서 정확성과 운영 안정성을 검증했다는 식으로 쓴다.

**소개 문장 예시**: "약 30명 규모의 친구 커뮤니티에서 2개월간 실제 운영한 실시간 멀티플레이 가상 코인 플랫폼. 난수·판정·정산을 모두 Postgres 함수에서 처리하고, 클라이언트는 아무것도 신뢰하지 않는 구조로 설계했습니다."

### 케이스 스터디 후보 (문제 → 결정 → 결과)

1. **클라이언트를 신뢰하지 않는 설계**: `play_game()` RPC, RLS는 SELECT만 허용, 관리자 함수는 anon에서 revoke. 부정행위 경로를 어떻게 막았는지.
2. **경마의 정보 비대칭**: 결과를 마감 전에 만들지 않고 숨은 컨디션 테이블은 RLS 정책 없이 RPC로만 읽게 한 점, 공개 정보로 몰테카를로 배당을 산출한 점, 라디오 팁을 얻은 사람만 우위에 서는 게임 디자인.
3. **정산 신뢰성**: `pg_cron` 정산과 lazy 정산의 이중화, 애니메이션과 정산의 분리(`usePendingSettle`).
4. **운영 사고에서 배운 것**: README에 남은 2026-09-18 사고(옛 `schema.sql`을 통째로 실행해 `play_game` 등이 초기 버전으로 덮이고 RLS가 풀림)과, 그 뒤 만든 "함수 몸통은 한 파일에만 둔다" 규칙. 이 사고가 마이그레이션 구조로 옮겨 가는 동기로 이어진다.
5. **프론트 성능**: 경주 중계에서 프레임마다 `requestAnimationFrame`이 ref로 DOM을 직접 갱신하고 React는 구간마다 한 번만 다시 그리는 설계(`RaceTrack` 주석 기준).
6. **거래와 원장**: P2P 거래의 이중 지출 방지와 원장 기록. 행 잠금이나 트랜잭션 처리는 `04_trade.sql`을 직접 확인한 뒤에 쓴다 (확인함 — P4: 제안 때는 코인을 묶지 않고, 성사 순간 거래 행과 두 사람의 profiles 행을 id 순으로 잠근 뒤 잔액을 다시 확인한다. 같은 코인으로 건 두 번째 선물은 `PARTNER_SHORT_COINS` 로 실패하는 것을 pgTAP 로 고정했다).

### 라이브 패치 기록(`repair/`)을 증거로 쓰기

`repair/`에는 2026-09-18부터 11-07까지 약 7주 동안 쌓인 스크립트 60개가 있다. 라이브 DB를 끄지 않고 계속 고쳐 왔다는 증거라서, 파일 자체를 올리지 말고 아래 세 건을 케이스 스터디로 골라 쓴다.

- **키노 환수율 보정** (`2026-10-07_keno_rtp.sql`): 환수율이 약 1.44라 플레이어가 크게 유리했다. 3개 적중 빈도를 1/15에서 1/28.5로 바꿔 약 0.98(하우스 엣지 2%)로 맞췄고, 룰렛 2.00%·슬롯 1.91%·하이로우 2.04%와 같은 기준으로 정렬했다. 수치로 진단하고 수정하고 검증한 흐름이 남아 있다.
- **하이로우 null 입력 취약점** (`2026-09-28_highlow_null_choice.sql`): `p_choice`에 null을 넣으면 승리로 처리돼, 브라우저 콘솔에서 RPC를 세 번 호출하면 판돈의 512배가 나오는 문제였다. null을 `INVALID_CHOICE`로 막고 결과를 `coalesce(..., false)`로 감쌌다. "클라이언트를 신뢰하지 않는 설계"의 실제 사례이며, pgTAP 회귀 테스트로 박제한다.
- **관리자 거래 취소(압수)** (`2026-10-12_trade_revert.sql`): 이미 쓰거나 넘긴 몫은 무시하고 지금 가진 만큼만 거두는 로직으로, 운영 중 생긴 엣지 케이스를 설계에 반영한 사례다.

**주의할 점**

- 60개 중 가축, 약물, 추석, 병동 사다리 관련 스크립트는 콘셉트에 묶여 있으니 공개하지 않는다.
- 패치 방식에는 약점이 있다. 라이브에서는 전체 파일을 다시 돌리지 못해 번호 파일의 본문을 복사해 쓰는 구조라 같은 함수가 두 곳에 생기고, 2026-09-18 사고가 그 위험이 터진 경우다. 숨기지 말고 "한계를 겪었고 그래서 마이그레이션 구조로 옮겼다"는 서사로 쓴다.
- 소개 문장 예시: "7주간 라이브 DB에 60건의 무중단 패치를 적용했고, 그중 키노 환수율 보정(1.44 → 0.98)과 RPC null 입력 취약점 수정을 사례로 정리했습니다." 건수와 기간은 `repair/` 파일 수와 날짜로 확인한 값이다.

### 면접 예상 질문

- 왜 로직을 앱 서버가 아니라 DB 함수에 넣었나? (장점은 원자성과 우회 차단, 단점은 테스트·배포·디버깅 난이도)
- 동시에 같은 판에 베팅하면 어떻게 되나?
- 접속자가 100배가 되면 어디가 먼저 막히나? (폴링 훅과 cron)
- 시간대와 일일 리셋은 어떻게 처리했나?

### 한계도 함께 적는다

초기에 SQL이 한 파일에 커졌던 것, 대형 컴포넌트, 테스트가 후행이었던 것, 그리고 이를 리팩터링으로 바로잡은 과정까지 쓰면 오히려 완성도가 높아 보인다.

### 포트폴리오 사이트 노출 순서

경마 중계 GIF → 아키텍처 다이어그램(클라이언트 → RLS/RPC → 테이블, cron) → 케이스 스터디 3\~4편 → 데모 링크와 코드 링크.

## 7. 확정 사항

아래 항목은 결정이 끝났다. 구현 중 바꿀 일이 생기면 이 표를 먼저 고치고 작업한다.

| 항목 | 확정 내용 |
| --- | --- |
| 이름 | Paddock |
| 범위 | 전체 정리 (2\~3주, P0\~P6) |
| 작업 방식 | Claude Code에서 새 저장소에 직접 구현한다. 이 문서를 Markdown으로 내보내 새 저장소의 `docs/PLAN.md`로 두고 기준 문서로 쓴다. (이전의 "이 대화 세션에서 커밋" 방식은 쓰지 않는다.) |
| 저장소 | 새 GitHub 저장소를 비공개로 시작해 P6 직전에 공개한다. 원본 `mini-casino`는 읽기 전용 참조다. |
| 스택 | 원본 유지: Next.js(App Router) + TypeScript + Tailwind + Supabase + Vercel |
| 로그인 | 아이디/비밀번호 형식. 계정은 관리자가 발급하는 방식을 유지하고 게스트 체험 계정을 추가한다. |
| 고양이 | 포함. 보은 효과 3종은 아래 제안값으로 중립화한다. |
| 운영 규모 | 이용자 약 30명, 운영 약 2개월 (소개 문장에 사용) |
| 라이선스·고지 | MIT 제안. README와 사이트 푸터에 "가상 코인, 현금 가치 없음, 환전 불가" 고지 |

### Claude Code가 구현하며 결정할 열린 항목

- [x] 고양이 선물 중립화 제안: 죽은 새(판돈 보너스) → 깃털(그대로 유지), 죽은 쥐(훔치기 성공률) → 장난감 쥐(탐험 드랍 확률 보너스로 대체), 죽은 벌레(다음 작업 보상 등급) → 나비(미션 보상 등급, 그대로 유지) — **제안대로 채택.** P1은 문구만 바꿨고, 코드값(`dead_*` → `feather`·`toy_mouse`·`butterfly`)과 장난감 쥐 효과는 P2에서 서버와 함께 바꾼다.
- [x] 회원가입 개방 여부 — **개방하지 않는다.** 관리자 발급 + (P5) 게스트 체험.
- [x] 플레이어 번호 형식 — **`#0001`.** P1은 아이디 해시로 계산(`identity.ts`), P2에서 profiles 발급 순번으로 바꾼다.

## 8. 단계별 작업 지시서

단계는 하나씩 진행하고, 완료 기준을 통과한 뒤에 `P1: 용어 중립화`처럼 단계 이름으로 커밋한다. 원본 저장소는 수정하지 않는다. 테마 잔재는 `scripts/check-theme.sh`로 기계적으로 막는다.

```bash
# scripts/check-theme.sh — 결과가 0건이어야 통과
git grep -nE '병동|가축|배급소|밀거래|수감|죄수|교정|무간|흑색구역|백색구역|진정함|수용|담배|약물|의약품|윤태강|징벌' -- . ':!docs/PLAN.md' ':!scripts/check-theme.sh' && exit 1 || exit 0
```

### P0. 안전 정리 (0.5일)

- [x] 새 저장소에 원본 트리를 복사하고 `git init`으로 새 히스토리를 시작한다(원본 `.git`은 가져오지 않는다).
- [x] 원본 저장소에서 `gitleaks detect`로 전체 히스토리를 스캔한다. 노출된 키가 있으면 Supabase에서 재발급한다.
- [x] `.env*`와 `*.local.sql`이 `.gitignore`에 있는지 확인하고, `.env.local.example`만 커밋한다.
- [x] `public/npc/smuggler.jpg`, `public/guide/*.png`를 삭제하고 직접 만든 placeholder로 교체한다. 출처를 알 수 없는 이미지는 올리지 않는다.
- [x] `supabase/repair/`와 `supabase/archive/`는 `_private/`(gitignore)로 옮긴다. P6의 ops-log 작성 때만 참고한다.
- [x] README 맨 위에 "가상 코인, 현금 가치 없음, 환전 불가" 고지를 넣고 MIT `LICENSE`를 추가한다.

완료 기준: gitleaks 0건, 교체한 이미지 확인, `npm run build` 통과.

> P0 결과(2026-11-10): gitleaks 8.30.1로 원본 전체 히스토리(177커밋)와 새 트리를 스캔해 0건. 원본은 얕은 클론이 아니어서 과거 커밋까지 확인했다. 이미지 3개는 삭제하고 `public/guide/*.svg` placeholder로 교체. `npm run build` 통과.

### P1. 클라이언트 용어 중립화 (2\~3일)

- [x] `src/lib/copy.ts`(864줄)의 문구를 중립 UI 문구로 전면 교체한다. `FACILITY`, `FORM_NO`, `FORM_LINE` 같은 시설 상수는 `src/lib/site.ts`의 설정(이름 Paddock)으로 옮긴다.
- [x] 3절의 매핑표를 적용한다: 체력→에너지, 병동→휴식, 백색구역→Casual, 흑색구역→Arena, 배급소→상점, 작업장→일일 미션, 탐색→탐험, 수감기록→프로필, 진정함→피드백, 소식→친구 피드.
- [x] 로그인 화면 `src/app/login/LoginForm.tsx`와 `src/lib/auth.ts`를 아이디/비밀번호 형식으로 바꾼다(DB 쪽은 P2). `NO.` 표기는 플레이어 번호로 바꾼다.
- [x] `rules.ts`, `guide.ts`, `identity.ts`, `gear.ts`, `labor.ts`, `radio.ts`, `rooms.ts`의 문자열도 정리한다.
- [x] 가축·약물·훔치기·밀거래·추석·병동 사다리 UI를 제거한다(`Smuggle.tsx`, `ChuseokPopup.tsx` 등. 나머지 위치는 금지어 grep으로 찾는다).
- [x] 고양이(`CatPopup.tsx`, `CatGiftPopup.tsx`, `CatTestPanel.tsx`)는 유지하고 문구만 중립화한다.
- [x] `scripts/check-theme.sh`를 추가한다.

완료 기준: `src/`에서 금지어 0건, `npm run build` 통과.

> P1 결과(2026-11-10): `bash scripts/check-theme.sh src` 0건, `tsc --noEmit`·`npm run build` 통과. 줄바꿈을 LF로 통일하고 `.gitattributes`를 추가했다. 삭제: `Smuggle.tsx`, `ChuseokPopup.tsx`, `LastCard.tsx`, 상점 훔치기, 가축·호칭권, 약물·중독·담배 분기, 송편. 사이트 설정은 `src/lib/site.ts`, 푸터·로그인에 고지 문구 표시. DB가 아직 원본 구조라 로그인·게임 동작은 P2에서 확인한다.
>
> **P2로 넘기는 것 (P1에서 확인한 클라이언트–DB 계약)**
> - 인증: 클라이언트는 `아이디@paddock.local` + 비밀번호로 로그인한다. `name_to_email`·`handle_new_user`·`admin_create_player`를 이 규칙으로 바꾼다. 관리자 화면의 "초기 비밀번호 보기" 표는 평문 보관이므로 P2에서 없앤다.
> - `set_profile_details`에서 `p_livestock_consent` 인자를 뺀다(클라이언트는 이미 보내지 않는다). 컬럼 `crime`은 화면에서 "상태 메시지"로 쓴다 → `status_message`로 개명 검토.
> - RPC·컬럼 이름에 남은 원본 용어: `inmate_roster`, `in_ward`/`ward_left`/`ward_cut`, `hp*`(=에너지), `petition*`(=피드백), `cell*`(=룸), 장소 코드 `cell/mess/shower/works/infirm`, 미션 코드 `latrine` 등. 서버와 함께 바꿀 때 클라이언트 타입(`game.ts`)도 같이 고친다.
> - 삭제된 기능의 RPC(`shop_steal`, `smuggle_*`, `lastcard_*`, `livestock_use`, `title_use`, `use_songpyeon`, `chuseok_*`)는 마이그레이션에 옮기지 않는다. `state_json`에서 `drug_*`·`addicted`·`addict_lines`·`withdrawal`·`steal_sure`·`livestock_*`·`chuseok` 필드도 뺀다.
> - 아이템 카탈로그: `tobacco`·`drug`·`adult`·`trick`·`event` 종류와 해당 품목을 seed에서 뺀다. `medicine` 종류는 "회복"으로 표시한다.
> - 고양이: `CatStatus.steal_ready` 제거, 장난감 쥐의 탐험 보너스 상태 필드 추가.

### P2. DB 재구성 (3\~5일, 가장 큰 단계)

- [x] `supabase init` 후 `supabase/migrations/`에 날짜순 파일로 옮긴다. 함수 몸통은 한 파일에만 둔다(원본의 규칙을 그대로 유지).
- [x] 분해 순서(제안): core(profiles, game\_rounds, ledger, RLS) → play\_game(룰렛·슬롯·하이로우·키노) → 아이템·상점·인벤토리 → 거래 → 1:1 대전·라스트카드 → 관리자 → 아바타(Storage) → 경마(`22`) → 탐험+고양이(`19`, `24`) → 일일 미션(`18`) → 룸 재배치(`13`)·친구 피드(`06`)·피드백(`07`).
- [x] 제외: `05`의 밀거래 대부분, `15`·`16` 훔치기, `20` 추석, `12`·`14` 병동 사다리(단순 휴식 쿨다운으로 대체).
- [x] 고양이 효과 중 훔치기에 연결된 부분은 7절 제안대로 탐험 드랍 보너스로 대체한다.
- [x] 인증: `name_to_email`, `handle_new_user`, `admin_create_player`를 아이디/비밀번호 방식으로 바꾼다.
- [x] `00_rules.sql`의 `app.*` 규칙 값을 서버 `get_rules()` RPC 하나로 내려주고, 클라이언트 `game.ts`의 중복 상수를 제거한다.
- [x] `supabase/seed.sql`: 말 20두, 아이템 카탈로그, 데모 계정(`demo01`\~).
- [x] 경마(`22_horse_race.sql`)의 수치와 함수 시그니처는 바꾸지 않는다. 주석과 문구만 중립화한다.

완료 기준: `supabase start && supabase db reset` 성공. 로컬에서 로그인 → 4게임 1판씩 → 경마 베팅과 정산을 수동으로 확인.
> P2 결과(2026-11-10)
>
> **방법.** 원본 25개 SQL 파일을 운영 순서(APPLY.md)대로 빈 로컬 DB에 적용해 "운영 최종 상태"를 만들고, 그 상태를 `pg_dump`(권한 포함)로 떠서 도메인별 마이그레이션 10개로 나눴다. 파일마다 같은 함수가 여러 번 정의되던 문제(나중에 도는 쪽이 이김)는 덤프가 최종 본문 하나만 남기므로 자동으로 해소됐다. 그 위에 기능 제거 · 이름 변경 · 본문 수정을 적용하고, `db reset` 뒤 `plpgsql_check`(plpgsql 함수)와 `check_function_bodies`(sql 함수)로 **모든 함수를 정적 검사해 오류 0건**을 확인했다. 덤프에 안 나오는 Auth 트리거 · Storage 버킷/정책 · pg_cron 예약은 `*_platform.sql` 로 따로 옮겼다.
>
> **결과.** `supabase/migrations/` 12개(core · items · games · trade · arena · social · admin · missions · explore · race · rules · platform) + `supabase/seed.sql`. 원본 번호 파일과 `APPLY.md` 는 저장소에서 지웠다(원본 저장소에 남아 있다).
> - 제거: 테이블 6개(밀거래 2 · 라스트카드 · 약물 구매 · 추석 뽑기 · 평문 코드 보관 `player_codes`), 함수 156개, profiles 컬럼 17개, item_defs 컬럼 6개, 사다리 트리거.
> - 휴식: 단계별 사다리(14→48시간)를 고정 14시간(`app.ward_hours()`)으로.
> - 인증: `username_to_email()` = `아이디@paddock.local`, 아이디는 `^[a-z0-9]{3,20}$`. 초기 비밀번호는 `app.gen_password()` 로 만들어 **발급 응답으로 한 번만** 돌려주고 평문을 저장하지 않는다. 관리자 삭제는 아이디 재입력 확인. 운영자 숨김 계정 이름 `admin`.
> - 이름 변경: `inmate_roster` → `player_roster`, `profiles.crime` → `status_message`, `cat_steal_boost` → `cat_search_boost`, 고양이 선물 코드 `feather` · `toy_mouse` · `butterfly`.
> - 장난감 쥐: 다음 탐험 한 번은 등급을 두 번 뽑아 높은 쪽(`app.roll_search(place, p_lucky)`).
> - 규칙 일원화: 룰렛 · 슬롯 · 키노 배당을 `app.roulette_*` · `app.slot_*` · `app.keno_mult()` 로 뽑아 `play_game` 이 이 함수를 쓰고, `public.get_rules()` 가 같은 값을 화면에 내려준다. 클라이언트의 중복 상수(PLAY_LIMIT · ROULETTE_* · SLOT_* · HL_* · KENO_* · CLOVER_STAKE · CAT_BIRD_* · RACE_PUBLIC)는 지우고 `src/lib/server-rules.ts` 의 `getRules()` 로 읽는다.
> - 카탈로그: 150 → 106개. adult · drug · event · permit · tobacco · trick 갈래와 해독제를 빼고, 무기처럼 읽히던 공구 7종은 코드째 평범한 공구로, 의약품은 휴식 단축 아이템으로 바꿨다. 탐험 장소별 갈래도 그에 맞췄다(장소마다 일반 등급 후보가 남는 것 확인).
>
> **확인한 것** (로컬 스택에 실제 HTTP로): `demo01@paddock.local` 로그인(틀린 비밀번호 400) → 룰렛 · 슬롯 · 키노 · 하이로우 각 1판 → `highlow_continue(null)` 은 `INVALID_CHOICE` → 프로필 저장 · 명단 → 경마 베팅 → 출발 시각을 앞당겨 `race_settle` 두 번 + `race_settle_due` 한 번: 우승 마권(×1.2) 24코인이 **한 번만** 지급. anon 키로 `profiles.coins` 를 직접 PATCH 하면 0행(RLS). `get_rules()` 는 anon 으로도 읽힌다. `npm run build` 통과, `check-theme` 저장소 전체 0건.
>
> **아직 안 한 것 · P3 이후로**
> - 브라우저 화면 확인(로그인 · 각 게임 화면)은 아직이다 — 위 확인은 API 수준이다.
> - 플레이어 번호 `#0001` 은 여전히 아이디 해시로 계산한다(DB 발급 순번 컬럼은 미도입).
> - DB 식별자 상당수는 원본 이름을 유지한다: `hp*`(=에너지) · `ward*`(=휴식) · `cell*`(=룸) · `petition*`(=피드백) · 장소 코드(`cell/mess/shower/works/infirm`) · 미션 코드. 콘셉트 단어는 아니라서 남겼고, 용어표를 docs 에 둘 예정.
> - `relations.kind`(이제 'user' 하나) · `expires_at` 컬럼은 남아 있다.
> - 하이로우 · 키노 입력 검증 정규식(1~40, 5개)은 `app.keno_range()` 를 쓰지 않고 숫자가 박혀 있다.


### P3. 대형 파일 분할과 규칙 일원화 (2\~3일)

- [x] `Record.tsx`(2435줄)는 `profile/` 하위로, `AdminPanel.tsx`(2583줄)는 탭별로, `Casino.tsx`(979줄)는 셸·탭·베팅으로 분할한다. 목표는 파일당 600줄 이하.
- [x] 동작은 바꾸지 않는다. 분할 전후로 화면이 같은지 확인한다.

완료 기준: 600줄을 넘는 파일 없음, build·lint 통과.
> P3 결과(2026-11-10)
>
> **방법.** 줄 범위를 그대로 옮기는 기계적 분할만 했다(로직 · 문구 · 클래스 변경 없음). 상태가 얽힌 두 화면(프로필 · 관리자)은 "상태 훅 + 표현 컴포넌트" 구조로 나눴다: 기능별 훅을 모델 훅 하나가 조립하고(`useRecordModel` · `useAdminModel`), 탭 · 섹션 · 팝업 컴포넌트는 모델 `m` 에서 필요한 값만 구조 분해해 쓴다. 기존 `import ... from "@/lib/game"` 경로는 `game.ts` 가 새 모듈을 다시 내보내므로 그대로 동작한다.
>
> **결과** (src 최대 파일 `Casino.tsx` 593줄)
> - `Record.tsx` 2019 → 79: `profile/` — 훅 `useRecordModel` · `useAvatar` · `useDetails` · `useRelations` · `useCatGifts`, 탭 `ProfileTab` · `ItemsTab` · `RosterTab` · `HistoryTab`, 팝업 `RelationPopups` · `ConfirmPopup` · `AvatarPopups` · `DetailsPopup`, `ProfileCard`, `shared.ts`(타입 · 탭 목록 · 버튼 클래스 · 기록 줄 도우미).
> - `AdminPanel.tsx` 2574 → 45: `admin/` — 훅 `useAdminModel` · `useAdminCore`(목록 · 상세 · 발급/삭제 · 지급/회수 · 정지, 공용 busy/error/notice) · `usePetitionAdmin` · `useRelationAdmin` · `useTradeAdmin`, 섹션 10개(화면 순서 그대로), `ui.tsx`(FIELD · PRIMARY · PLAIN · SMALL · DANGER, ReasonPicker · Stat · Offer 등).
> - `Casino.tsx` 935 → 593: `hooks/usePlayActions`(판 열기 · 하이로우 · 정산 반영), `hooks/useItemActions`(쓰기 · 착용 · 굽기 · 섞기 · 사고팔기 · 사진, 확인/결과 팝업 상태), `casino/CasualTab`.
> - `Exchange.tsx` 843 → 447: `exchange/parts`(Picker · Stepper · OfferLine · HandLabel · 버튼 클래스 · toPayload), `exchange/TradeCard`(거래 기록 한 건). 되보내기 작성 상태는 상위에 남겨 한 번에 한 건만 열리는 동작을 유지했다.
> - `game.ts` 1211 → 472: `items.ts` · `types.ts` · `errors.ts`. `copy.ts` 712 → 461: `copy-cat.ts`(고양이 문구) · `josa.ts`(조사 도우미).
>
> **확인한 것.** `npx tsc --noEmit`(추가로 `--noUnusedLocals` 도 0건), `npm run build`, `check-theme` 0건. 브라우저(로컬 스택, demo01 · admin): 프로필 4탭 · 프로필 수정 · 친구 등록 팝업 · 플레이어 목록, Casual 룰렛 1판(코인 114 → 113, 결과 줄), 상점 구매 확인 → 구매, 개인 거래 걸기 → 물리기(TradeCard), 소지품 판매 되묻기 · 사용 결과 팝업, 일일 미션 · 탐험 · Arena, 관리자 전 섹션 · 플레이어 상세 · 정지 팝업. 콘솔 · 서버 오류 0건.
>
> **lint.** `next lint` 는 설정이 없어 대화형으로 멈추므로 P4에서 ESLint flat config 를 들일 때 함께 통과시킨다.

### P4. 테스트와 CI (3일)

- [x] Vitest: 룰렛 색/숫자 하우스 엣지 2.00%, 슬롯·하이로우 배당 기대값, 키노 RTP 약 0.98.
- [x] Vitest 또는 SQL 시뮬레이션: 경마 배당의 기대값이 `1 − 공제율(0.20)`에 수렴하는지.
- [x] pgTAP(`supabase test db`): anon이 코인·판 수를 직접 수정할 수 없음, 마감 전 경주 결과 비노출, 정산을 두 번 호출해도 지급은 한 번, `highlow_continue(null)`은 `INVALID_CHOICE`(회귀), 거래 이중 지출 불가 — **확인함**: 제안은 코인을 묶지 않고, 성사(`app.exec_trade`) 때 거래 행과 두 사람의 profiles 행을 id 순으로 `for update` 잠근 뒤 잔액을 다시 본다.
- [x] Playwright E2E 1개: 로그인 → 경마 베팅 → 결과 확인.
- [x] GitHub Actions: lint, typecheck, build, check-theme, vitest, `supabase test db`.

완료 기준: CI 전부 통과.
> P4 결과(2026-11-10)
>
> **나눈 기준.** 확률 · 권한 · 정산은 서버 함수가 정본이라 **pgTAP 에서 그 함수를 직접** 계산한다(픽스처 불필요). 클라이언트 쪽은 화면 계산이 서버와 같은지를 **Vitest** 로 보고, 비교 기준값은 서버에서 뽑은 픽스처(`tests/fixtures/rules.json` = `get_rules()`, `hl_mult.json` = `app.hl_mult` 전체 117칸)를 쓴다. 픽스처가 서버와 어긋나면 CI 의 `node scripts/fixtures.mjs --check` 가 실패한다.
>
> **결과**
> - lint: ESLint 9 flat config(`eslint.config.mjs`, next/core-web-vitals + next/typescript), `npm run lint` = `eslint .` 0건. P3 분할로 훅 인자가 된 setter · ref 를 의존성 배열에 넣었다(모두 고정 참조라 동작 동일). 루트 레이아웃의 웹폰트 경고는 App Router 오탐이라 그 줄만 끈다.
> - Vitest 136건(`npm test`): 하이로우 배율 117칸이 서버와 같음 · 적립금 `hlNextPot` 판돈 1~300 전수 일치 · 단계별 기대값, 룰렛 2.00% · 슬롯 1.91%(21³ 전수), 조사 · 시간 표기, 오류 문구.
> - pgTAP 31건(`npx supabase test db`, `supabase/tests/`): 키노 RTP 0.98 · 3개 적중 1/28.5 · 5개 1/9,261, 경마 단승 · 연승 · 복승 기대값 ≈ 0.80(4,000경주 시뮬레이션, 시드 고정), 마감 전 `result` · 컨디션 비노출, races · race_days 직접 조회 0행, 정산 세 번 호출에 지급 · 기록 한 번, profiles · ledger 직접 수정 차단(authenticated · anon), `highlow_continue(null)` 회귀, `panel_*` NOT_ADMIN / AUTH_REQUIRED, 선물 이중 지출(TRADE_CLOSED · PARTNER_SHORT_COINS, 잔액 음수 없음).
> - Playwright 1건(`npm run test:e2e`): 준비 단계에서 SQL 로 몇 분 뒤 발주하는 경주를 편성 → demo01 로그인 → Arena · 경마장 → 단승 구매 → 발주 시각을 당기면 화면의 `race_card` 호출이 정산(lazy) → 실황 뒤 성적표 · 내 마권(적중/낙첨). 로컬은 설치된 Chrome(`PW_CHANNEL=chrome`), CI 는 Chromium.
> - CI(`.github/workflows/ci.yml`): `checks`(lint · typecheck · check-theme · vitest · build) + `db`(supabase start → test db → 픽스처 확인 → build → E2E). 2026-11-10 GitHub 비공개 저장소에 올린 첫 실행에서 두 작업 모두 통과(checks 1분 45초, db 4분 20초). 이어서 Node 20 지원 종료 경고에 맞춰 actions 를 v7(node24)로 올렸다.
>
> **테스트가 찾은 결함(수정함)**
> - `toKoreanError` 가 부분 문자열로 찾아서 `OPPONENT_IN_WARD` · `NOT_IN_WARD` 가 앞에 적힌 `IN_WARD` 문구("휴식 중에는 할 수 없습니다")로 잘못 나갔다 → 메시지 속 코드를 낱말 단위로 찾는다.
> - 서버가 던지는 코드 5개(`NEED_LIGHTER` · `INVALID_ACTION` · `NOT_A_PLAYER` · `CELLS_FULL` · `INVALID_REASON`)에 화면 문구가 없어 영문 코드가 그대로 보였다 → 추가. 이후 새 코드가 생기면 Vitest 가 잡는다.
> - 그 밖에: 관리자 목록 안내의 비밀번호 문장을 실제(해시만 저장, 발급 때 한 번 표시)에 맞췄고, `RACE_BET_LOW` 문구에 박혀 있던 "20코인"을 뺐다(규칙 값은 서버가 정본).

### P5. 데모와 시연 자료 (1\~2일)

- [x] 게스트 체험(임시 계정). ~~`guest_login` RPC + cron 코인 초기화~~ → **변경(2026-11-11)**: SQL 함수는 인증 세션을 만들 수 없으므로 Supabase **익명 로그인**(`signInAnonymously`)을 쓴다. 아이디는 클라이언트가 아니라 `auth.users` BEFORE INSERT 트리거가 `guest` + 숫자 6자리로 발급하고, 게스트 계정은 24시간 뒤 cron 이 계정째 지운다(그래서 코인 초기화가 따로 필요 없다). 스위치는 DB `app.guest_open()` + Auth 의 Anonymous sign-ins 설정 두 곳.
- [ ] 데모용 별도 Supabase 프로젝트와 Vercel 배포, 환경변수 문서화. — 문서화는 끝(`docs/deploy.md`). 프로젝트 생성 · 배포는 저장소 주인이 직접 해야 한다.
- [x] 경주 중계 GIF와 스크린샷.

완료 기준: 데모 URL에서 로그인 없이 체험해 경마 1경주를 끝까지 볼 수 있다.
> P5 결과(2026-11-11) — **완료 기준 중 "데모 URL"만 남았다**(배포는 사용자 몫). 같은 흐름은 로컬 E2E 로 확인했다.
>
> - 게스트: 새 마이그레이션 `20261111003000_guest.sql` — `app.guest_before_insert`(익명 사용자의 아이디를 서버가 `guest######` 로 덮어씀, 클라이언트가 보낸 이름은 무시), `public.guest_status()`(로그인 화면 버튼 · 게스트 안내용), `app.guest_cleanup()` + cron `guest-cleanup`(매시 17분, 24시간 지난 익명 계정 삭제 — FK 로 기록까지), 게스트의 Storage 업로드를 막는 제한(restrictive) 정책. 기존 함수는 하나도 다시 정의하지 않았다. 로컬 `config.toml` 에서 익명 로그인을 켰다.
> - 화면: 로그인 화면에 **로그인 없이 체험하기**(서버가 열어 둔 경우에만), 게스트에게 지워지는 시각(KST) 안내 줄.
> - 검증: pgTAP `04_guest.sql` 10건(아이디 발급 · admin 이름 무시 · 업로드 차단 · 기한 삭제), Playwright 에 "게스트: 로그인 없이 체험 → 경마 1경주를 끝까지" 추가(2건 통과). 브라우저로 게스트 입장 · 안내 팝업 확인.
> - 시연 자료: `docs/media/` — login · casual-roulette · race-card · race-result(PNG), race-replay.gif(실황 중계 약 25초). `playwright.capture.config.ts` 로 다시 만든다(ffmpeg 없이 gifenc 로 인코딩).
> - 안내 그림: `public/guide/*.svg` placeholder 를 직접 그린 장소 안내도 · 하루 일정표로 바꿨다(문단의 장소 · 시각 그대로).
> - 배포 문서: `docs/deploy.md` — 새 Supabase 프로젝트, `db push --remote=URL --include-seed`(값 없는 `--remote` 는 링크된 운영 원본을 가리키므로 금지), 공개된 seed 관리자 비밀번호 즉시 변경, 익명 로그인 켜기, Vercel 환경 변수 두 개.

### P6. 문서화와 공개 (2\~3일)

- [ ] README: 소개, 스크린샷, 아키텍처 다이어그램(mermaid), `supabase start` 기준 로컬 실행법.
- [ ] `docs/ops-log.md`: `_private/repair`에서 테마와 무관한 10\~15건을 날짜·문제·원인·수정·확인 방법 표로 정리.
- [ ] `docs/case-studies/`: 6절의 케이스 스터디 4\~6편.
- [ ] 공개 전 최종 점검: gitleaks, check-theme, 이미지 출처, 고지 문구.

완료 기준: 저장소를 공개로 전환.

## 9. Claude Code 사용법

새 저장소 루트에 아래 `CLAUDE.md`를 두고, 이 문서를 `docs/PLAN.md`로 내보내 둔다. 원본이 필요하면 새 저장소와 같은 상위 폴더에 `mini-casino`를 클론해 두고 읽기 전용으로 참조한다(필요하면 `--add-dir ../mini-casino`).

### CLAUDE.md 초안

```markdown
# Paddock

실시간 멀티플레이 가상 코인 게임 플랫폼 (Next.js App Router + TypeScript + Tailwind + Supabase + Vercel).
모든 난수·판정·정산은 Postgres 함수에서 처리하고 클라이언트는 신뢰하지 않는다.
가상 코인이며 현금 가치가 없다.

## 기준 문서
- 계획과 단계별 완료 기준: docs/PLAN.md (7~8절). 결정이 바뀌면 PLAN.md를 먼저 고친다.
- 원본: ../mini-casino (읽기 전용, 절대 수정하지 않는다)

## 작업 규칙
- 단계(P0~P6)는 하나씩 진행하고, 완료 기준을 통과하면 "P1: 용어 중립화"처럼 단계 이름으로 커밋한다.
- 콘셉트 잔재(병동, 가축, 배급소, 밀거래, 수감, 죄수, 교정, 무간, 흑색구역, 백색구역, 진정함, 수용, 담배, 약물 등)를 코드·주석·SQL·이미지·문서 어디에도 남기지 않는다. scripts/check-theme.sh로 확인한다.
- 용어 매핑: 체력→에너지, 병동→휴식, 백색구역→Casual, 흑색구역→Arena, 배급소→상점, 작업장→일일 미션, 탐색→탐험, 수감기록→프로필, 진정함→피드백, 소식→친구 피드.
- 경마(22_horse_race)의 수치와 함수 시그니처는 바꾸지 않는다. 문구와 주석만 중립화한다.
- 함수 몸통은 마이그레이션 한 파일에만 둔다. 같은 함수가 두 곳에 보이면 버그다.
- 라이브 DB에 적용하는 변경은 새 마이그레이션 파일로만 추가한다. 기존 마이그레이션을 고치지 않는다.
- 규칙 상수는 서버의 get_rules()가 정본이다. 클라이언트에 같은 값을 따로 적지 않는다.
- 비밀키(service_role, sb_secret_*)와 .env는 절대 커밋하지 않는다.
- 출처를 알 수 없는 이미지·폰트는 쓰지 않는다.
- 확신이 없는 동작은 코드를 읽어 확인하고 PLAN.md의 (확인 필요) 항목에 결과를 기록한다.

## 명령
- npm run dev / build / lint / test
- supabase start / supabase db reset / supabase test db
- bash scripts/check-theme.sh
```

### 첫 프롬프트 예시

```text
docs/PLAN.md와 CLAUDE.md를 읽고 P0부터 시작해줘. 원본은 ../mini-casino에 있어.
P0의 체크리스트를 하나씩 처리하고, 완료 기준을 확인한 뒤 "P0: 안전 정리"로 커밋해줘.
끝나면 결과와 다음 단계(P1)에서 먼저 확인해야 할 점을 알려줘.
```

단계마다 새 세션에서 "PLAN.md의 P\<n>을 진행해줘"로 시작해도 된다. 진행 상황은 8절 체크리스트를 직접 체크해 두면 다음 세션이 이어받기 쉽다.

## 10. 다음 세션 인계

### 현재 상태 (2026-11-10)
- 저장소 `C:\Users\BR\paddock`, 브랜치 `main`, 원격 `origin` = GitHub `robam1108/paddock`(**비공개**, P6 직전에 공개 전환). push 하면 CI 가 돈다. 원본 `../mini-casino`는 읽기 전용.
- 저장소를 만들기 전 `gitleaks git .` 0건, 운영 원본 프로젝트 식별자 · `.env` 미추적, 커밋 작성자가 GitHub noreply 주소임을 확인했다.
- 로컬 DB: Docker Desktop + `npm run db:start` / `npm run db:reset`. 데모 `demo01~03 / paddock-demo`, 관리자 `admin / paddock-admin`(seed.sql, 로컬 전용).
- `.env.local`은 로컬 URL·publishable key(로컬 고정값)로 채워져 있다.
- Supabase CLI가 사용자 로그인으로 원격 프로젝트 `casino`(운영 원본)를 인식한다 → **`--remote`, `db push`, `link`를 절대 쓰지 않는다.**
- 화면 확인: 앱 미리보기(`.claude/launch.json` 의 `paddock`, `npm run dev -- -p 3005`)를 쓴다. 3005가 차 있으면 다음 빈 포트(예: 3006)로 뜬다. 원본 mini-casino 서버가 떠 있으면 포트를 확인한다.
- 한도 절약: 큰 파일은 통째로 읽지 말고 `grep -n`으로 위치를 찾은 뒤 필요한 범위만 읽는다.

### P3. 대형 파일 분할 — 완료 (8절 P3 결과 참고)
- 프로필 · 관리자 화면은 모델 훅(`useRecordModel` · `useAdminModel`)이 상태를 들고, 탭 · 섹션 컴포넌트가 `m` 에서 꺼내 쓴다. 새 상태는 해당 기능 훅에 넣고 모델이 펼쳐 내보낸다.

### P4. 테스트와 CI — 완료 (8절 P4 결과 참고)
- 명령: `npm run lint` · `npm run typecheck` · `npm test`(Vitest) · `npx supabase test db`(pgTAP) · `npm run test:e2e`(Playwright, 로컬은 `PW_CHANNEL=chrome` 을 붙이면 브라우저를 따로 받지 않는다) · `npm run fixtures`(서버 규칙 값이 바뀌면 픽스처 다시 뽑기).
- pgTAP 도우미 `tests.login(이름)` · `tests.as_anon()` · `tests.logout()` 은 `supabase/tests/00_helpers.sql` 에만 있고, 로컬 DB 의 `tests` 스키마에 남는다(`db reset` 하면 다음 `test db` 때 다시 만든다).
- E2E 는 로컬 DB 를 실제로 바꾼다(demo01 코인 · 에너지 보정, 경주 no=90 편성 후 삭제, 마권 · 기록 1건).
- CI 는 GitHub 에서 통과 확인(runner 는 psql 로, 로컬 Windows 는 DB 컨테이너 안의 psql 로 붙는다).

### P5. 데모와 시연 자료 — 배포만 남음 (8절 P5 결과 참고)
- 남은 일(사용자): `docs/deploy.md` 순서대로 새 Supabase 프로젝트 + Vercel 배포. `casino` 프로젝트는 쓰지 않는다. 배포 URL 이 생기면 게스트로 경마 1경주를 끝까지 보고 P5 를 닫는다.
- 로컬 Supabase 는 Docker Desktop 이 떠 있어야 한다(꺼져 있으면 `db start` 가 실패한다).
- 이번 마이그레이션(`20261111003000_guest.sql`)부터는 이미 커밋 · 푸시된 파일이므로, 고칠 일이 생기면 새 파일을 추가한다.

### P6. 문서화와 공개
- README(아키텍처 mermaid, 로컬 실행), `docs/ops-log.md`(`_private/repair`에서 콘셉트 무관 10~15건), `docs/case-studies/` 4~6편(6절 후보), 용어표(DB 식별자 `hp`=에너지, `ward`=휴식, `cell`=룸, `petition`=피드백, 장소·미션 코드).
- 공개 전 점검: gitleaks, check-theme, 이미지 출처, 고지 문구, `docs/PLAN.md`의 `윤태강` 등 원본 예시 문구 정리.
- GitHub 비공개 저장소 생성·푸시는 사용자 확인 후, 공개 전환은 마지막에.

### P2에서 넘어온 미해결 항목 (해당 단계에서 처리)
- 플레이어 번호 `#0001`이 아직 아이디 해시(`src/lib/identity.ts`) — DB 발급 순번 컬럼(새 마이그레이션) + `state_json`·`player_roster`에 노출 (P3 또는 P5).
- `relations.kind`(이제 'user'만)·`expires_at` 컬럼 정리 (새 마이그레이션).
- 키노·룰렛 입력 검증 정규식에 숫자 하드코딩(`play_game`) — `app.keno_range()` 등으로 (새 마이그레이션).
- 관리자 화면은 브라우저로 아직 열어 보지 않았다(발급 → 초기 비밀번호 1회 표시, 아이디 재입력 삭제).
- 마이그레이션 변경 규칙: 이제부터는 기존 `2026111100*.sql`을 고치지 말고 새 파일을 추가한다(CLAUDE.md). 단 아직 어디에도 배포 전이라, 대규모 정리가 필요하면 사용자에게 먼저 물어 기존 파일 수정 허용 여부를 정한다.

### 새 세션 첫 프롬프트 예시
```
CLAUDE.md와 docs/PLAN.md(8~10절)를 읽고 P3를 진행해줘. 큰 파일은 grep으로 위치를 찾고 필요한 부분만 읽어.
```

