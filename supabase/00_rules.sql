-- =============================================================
--  00. 규칙 상수 — ★ 값을 바꾸려면 여기만 고쳐 다시 실행한다
--
--  판수·지급 코인·체력·병동 시간·배당 상한·일당·동시 장착 수·숨김 계정 이름이
--  여기 있다. 전부 immutable 함수라서, 고쳐서 이 파일만 다시 돌리면 그 순간
--  규칙이 바뀐다 — 테이블도 데이터도 건드리지 않는다.
--
--  02_schema.sql 의 최상위 문장(app.hidden_name() · app.cell_week_kst() 등)이
--  이 함수들을 쓰므로 반드시 먼저 실행돼야 한다. 그래서 번호가 00 이다.
--
--  표시용 값은 src/lib/game.ts 의 PLAY_LIMIT · PLAY_WAGE · ROULETTE_* ·
--  SLOT_PAIR_MULT · HL_EDGE · HL_MAX_MULT 에도 같이 반영해야 한다.
--  (특선 도시락 스위치만 따로 01_special_meal.sql 에 있다)
-- =============================================================

-- -------------------------------------------------------------
-- 0. 규칙 상수
--    값을 바꾸고 다시 실행하면 규칙이 바뀝니다.
-- -------------------------------------------------------------
create schema if not exists app;

create or replace function app.daily_play_limit() returns integer
  language sql immutable as $$ select 20 $$;

-- 계정을 처음 만들 때 주는 코인. 첫 판을 돌릴 밑천이다. 발급 시 지급은 이 코인이 전부이고,
-- 도시락은 배급 시각(app.meal_times())이 되어야 받는다.
create or replace function app.initial_coins() returns integer
  language sql immutable as $$ select 20 $$;

-- 하루의 기준 시각: 한국 시간(KST) 자정
create or replace function app.today_kst() returns date
  language sql stable as $$ select (timezone('Asia/Seoul', now()))::date $$;

/* ---------------- 체력 ---------------- */
create or replace function app.hp_max() returns integer
  language sql immutable as $$ select 100 $$;

-- 현실 2시간마다 깎이는 체력 (하루 -36). 클라이언트에 소수점이 보이지 않도록
-- 시간당이 아니라 블록(2시간) 단위로 깎는다.
create or replace function app.hp_decay_block_hours() returns integer
  language sql immutable as $$ select 2 $$;

create or replace function app.hp_decay_per_block() returns integer
  language sql immutable as $$ select 3 $$;

-- 게임 한 판당 소모 체력
create or replace function app.hp_per_play() returns integer
  language sql immutable as $$ select 1 $$;

-- 체력이 0이 되면 병동에 머무는 시간(사다리의 꼭대기). '퇴원서'의 ward_cut 기준값이기도 하다.
create or replace function app.ward_hours() returns integer
  language sql immutable as $$ select 48 $$;

-- 이번 입원의 수용 시간. p_visits 는 "지금까지 다녀온 횟수"(첫 입원이면 0).
-- 입원할수록 14 -> 18 -> 24 -> 36 -> 48시간으로 늘어나고 48시간에서 멈춘다.
create or replace function app.ward_hours(p_visits integer) returns integer
  language sql immutable as $$
    select (array[14, 18, 24, 36, 48])[least(greatest(coalesce(p_visits, 0), 0), 4) + 1]
  $$;

-- 퇴원 후 이 시간 동안 다시 입원하지 않으면 사다리가 첫 칸(14시간)으로 돌아간다.
create or replace function app.ward_reset_hours() returns integer
  language sql immutable as $$ select 72 $$;

-- 퇴원할 때 회복되는 체력
create or replace function app.discharge_hp() returns integer
  language sql immutable as $$ select 80 $$;

create or replace function app.hp_status(p_hp integer) returns text
  language sql immutable as $$
    select case
             when p_hp <= 0  then '병동'
             when p_hp <= 10 then '위독'
             when p_hp <= 30 then '쇠약'
             when p_hp <= 50 then '피로'
             else '정상'
           end;
  $$;

/* ---------------- 식사 지급 ---------------- */
-- 매일 이 시각(KST)에 도시락이 지급된다.
create or replace function app.meal_times() returns time[]
  language sql immutable as $$ select array['08:00', '12:00', '19:00']::time[] $$;

