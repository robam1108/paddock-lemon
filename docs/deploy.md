# 데모 배포 — 새 Supabase 프로젝트 + Vercel

공개 데모는 **새로 만든 Supabase 프로젝트**에 붙인다. 원본 운영 프로젝트는 절대 쓰지 않는다.
계정 만들기 · 로그인 · 키 입력은 저장소 주인이 직접 한다(아래 순서대로 하면 30분 안팎).

> 데모도 가상 코인 전용이다. 현금 가치가 없고 환전할 수 없다.

## 1. Supabase 프로젝트 만들기

1. Supabase 대시보드에서 **New project**. 지역은 서울(`ap-northeast-2`)을 권장한다(Vercel 지역 `sin1` 과 가깝다).
2. **Database password** 는 비밀번호 관리자에 보관한다. 이 저장소 어디에도 적지 않는다.
3. 만든 뒤 **Project Settings → Database → Connection string → URI**(Session pooler)를 복사해 둔다.
   이하 `$DEMO_DB_URL` 로 부른다. 셸에만 넣고 파일로 저장하지 않는다.

## 2. 스키마와 기본 데이터 넣기

CLI 가 다른 프로젝트(운영 원본)에 링크돼 있을 수 있으므로 **`supabase link` 를 쓰지 않고**, 대상을 URL 로 매번 직접 지정한다.
**값 없는 `--remote` 는 링크된 프로젝트를 가리킨다 — 반드시 `--remote=URL` 꼴로 쓴다.**

```bash
# 마이그레이션 11개 + seed(경주마 20두 · 아이템 카탈로그 · 데모 계정)
npx supabase db push --remote="$DEMO_DB_URL" --include-seed
```

seed 의 `admin / paddock-admin` 은 공개 저장소에 적힌 값이다. **넣자마자 바꾼다** — 대시보드 **SQL Editor** 에서:

```sql
-- 관리자 비밀번호를 새 값으로(따옴표 안을 직접 정한 값으로 바꾼다)
update auth.users
   set encrypted_password = extensions.crypt('여기에-새-비밀번호', extensions.gen_salt('bf'))
 where email = 'admin@paddock.local';
```

`demo01 ~ demo03 / paddock-demo` 는 일부러 공개한 체험용 계정이라 그대로 둬도 된다(누구나 같은 계정을 쓴다는 점만 알고 둔다).

## 3. Auth · 예약 작업 설정

| 위치 | 설정 |
| --- | --- |
| Authentication → Sign In / Providers | **Allow anonymous sign-ins** 켬(게스트 체험). Email 가입(Allow new users to sign up)은 끔 — 계정은 관리자가 발급한다. |
| Authentication → Rate Limits | 익명 로그인 시간당 한도(기본 30/IP)를 확인한다. |
| Database → Cron | `race-settle`(10:00 · 22:00 KST 정산), `guest-cleanup`(매시 17분, 24시간 지난 게스트 삭제)이 보이면 정상이다. 마이그레이션이 등록한다. |

게스트 체험을 닫으려면 Auth 의 Anonymous sign-ins 를 끄거나, 새 마이그레이션으로 `app.guest_open()` 이 `false` 를 돌려주게 한다.

## 4. Vercel

1. Vercel 에서 **Add New → Project → GitHub 저장소 `paddock`** 를 고른다(Framework: Next.js 자동 인식).
2. Environment Variables(Production · Preview 모두):

   | 이름 | 값 |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Project Settings → API** 의 Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 같은 화면의 **Publishable key**(`sb_publishable_…`) |

   **Secret key(`sb_secret_…`) · service_role 키는 절대 넣지 않는다** — `NEXT_PUBLIC_` 값은 브라우저로 그대로 나간다.
3. Deploy. 지역은 `vercel.json` 의 `sin1`.

## 5. 확인

1. 배포 URL 의 `/login` 에 **로그인 없이 체험하기** 버튼이 보인다.
2. 눌러서 들어가면 머리줄 위에 "게스트 체험 중" 안내와 `guest######` 아이디가 보인다.
3. 아레나 → 경마장 → 다음 경주에 단승 한 장(50코인 이하, 게스트 시작 코인 50).
   정식 경주는 하루 두 번(10:00 · 22:00 KST)이라 시연 직전에 바로 보려면 관리자 계정의 **경마장 사전 확인**(테스트 경주, 코인이 움직이지 않음)을 쓴다.
4. 무료 플랜 프로젝트는 오래 접속이 없으면 일시정지될 수 있다. 면접 · 지원 전에 대시보드에서 깨워 둔다.

## 로컬에서 같은 흐름 보기

```bash
npm run db:start      # config.toml 에서 익명 로그인이 켜져 있다
npm run dev           # http://localhost:3000/login → 로그인 없이 체험하기
```

시연 자료(스크린샷 · 경주 GIF)는 `PW_CHANNEL=chrome npx playwright test -c playwright.capture.config.ts` 로 `docs/media/` 에 다시 만든다.
