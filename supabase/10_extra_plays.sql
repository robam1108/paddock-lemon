-- 약물 아이템의 게임 횟수 회복이 식량·의약품과 별개 상한(6)을 써서
-- 하루 최대 판수가 20(daily_play_limit) + 8(max_bonus_plays) + 6(max_drug_plays)
-- = 34판까지 늘어나던 것을, 의도한 28판(20 + 8)으로 맞추는 패치.
--
-- 방식: 식량·의약품·약물이 하루 총량 app.max_extra_plays() = 8 을 공유하게
-- 한다. 갈래별 하위 상한(max_bonus_plays=8, max_drug_plays=6)은 그대로 두고,
-- 그 위에 총량 상한을 하나 더 건다 — 약물만으로는 여전히 최대 6까지 채울 수
-- 있지만, 식량·의약품과 합쳐 8을 넘기지는 못한다.
--
-- 라이브 DB 에는 02_schema.sql 전체를 다시 돌리지 말고 이 파일만 실행한다.
-- 테이블 구조·데이터를 건드리지 않는 함수 정의 3개(app.max_extra_plays 신설,
-- app.state_json·public.use_item 갱신)뿐이라 락도 다운타임도 없다.
-- (내용은 02_schema.sql 에 이미 반영되어 있다. 적용 후 이 파일은 지워도 된다.)
--
-- 무해성: 이미 배정된 profiles.bonus_plays/drug_plays 는 이 패치가 손대지
-- 않는다. 패치 시점에 이미 34판을 배정받은 유저는 오늘은 그 34판을 그대로
-- 쓴다 — 이 패치는 "추가로 더 주는 것"만 8로 조인다. 자정(KST) 리셋 이후부터
-- 자연히 최대 28판으로 맞춰진다.
--
-- 배포 순서: 이 SQL 먼저 → 클라이언트 나중. (game.ts 의 extra_plays/extra_max/
-- extra_left 매핑은 값이 없을 때 bonus_plays+drug_plays/bonus_max/bonus_left 로
-- 대체하도록 짜여 있어 반대 순서로 배포해도 깨지지는 않지만, 상한 자체는 SQL
-- 이 먼저 올라가야 바로 적용된다.)
--
-- 롤백: app.max_extra_plays() 를 999 로 create or replace 하면 즉시 예전
-- 동작(사실상 무제한 총량, 하위 상한 8/6만 적용)으로 돌아간다. state_json/
-- use_item 본문을 되돌릴 필요는 없다.

begin;

-- 식량·의약품·약물을 합쳐 하루에 되살릴 수 있는 게임 횟수의 총량.
-- daily_play_limit() 20 + 이 값 8 = 하루 최대 28판.
-- max_bonus_plays()/max_drug_plays() 는 갈래별 하위 상한으로 남는다.
create or replace function app.max_extra_plays() returns integer
  language sql immutable as $$ select 8 $$;

-- app.state_json 의 정본은 16_steal_trick.sql 이다(02_schema.sql 에 같은 본문의
-- 사본이 있고, 02 는 맨 앞에서 돌아 되감기지 않는다). 여기 있던 옛 사본에는
-- steal_sure·훔친 문구·stolen_qty 가 없어서, 이 파일만 단독으로 다시 돌리면
-- 그것들이 화면에서 조용히 사라졌다 — 그래서 지웠다.

-- public.use_item 의 정본은 16_steal_trick.sql 이다(02_schema.sql 에 같은 본문의
-- 사본이 있고, 02 는 맨 앞에서 돌아 되감기지 않는다). 여기 있던 옛 사본은 절도비법
-- 을 아직 use_item 으로 소모하던 시절의 본문이라, 이 파일만 단독으로 다시 돌리면
-- 장착형 전환이 조용히 되감겼다 — 그래서 지웠다. 이 파일이 정한 하루 총량
-- (app.max_extra_plays)은 위에 그대로 있고, 정본 use_item 이 그것을 읽는다.
-- 권한은 02_schema.sql 이 건다. APPLY.md "함수 몸통은 한 파일에만 둔다" 참고.

commit;