create or replace function app.meal_item() returns text
  language sql immutable as $$ select 'lunchbox' $$;

-- 도시락은 배급 시각에만 지급한다. 계정 발급 시에는 주지 않는다.
drop function if exists app.initial_meals();

-- 아이템으로 되살릴 수 있는 하루 게임 횟수의 상한.
-- 어떤 아이템을 몇 개 쓰든 하루에 이만큼까지만 늘어난다.
create or replace function app.max_bonus_plays() returns integer
  language sql immutable as $$ select 8 $$;

-- 오래 접속하지 않았을 때 몰아서 지급되는 양의 상한(일 단위).
-- 이게 없으면 한 달 만에 돌아온 사람이 도시락 90개를 받는다.
create or replace function app.meal_backfill_days() returns integer
  language sql immutable as $$ select 3 $$;

/* ---------------- 약물 ----------------
   식량·의약품의 max_bonus_plays() 와는 별개의 하위 상한을 쓴다. 다만 둘 다
   결국 app.max_extra_plays() 라는 하루 총량을 공유한다 — 약물이 이 총량을
   넘겨서까지 게임 횟수를 늘릴 수는 없다. */
create or replace function app.max_drug_plays() returns integer
  language sql immutable as $$ select 6 $$;

-- 식량·의약품·약물을 합쳐 하루에 되살릴 수 있는 게임 횟수의 총량.
-- daily_play_limit() 20 + 이 값 8 = 하루 최대 28판.
-- max_bonus_plays()/max_drug_plays() 는 갈래별 하위 상한으로 남는다.
create or replace function app.max_extra_plays() returns integer
  language sql immutable as $$ select 8 $$;

-- 이 이상 쌓이면 중독이다. profiles.drug_load 는 해독제로만 0 이 된다.
create or replace function app.drug_addict_threshold() returns integer
  language sql immutable as $$ select 8 $$;

-- 약물 값이 몇 번째 구매까지 오르는지. 5 면 기본가의 1.8배에서 멈춘다.
create or replace function app.drug_price_max_steps() returns integer
  language sql immutable as $$ select 5 $$;

-- 밀거래 표시가 = 기본가 * (1 + 0.16 * 그 약물의 누적 구매 횟수). 같은 약물을 살
-- 때마다 그 약물만 오르고(public.drug_purchases — 러시를 사도 블러드는 그대로),
-- 해독제로도 지워지지 않는다(장부는 남는다 — 두 번째 사이클은 처음보다 비싸다).
-- 횟수는 app.drug_price_max_steps() 까지만 센다 — 그 뒤로는 값이 그대로다.
create or replace function app.drug_price(p_base integer, p_bought integer) returns integer
  language sql immutable as $$
    select greatest(1, round(p_base * (1 + 0.16 * least(p_bought, app.drug_price_max_steps()))))::int
  $$;

-- 중독 상태의 체력 자연 감소 가산분 (블록당). 하루 -36 -> -48.
create or replace function app.addict_hp_penalty() returns integer
  language sql immutable as $$ select 1 $$;

-- 중독인 채로 마지막 투약(profiles.drug_used_at)에서 이 시간이 지나면 금단이다.
-- 다시 쓰거나 해독제를 먹으면 풀린다(app.in_withdrawal).
create or replace function app.withdrawal_hours() returns integer
  language sql immutable as $$ select 12 $$;

-- 금단은 특이사항 문구만 붙는다 — 체력 감소는 중독분(블록당 +1)에서 더 늘지 않는다.
drop function if exists app.withdrawal_hp_penalty();

/* ---------------- 과시 ---------------- */
-- 동시에 장착(item_defs.flex_kind = 'wear')할 수 있는 개수.
-- 라이터·반지·시계·절도비법이 이 칸을 나눠 쓴다(public.flex_equip 의 FLEX_LIMIT).
-- 같은 물건을 여러 개 장착하면(player_flex.stack) 그 수만큼 칸을 차지한다.
-- 소모형(consume) 과시의 동시 제한은 아래 app.flex_consume_limit 이 따로 쥔다.
create or replace function app.flex_wear_limit() returns integer
  language sql immutable as $$ select 10 $$;

