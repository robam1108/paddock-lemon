-- =============================================================
--  MINI CASINO - 배급소 · 밀거래 훔치기
--
--  왜
--    코인이 없으면 거래소는 그냥 닫힌 문이었다. 하루 한 번, 값을 치르지 않고
--    손을 대 볼 수 있게 한다. 가진 게 적을수록 성공률이 높아지고, 걸리면
--    코인과 체력을 함께 잃는다 — 체력이 다하면 그대로 병동으로 실려 간다.
--
--  규칙
--    · 시도권은 배급소와 밀거래가 따로. 각각 하루 한 번(KST 자정 기준).
--      shop_offers / smuggle_offers 가 이미 (user_id, day) 로 매일 새로 생기는
--      행이라 여기에 플래그만 얹으면 리셋이 공짜다.
--    · 성공률은 소지 코인이 적을수록 높다. 다만 물건 가액이 크면 상한이 걸린다
--      (개인 거래로 코인을 잠시 비우고 비싼 것만 노리는 걸 막는다).
--    · 실패하면 코인을 먼저 채우고 모자란 만큼을 체력에서 더 가져간다.
--      체력마저 모자라면 체력 0 -> 병동행으로 끝난다(코인을 더 가져가지 않는다).
--    · 병동에 있는 동안은 아예 시도할 수 없다. 병동에서는 체력이 이미 0이라
--      벌칙의 절반이 공짜가 되기 때문이다.
--    · 훔친 물건도 "오늘 산 것"으로 센다 — 배급소는 품목당 3개, 밀거래는
--      품목당 1개인 하루 한도를 우회하지 못한다.
--    · 증서(kind = 'permit', 가축 지목권·호칭권)는 훔칠 수 없다.
--
--  안전성
--    · alter table ... add column if not exists / create or replace 뿐이라
--      몇 번을 다시 돌려도 안전하다(멱등).
--    · 기존 buy_item / smuggle_buy 는 손대지 않는다. shop_catalog 와
--      smuggle_state 는 필드 하나(steal_used)만 더 실어 보낸다.
--
--  배포 순서: 이 SQL 먼저 -> 클라이언트 나중. 순서를 뒤집으면 훔치기 버튼이
--  떠 놓고 "function does not exist" 가 난다.
--
--  롤백: shop_steal / smuggle_steal 을 drop 하고, shop_catalog /
--  smuggle_state 에서 steal_used 줄을 빼면 된다. steal_used 컬럼은 남겨 두어도
--  무해하다.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. 시도권 — 그날의 오퍼 행에 플래그 하나
-- -------------------------------------------------------------
alter table public.shop_offers
  add column if not exists steal_used boolean not null default false;

alter table public.smuggle_offers
  add column if not exists steal_used boolean not null default false;


-- -------------------------------------------------------------
-- 2. 확률
-- -------------------------------------------------------------

-- 배급소 기본 성공률. 가진 게 적을수록 손이 잘 든다.
create or replace function app.shop_steal_base(p_coins integer) returns numeric
  language sql immutable as $$
    select case
             when coalesce(p_coins, 0) < 10 then 0.40
             when coalesce(p_coins, 0) < 20 then 0.25
             when coalesce(p_coins, 0) < 50 then 0.10
             else 0.03
           end
  $$;

-- 밀거래 기본 성공률. 상대가 장사꾼이라 배급관처럼 만만하지 않다.
-- app.smuggle_steal_base 의 정본은 16_steal_trick.sql 이다(05_smuggle.sql 에 같은
-- 본문의 사본이 있다). 여기 있던 옛 사본은 상향 전 확률(3% / 0.5%)이라, 이 파일만
-- 단독으로 다시 돌리면 밀거래 훔치기가 조용히 옛 확률로 되감겼다 — 그래서 지웠다.
-- 권한(revoke)은 05_smuggle.sql 이 건다.

-- 물건 가액에 따른 성공률 상한.
-- 이게 없으면 개인 거래로 코인을 잠시 남에게 넘겨 10코인 미만을 만든 뒤
-- 퇴원서(300)·해독제(400) 만 40%로 노리는 게 압도적으로 남는 장사가 된다.
create or replace function app.steal_value_cap(p_price integer) returns numeric
  language sql immutable as $$
    select case
             when coalesce(p_price, 0) <= 100 then 1.00
             when coalesce(p_price, 0) <= 200 then 0.10
             else 0.05
           end
  $$;

create or replace function app.steal_rate(p_base numeric, p_price integer) returns numeric
  language sql immutable as $$
    select least(p_base, app.steal_value_cap(p_price))
  $$;