-- 동시에 켜 둘 수 있는 소모형(item_defs.flex_kind = 'consume') 과시 상태 수.
-- 담배·술·향수·라디오·운동기구가 이 칸을 나눠 쓴다(app.flex_apply). 칸이 차
-- 있을 때 새로 쓰면 가장 오래된 것이 밀려난다.
create or replace function app.flex_consume_limit() returns integer
  language sql immutable as $$ select 10 $$;

/* ---------------- 키노 ---------------- */
-- 1~40 에서 10개를 뽑을 때 고른 5개가 전부 들어올 자연 확률의 역수.
-- C(35,5)/C(40,10) = 324632/847660528 = 1/2611.14 이다.
-- 고르기 5개·뽑기 10개를 바꾸면 이 값도 다시 계산해야 한다.
create or replace function app.keno_five_natural_one_in() returns numeric
  language sql immutable as $$ select 2611.14 $$;

-- 5개 적중을 평균 몇 판에 한 번 내줄지. 슬롯 다이아 트리플(21³ = 9,261판에
-- 한 번)에 맞췄다 — 두 게임의 최고 배당이 같은 희소함을 갖도록.
-- 빈도를 바꾸려면 이 값 하나만 고친다.
create or replace function app.keno_five_one_in() returns numeric
  language sql immutable as $$ select 9261 $$;

-- 4개 적중의 자연 확률의 역수. C(40,10)/(5·C(35,6)) = 847660528/8115800 = 104.45.
create or replace function app.keno_four_natural_one_in() returns numeric
  language sql immutable as $$ select 104.45 $$;

-- 4개 적중(×30)을 평균 몇 판에 한 번 내줄지. 그대로면 104판에 한 번이라 너무
-- 잦다 — 5개 적중 확률의 2배(9,261/2 ≒ 4,630판에 한 번)로 맞췄다(2026-10-02).
-- 빈도를 바꾸려면 이 값 하나만 고친다.
create or replace function app.keno_four_one_in() returns numeric
  language sql immutable as $$ select 4630 $$;

-- 3개 적중의 자연 확률의 역수. C(40,10)/(10·C(35,7)) = 847660528/67245200 = 12.6055.
create or replace function app.keno_three_natural_one_in() returns numeric
  language sql immutable as $$ select 12.6055 $$;

-- 3개 적중(×15)을 평균 몇 판에 한 번 내줄지. 1/15(룰렛 초록과 같은 급, 2026-10-06)
-- 로는 3개 적중 하나만으로 RTP 가 1.0 이라 키노 전체가 약 1.44 였다. 배당은 그대로
-- 두고 1/28.5 로 낮춰 RTP ≈ 0.980(하우스 엣지 ≈ 2% — 룰렛·슬롯·하이로우와 같은
-- 급)에 맞췄다(2026-10-07). 빈도를 바꾸려면 이 값 하나만 고친다.
create or replace function app.keno_three_one_in() returns numeric
  language sql immutable as $$ select 28.5 $$;

-- 3·4·5개를 재추첨하면 남는 판이 0~2개 쪽으로 늘어, 목표/자연 비율만 쓰면 실효
-- 빈도가 목표보다 잦아진다. 이 보정값(≒0.9441)을 곱하면 재추첨 후의 빈도가
-- one_in 값과 정확히 같아진다.
--   Z = (1 − 1/n3 − 1/n4 − 1/n5) / (1 − 1/T3 − 1/T4 − 1/T5)   (n = 자연, T = 목표)
create or replace function app.keno_reroll_norm() returns numeric
  language sql immutable as $$
    select (1 - 1 / app.keno_three_natural_one_in() - 1 / app.keno_four_natural_one_in()
              - 1 / app.keno_five_natural_one_in())
         / (1 - 1 / app.keno_three_one_in()         - 1 / app.keno_four_one_in()
              - 1 / app.keno_five_one_in());
  $$;

-- 다 맞힌 판 중 그대로 인정할 비율 = 2611.14/9261 × Z ≒ 0.2662.
-- 나머지는 판 전체를 다시 뽑는다(public.play_game 키노 절). 재추첨이라 0~2개
-- 적중은 서로의 비율이 그대로다 — 버려진 몫이 특정 구간으로 쏠리지 않는다.
-- 목표가 자연 확률보다 잦으면(one_in 이 더 작으면) 전부 인정한다.
create or replace function app.keno_five_keep() returns numeric
  language sql immutable as $$
    select least(1, app.keno_five_natural_one_in() / app.keno_five_one_in()
                    * app.keno_reroll_norm());
  $$;

-- 4개 적중 판 중 그대로 인정할 비율 = 104.45/4630 × Z ≒ 0.0213.
create or replace function app.keno_four_keep() returns numeric
  language sql immutable as $$
    select least(1, app.keno_four_natural_one_in() / app.keno_four_one_in()
                    * app.keno_reroll_norm());
  $$;

-- 3개 적중 판 중 그대로 인정할 비율 = 12.6055/28.5 × Z ≒ 0.4176.
create or replace function app.keno_three_keep() returns numeric
  language sql immutable as $$
    select least(1, app.keno_three_natural_one_in() / app.keno_three_one_in()
                    * app.keno_reroll_norm());
  $$;

/* ---------------- 추석 송편 (한정 이벤트) ----------------
   저녁 배급 시각에 송편 쿠폰이 한 장 나오고, 소지품에서 쿠폰을 쓰면 송편 하나를
   뽑는다(한 번 더 뽑기 1회). 뽑은 송편을 먹으면 이 날까지 등급별 효과가 붙는다.
   끝나는 시각이 지나면 아래 함수들이 전부 0 을 돌려주므로 효과는 따로 끄지 않아도
   사라진다. 이벤트 전용 RPC 는 20_chuseok.sql 에 있다.
   app.state_json(language sql)이 이 함수들을 부르므로 여기(00)에 있어야 한다. */

-- 효과가 끝나는 시각. 9월 26일(KST)까지 = 9월 27일 0시 직전까지.
create or replace function app.chuseok_end() returns timestamptz
  language sql immutable as $$ select '2026-09-27 00:00:00+09'::timestamptz $$;

-- 송편 쿠폰이 나가는 시각(9/24 저녁 배급). 이 시각 뒤 첫 정산(app.accrue)에서
-- 한 사람에 한 장 들어온다 — 도시락과 달리 병동·체력 0 이어도 받는다.
create or replace function app.chuseok_coupon_at() returns timestamptz
  language sql immutable as $$ select '2026-09-24 19:00:00+09'::timestamptz $$;

-- 뽑기 등급 분포: 고급 60 · 희귀 30 · 특급 10.
create or replace function app.chuseok_roll() returns text
  language sql volatile as $$
    select case when r < 0.6 then 'uncommon' when r < 0.9 then 'rare' else 'epic' end
      from (select random() as r) t
  $$;

-- 등급 -> 송편 품목 코드 (17_items.sql)
create or replace function app.chuseok_code(p_grade text) returns text
  language sql immutable as $$
    select case p_grade when 'uncommon' then 'songpyeon_white'
                        when 'rare'     then 'songpyeon_green'
                        when 'epic'     then 'songpyeon_pink' end
  $$;

-- 흰 송편(고급): 하루 게임 횟수 +5. 아이템 회복 총량(max_extra_plays)과 별개라 최대 33판.
create or replace function app.chuseok_plays(p_grade text) returns integer
  language sql stable as $$
    select case when p_grade = 'uncommon' and now() < app.chuseok_end() then 5 else 0 end
  $$;

-- 쑥 송편(희귀) · 분홍 송편(특급): 하루 첫 N판의 판돈에 시설이 얹어 주는 코인.
-- 지급은 (판돈 + 이 값) 기준, 코인은 판돈만큼만 빠진다.
create or replace function app.chuseok_stake(p_grade text) returns integer
  language sql immutable as $$
    select case p_grade when 'rare' then 15 when 'epic' then 30 else 0 end
  $$;

create or replace function app.chuseok_uses(p_grade text) returns integer
  language sql immutable as $$
    select case p_grade when 'rare' then 5 when 'epic' then 7 else 0 end
  $$;

-- 오늘 남은 판돈 추가 횟수. p_day 가 오늘이 아니면 오늘은 아직 안 쓴 것이다.
create or replace function app.chuseok_left(p_grade text, p_day date, p_used integer)
  returns integer language sql stable as $$
    select case when now() >= app.chuseok_end() then 0
                else greatest(0, app.chuseok_uses(p_grade)
                                 - case when p_day = app.today_kst() then coalesce(p_used, 0) else 0 end)
           end
  $$;

/* ---------------- 하이로우 · 상점 ----------------
   sql 함수는 만들 때 본문이 검사되므로, 아래 상수들은
   이들을 참조하는 app.state_json() 보다 먼저 정의되어야 한다. */