-- -------------------------------------------------------------
-- 3. 실패 벌칙 — 코인을 먼저 채우고, 모자란 만큼을 체력에서
--
--    p_coin_base 까지는 코인에서 가져가고, 총합이 p_total 이 되도록 나머지를
--    체력에서 가져간다. 코인이 모자라면 그만큼 체력 쪽이 커진다. 체력이
--    모자라면 체력 0 이 되어 app.spend_hp 가 병동 사다리로 보낸다 — 그걸로
--    끝이고 코인을 더 가져가지는 않는다.
-- -------------------------------------------------------------
create or replace function app.steal_penalty(
  p_uid uuid, p_coin_base integer, p_total integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_p         public.profiles;
  v_coin_cut  integer;
  v_hp_before integer;
  v_hp_cut    integer;
begin
  select * into v_p from public.profiles where id = p_uid for update;

  v_coin_cut  := least(greatest(v_p.coins, 0), greatest(p_coin_base, 0));
  v_hp_before := v_p.hp;

  if v_coin_cut > 0 then
    update public.profiles set coins = coins - v_coin_cut
     where id = p_uid
    returning * into v_p;
  end if;

  -- app.spend_hp 가 greatest(0, hp - amount) 로 자르고, 0이 되면
  -- app.ward_hours(ward_visits) 사다리로 병동에 보낸다.
  v_p      := app.spend_hp(p_uid, greatest(0, p_total - v_coin_cut));
  v_hp_cut := greatest(0, v_hp_before - v_p.hp);

  return jsonb_build_object(
    'coin_cut', v_coin_cut,
    'hp_cut',   v_hp_cut,
    'to_ward',  (v_p.ward_until is not null)
  );
end;
$$;


-- -------------------------------------------------------------
-- 4. 배급소 — 목록에 steal_used 를 실어 보낸다
--    배열 모양을 유지하려고 모든 항목에 같은 값이 실린다(그날의 시도권은
--    품목별이 아니라 배급소 전체에 하나다).
-- -------------------------------------------------------------
create or replace function public.shop_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_codes  text[];
  v_bought jsonb;
  v_steal  boolean;
  v_clover integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  v_codes := app.shop_today(v_uid);

  select bought, steal_used, clover_price into v_bought, v_steal, v_clover from public.shop_offers
   where user_id = v_uid and day = app.today_kst();

  -- 정렬은 카탈로그 순서를 그대로 쓴다.
  -- 뽑힌 순서대로 늘어놓으면 마지막 칸이 어디인지 드러난다.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', code, 'name', name, 'kind', kind, 'grade', grade,
             'emoji', emoji, 'heal', heal, 'plays', plays,
             'ward_cut', ward_cut, 'win_double', win_double,
             -- 네잎클로버는 목록이 뽑힐 때 정해진 할인가가 있으면 그 값. 할인이면 정가를 list_price 로 함께 실어
             -- 화면에 할인으로 보이게 한다(정가 그대로면 null).
             'buy_price', case when code = 'clover' then coalesce(v_clover, buy_price) else buy_price end,
             'list_price', case when code = 'clover' and v_clover < buy_price then buy_price end,
             'sell_price', sell_price,
             'tradable', tradable, 'description', description,
             'daily_cap', app.shop_item_cap(code),
             'bought', coalesce((coalesce(v_bought, '{}'::jsonb)->>code)::int, 0),
             'steal_used', coalesce(v_steal, false)
           ) order by sort_order, code)
      from public.item_defs
     where code = any(v_codes) and buy_price is not null), '[]'::jsonb);
end;
$$;


-- -------------------------------------------------------------
-- 5. 배급소 훔치기
-- -------------------------------------------------------------
-- public.shop_steal 의 정본은 16_steal_trick.sql 이다(02_schema.sql 에 같은 본문의
-- 사본이 있고, 02 는 맨 앞에서 돌아 되감기지 않는다). 여기 있던 옛 사본은
-- 절도비법(steal_sure) 확정 성공 분기가 없어서, 이 파일만 단독으로 다시 돌리면
-- 그 기능이 조용히 사라졌다 — 그래서 지웠다. 권한은 02_schema.sql 이 건다.


-- -------------------------------------------------------------
-- 6. 밀거래 — 상태에 steal_used 한 줄
--    (05_smuggle.sql 의 public.smuggle_state() 를 통째로 다시 만든다)
-- -------------------------------------------------------------
-- public.smuggle_state 의 정본은 16_steal_trick.sql 이다(05_smuggle.sql 에 같은
-- 본문의 사본이 있고, 05 는 이 파일보다 앞서 돌아 되감기지 않는다). 여기 있던 옛
-- 사본은 특별 상품의 steal_sure 표시가 없어서, 이 파일만 단독으로 다시 돌리면
-- 그 표시가 조용히 사라졌다 — 그래서 지웠다. 권한은 05_smuggle.sql 이 건다.


-- -------------------------------------------------------------
-- 7. 밀거래 훔치기
--    값(v_price)은 smuggle_buy 와 완전히 같은 식으로 구한다 — 화면에 뜬 그
--    값이 그대로 벌칙과 확률 상한의 기준이 되어야 한다.
-- -------------------------------------------------------------
-- public.smuggle_steal 의 정본은 16_steal_trick.sql 이다. 여기 있던 옛 사본은
-- 절도비법 확정 성공 분기도, 실패 벌칙 하향(전액->50%, 50%->25%)도 없는 이전
-- 본문이라, 이 파일만 단독으로 다시 돌리면 둘 다 조용히 되감겼다 — 그래서 지웠다.
-- 권한(revoke/grant)도 정본이 있는 16_steal_trick.sql 쪽으로 옮겼다.


-- -------------------------------------------------------------
-- 8. 권한
-- -------------------------------------------------------------
revoke all on function app.shop_steal_base(integer)              from public, anon, authenticated;
revoke all on function app.steal_value_cap(integer)              from public, anon, authenticated;
revoke all on function app.steal_rate(numeric, integer)          from public, anon, authenticated;
revoke all on function app.steal_penalty(uuid, integer, integer)  from public, anon, authenticated;

revoke all on function public.shop_catalog()        from public;

grant execute on function public.shop_catalog()       to authenticated;

commit;