create or replace function app.hl_max_stage() returns integer
  language sql immutable as $$ select 3 $$;

drop function if exists app.hl_step_mult(integer);
drop function if exists app.hl_draw(integer);      -- 시그니처가 바뀌므로 replace 불가

-- 카드는 균등 추첨이다(쏠림 없음). 난이도 보정은 확률이 아니라 배율에서 한다 —
-- 어떤 카드가 나와도 하우스 엣지가 고정되도록.
create or replace function app.hl_draw() returns integer
  language sql volatile as $$ select 1 + floor(random() * 13)::int $$;

-- 단계가 오를수록 엣지를 깎아, 어떤 카드에서든 "계속 가는 쪽"이 회수보다
-- 유리하게 만든다. 1단계에서 바로 회수하면 0.950, 3단계까지 완주하면 0.980
-- (전체 하우스 엣지 2.04% — 룰렛 2.00%, 슬롯 1.91%와 정합).
create or replace function app.hl_edge(p_stage integer) returns numeric
  language sql immutable as $$
    select case p_stage when 1 then 0.05 when 2 then 0.00
                        when 3 then -0.03 else 1 end;
  $$;

-- 배율 상한. 적중 카드가 1장뿐인 선택(같다·양끝 카드 근처 하이/로우)이
-- 전부 이 상한을 받는다 — '같다'만 따로 깎으면 같은 확률의 다른 선택보다
-- 항상 불리해져 버린다.
create or replace function app.hl_max_mult() returns numeric
  language sql immutable as $$ select 8.00 $$;

-- 선택이 적중하는 카드 수 (13장 균등 기준)
create or replace function app.hl_win_cards(p_card integer, p_choice text)
  returns integer language sql immutable as $$
    select case p_choice when 'high' then 13 - p_card
                         when 'low'  then p_card - 1
                         else 1 end;
  $$;

-- 배율 = (1 - 단계엣지) / 적중률, 소수 2자리 반올림, 상한 적용.
-- game.ts 의 hlMult 와 반드시 같은 값이어야 한다 — 어긋나면 화면 적중률/배율이
-- 실제 지급과 달라진다.
create or replace function app.hl_mult(p_card integer, p_choice text, p_stage integer)
  returns numeric language sql immutable as $$
    select case when app.hl_win_cards(p_card, p_choice) <= 0 then 0
           else least(app.hl_max_mult(),
                round((1 - app.hl_edge(p_stage)) * 13
                      / app.hl_win_cards(p_card, p_choice), 2))
           end;
  $$;

create or replace function app.max_loan_amount() returns integer
  language sql immutable as $$ select 500 $$;

-- 흑색구역 1:1 대전의 최소 판돈. 이만큼 없으면 신청할 수 없다.
create or replace function app.pvp_min_bet() returns integer
  language sql immutable as $$ select 50 $$;

-- 백색구역 게임 1판마다 지급하는 일당. 판돈의 절반이 이보다 적으면 그만큼만 준다.
create or replace function app.play_wage() returns integer
  language sql immutable as $$ select 4 $$;

/* ---------------- 코인 구간별 보정 (화면에 드러내지 않는다) ----------------
   가진 코인에 따라 일당·구내작업·네잎클로버가 조용히 달라진다. 안내문·문구
   어디에도 이 구간을 적지 않는다. 기준선을 바꾸려면 여기 숫자만 고친다. */

-- 일당: 이 이상 가진 사람에게는 일당을 주지 않는다.
create or replace function app.wage_rich_line() returns integer
  language sql immutable as $$ select 800 $$;

-- 일당: 이보다 적게 가진 사람은 상한이 app.play_wage_poor() 로 오른다.
create or replace function app.wage_poor_line() returns integer
  language sql immutable as $$ select 100 $$;

create or replace function app.play_wage_poor() returns integer
  language sql immutable as $$ select 6 $$;

-- 그 사람이 받는 일당 상한. 판돈을 걸기 직전의 보유 코인으로 정한다.
-- 판돈의 절반이 이보다 적으면 그만큼만 준다(호출하는 쪽의 least(...)).
create or replace function app.play_wage(p_coins integer) returns integer
  language sql immutable as $$
    select case when coalesce(p_coins, 0) >= app.wage_rich_line() then 0
                when coalesce(p_coins, 0) <  app.wage_poor_line() then app.play_wage_poor()
                else app.play_wage() end
  $$;

-- 구내작업: 그날 작업표를 뽑을 때 이 이상 가졌으면 상·특 작업이 뜨지 않는다.
create or replace function app.labor_rich_line() returns integer
  language sql immutable as $$ select 1200 $$;

-- 구내작업: 그날 작업표를 뽑을 때 이 이하로 가졌으면 특 작업이 하나는 반드시 뜬다.
create or replace function app.labor_poor_line() returns integer
  language sql immutable as $$ select 200 $$;

-- 야간작업(18_labor.sql): 어제 낮 작업을 한 번도 못 한 사람만 KST 이 시각부터
-- 끝 시각이 되기 직전까지 한 번 할 수 있다.
create or replace function app.labor_night_from() returns integer
  language sql immutable as $$ select 2 $$;

create or replace function app.labor_night_to() returns integer
  language sql immutable as $$ select 5 $$;

-- 야간작업 표는 특·극만 뜬다. 한 칸이 극일 확률 — 나머지는 특.
create or replace function app.labor_night_hi_chance() returns numeric
  language sql immutable as $$ select 0.40 $$;

-- 표를 뽑을 때 app.labor_rich_line() 이상 가졌으면 극 확률이 이만큼으로 내려간다.
create or replace function app.labor_night_rich_hi_chance() returns numeric
  language sql immutable as $$ select 0.15 $$;

-- 야간작업 한 번에 드는 체력(낮 작업은 app.labor_hp_cost()). 이 값 이하면 막는다.
create or replace function app.labor_night_hp_cost() returns integer
  language sql immutable as $$ select 35 $$;

-- 농장 밭일을 마치면 이 확률로 밤고구마·호박고구마 중 하나(반반)를 챙긴다.
create or replace function app.farm_potato_chance() returns numeric
  language sql immutable as $$ select 0.5 $$;

-- 축사 관리를 마치면 이 확률로 우유 하나를 챙긴다.
create or replace function app.pens_milk_chance() returns numeric
  language sql immutable as $$ select 0.5 $$;

-- 야간 물고기잡이를 마치면 이 확률로 고등어·전갱이 중 하나(반반)를 챙긴다.
create or replace function app.fishing_fish_chance() returns numeric
  language sql immutable as $$ select 0.5 $$;

-- 야간 공중변소 청소 high 문구("밤에 온 ○○의 …")에 이름이 오르지 않는 사람.
-- 나머지 수감자(숨긴 계정·본인 제외) 중 하나가 랜덤으로 뽑힌다.
create or replace function app.latrine_excluded_names() returns text[]
  language sql immutable as $$ select array['강건우','신도혁','최형욱','서진우'] $$;

-- 탐색 고양이(24_cat.sql) 공개 스위치. false 인 동안은 시험 계정(app.search_is_tester,
-- 19_search.sql)만 고양이를 만나고, 다른 유저에게는 고양이 자리·보은이 전혀 보이지 않는다.
-- 2026-11-04 공개(true) — 17_items.sql 의 츄르 buy_price 도 50 으로 바꿨다.
create or replace function app.cat_public() returns boolean
  language sql immutable as $$ select true $$;

-- 탐색 고양이(24_cat.sql). 고양이를 만나면 이 품목을 간식으로 준다.
create or replace function app.cat_churu_item() returns text
  language sql immutable as $$ select 'churu' $$;

-- 친밀도가 이만큼 쌓여야 쓰다듬을 수 있다(유저별로 센다 — cat_bonds.churu_given).
create or replace function app.cat_friend_need() returns integer
  language sql immutable as $$ select 3 $$;

-- 이름이 붙은 뒤 츄르를 주면 이 확률로 보은이 온다.
create or replace function app.cat_gift_rate() returns numeric
  language sql immutable as $$ select 0.5 $$;

-- 고양이 간식이 되는 생선(야간 물고기잡이에서 잡는 날생선)과 축사 우유. 구운 것·섞은 것은 안 된다.
-- 소지품에 있으면 고양이를 끌어들이고(app.cat_fish_lure_chance), 친밀도·보은도 생선과 같다.
create or replace function app.cat_fish_items() returns text[]
  language sql immutable as $$ select array['fish_mackerel','fish_horse_mackerel','milk'] $$;

-- 간식 하나가 올려 주는 친밀도 — 츄르 / 생선.
create or replace function app.cat_churu_bond() returns integer
  language sql immutable as $$ select 1 $$;
create or replace function app.cat_fish_bond() returns integer
  language sql immutable as $$ select 2 $$;

-- 이름이 붙은 뒤 생선을 주면 이 확률로 보은이 온다(츄르는 app.cat_gift_rate).
create or replace function app.cat_fish_gift_rate() returns numeric
  language sql immutable as $$ select 1.0 $$;

-- 소지품에 생선이 있으면 오늘의 고양이 자리가 아닌 곳을 탐색해도 이 확률로 고양이가 나온다.
create or replace function app.cat_fish_lure_chance() returns numeric
  language sql immutable as $$ select 0.5 $$;

-- 츄르를 준 뒤 보은이 도착하기까지 걸리는 시간.
create or replace function app.cat_gift_delay() returns interval
  language sql immutable as $$ select interval '3 hours' $$;

-- 보은으로 오는 품목. 이 중 하나가 균등하게 뽑힌다.
create or replace function app.cat_gift_items() returns text[]
  language sql immutable as $$ select array['dead_bird','dead_mouse','dead_bug'] $$;

-- 고양이 이름 최대 글자 수.
create or replace function app.cat_name_max() returns integer
  language sql immutable as $$ select 12 $$;

-- 보은 효과(24_cat.sql 의 public.cat_gift_use). 효과는 화면에서 사용 팝업에만 적는다.
-- 죽은 새: 쓰면 다음 이만큼의 판에 판돈이 이만큼 얹힌다(app.bonus_stake).
create or replace function app.cat_bird_stake() returns integer
  language sql immutable as $$ select 10 $$;
create or replace function app.cat_bird_plays() returns integer
  language sql immutable as $$ select 3 $$;

-- 죽은 쥐: 쓰면 다음 훔치기 한 번(배급소·밀거래)의 최종 성공률에 이만큼 더한다.
-- 코인 구간·가액 상한으로 정해진 값 위에 더하므로 비싼 물건에도 그대로 붙는다.
create or replace function app.cat_mouse_steal() returns numeric
  language sql immutable as $$ select 0.10 $$;

-- 죽은 벌레: 쓰면 다음 작업 한 번(낮·야간)은 보수 범위의 위쪽 1/3(band high)
-- 안에서 뽑는다 — 최대치 고정이 아니라 늘 일을 잘한 판정이다. 손잡이 없음(18_labor.sql).

-- 네잎클로버: 배급소 추첨 때 이보다 많이 가졌으면 후보에서 빠진다.
create or replace function app.clover_rich_cut() returns integer
  language sql immutable as $$ select 500 $$;

-- 네잎클로버: 이 이하로 가졌으면 특급 칸에서 클로버 쪽으로 후보 선택을 당긴다
-- (병동의 퇴원서·중독의 해독제와 같은 방식 — 보장이 아니라 가중이다).
create or replace function app.clover_poor_line() returns integer
  language sql immutable as $$ select 200 $$;

-- 네잎클로버 배급소 할인가. 그날 배급소 목록이 뽑힐 때의 보유 코인으로 정하고
-- (shop_offers.clover_price 에 적힌다) 그날은 바뀌지 않는다. null 이면 정가(item_defs.buy_price).
create or replace function app.clover_cheap_line() returns integer
  language sql immutable as $$ select 100 $$;

create or replace function app.clover_price(p_coins integer) returns integer
  language sql immutable as $$
    select case when coalesce(p_coins, 0) <= app.clover_cheap_line() then 100
                when coalesce(p_coins, 0) <= app.clover_poor_line()  then 150
           end
  $$;

-- 네잎클로버의 배급소 하루 구매 수량(다른 품목은 app.shop_daily_cap()).
create or replace function app.clover_daily_cap() returns integer
  language sql immutable as $$ select 1 $$;

-- 명단에서 숨기는 계정(운영자 페르소나) 이름. 이 이름으로 발급된 계정은
-- 방배정·접속자·순위표·수감자 목록·1대1·거래/선물 상대에서 자동으로 빠진다.
create or replace function app.hidden_name() returns text
  language sql immutable as $$ select '관리자' $$;

