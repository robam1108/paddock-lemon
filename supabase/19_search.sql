-- =============================================================
--  MINI CASINO - 탐색
--
--  왜
--    코인이 아니라 물건이 나오는 벌이가 하나 있어야 한다. 시설 다섯 곳
--    (수용동·식당·샤워실·작업장·의료동) 중 하나를 하루 한 번 뒤진다.
--
--  규칙
--    · 하루 한 번, 체력 15를 쓴다. 체력이 딱 15여도 할 수 없다(<= 로 막는다)
--      — 탐색으로 쓰러지는 일은 없다.
--    · 장소마다 나오는 갈래가 다르다(app.search_kinds). 증서(가축 지목권·
--      호칭권)는 buy_price 가 null 이라 애초에 추첨 풀에 없고, kind='permit'
--      조건으로 한 번 더 막는다(15_steal.sql 의 훔치기 금지와 같은 이중
--      방어).
--    · 결과는 난수 하나로 셋 중 하나로 갈린다 — 꽝 10%, 비상식량 30%,
--      등급 추첨 60%(일반 54 / 고급 28 / 희귀 13 / 특급 4 / 전설 1을 그
--      60% 안에서 다시 가른다). 등급 추첨이면 그 등급 안에서 장소의 갈래에
--      맞는 것 하나를 균등하게 고르고, 후보가 없으면 한 등급씩 내려가며
--      (전설→...→일반) 다시 찾는다.
--    · 체력은 꽝이어도 그대로 나간다 — 오늘 몫도 이미 소모된다.
--    · 시험 계정(app.search_is_tester)은 하루 한 번 제한·체력 없이 몇 번이고 뒤진다.
--    · 유저마다·날마다 정해지는 고양이 자리(app.cat_place, 24_cat.sql)를 고르면
--      추첨 없이 고양이를 만난다. 그날은 물건이 안 나온다. public.cat_bonds 와
--      app.cat_place 는 함수 몸통에서만 부르므로 24 가 이 파일보다 뒤에 돌아도 된다.
--    · 소지품에 날생선(app.cat_fish_items)이 있으면 고양이 자리가 아닌 곳에서도
--      app.cat_fish_lure_chance() 확률로 고양이를 만난다. 이름을 지어 준 뒤에는
--      search_board 가 고양이 자리(cat_spot)를 알려 줘 화면이 발자국을 찍고,
--      생선 냄새로 다른 곳에서 만나는 일은 없어진다.
--
--  안전성: create table if not exists 뿐이라 몇 번을 다시 돌려도 안전하다
--  (멱등). item_defs·inventories 스키마는 건드리지 않는다.
--
--  배포 순서: 17_items.sql(비상식량 등) 다음, 18_labor.sql, 그 다음 이 SQL,
--  마지막에 클라이언트. 이 파일은 item_defs 에 행을 만들지 않으므로
--  17_items.sql 보다 먼저 돌 이유가 없다 — 순서를 뒤집으면 30% 비상식량
--  분기가 아직 없는 코드를 인벤에 등록하려다 FK 에러를 낸다.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. 상수
-- -------------------------------------------------------------
create or replace function app.search_hp_cost() returns integer
  language sql immutable as $$ select 15 $$;

create or replace function app.search_ration_rate() returns numeric
  language sql immutable as $$ select 0.30 $$;

create or replace function app.search_ration_item() returns text
  language sql immutable as $$ select 'emg_ration' $$;

-- 아무것도 못 건지는 확률. 비상식량(30%)·등급 추첨(60%)보다 먼저 갈린다.
create or replace function app.search_miss_rate() returns numeric
  language sql immutable as $$ select 0.10 $$;

-- 장소별로 나오는 아이템 갈래. 목록에 없는 place 는 null 을 돌려주고,
-- 호출부가 이를 INVALID_PLACE 로 처리한다.
-- 부적(charm, 네잎클로버)은 배급소 전용이라 어느 장소에도 넣지 않는다.
create or replace function app.search_kinds(p_place text)
returns text[]
language sql
immutable
as $$
  select case p_place
           when 'cell'   then array['tobacco', 'luxury', 'adult', 'trick']
           when 'mess'   then array['food', 'treat', 'liquor']
           when 'shower' then array['adult', 'tool', 'luxury']
           when 'works'  then array['tool', 'luxury', 'tobacco']
           when 'infirm' then array['medicine', 'drug']
           else null
         end;
$$;

-- 갈래는 맞아도 탐색에서는 나오지 않는 품목. 밀거래로만 구한다.
-- 츄르는 고양이 간식이라 식당(treat)에서 나오면 안 된다(24_cat.sql).
create or replace function app.search_exclude()
returns text[]
language sql
immutable
as $$
  select array['radio', 'churu']
$$;


-- -------------------------------------------------------------
-- 2. 오늘 이미 뒤졌는지 — (user_id, day) 한 행. 행이 있으면 그걸로 끝이다.
-- -------------------------------------------------------------
create table if not exists public.search_offers (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  place   text not null,
  primary key (user_id, day)
);

-- 그날 고른 곳이 고양이 자리(app.cat_place, 24_cat.sql)였으면 물건 대신 고양이를
-- 만난다. null = 고양이 없음, 'waiting' = 간식주기/쓰다듬기 대기, 'done' = 끝.
alter table public.search_offers add column if not exists cat text;


-- -------------------------------------------------------------
-- 3. 추첨
-- -------------------------------------------------------------

-- 등급 추첨. 일반 54 / 고급 28 / 희귀 13 / 특급 4 / 전설 1.
-- (app.roll_grade · app.roll_smuggle_grade 와 같은 결)
create or replace function app.roll_search_grade()
returns text
language sql
volatile
as $$
  select case
           when r < 0.54 then 'common'
           when r < 0.82 then 'uncommon'
           when r < 0.95 then 'rare'
           when r < 0.99 then 'epic'
           else 'legendary'
         end
    from (select random() as r) s;
$$;

-- 반환이 null 이면 "꽝"이다(호출부가 그렇게 해석한다) — 등급 추첨 후보가
-- 없어서 못 찾은 경우와는 다른 뜻이므로, 그 경우는 아래서 예외로 던져
-- 두 뜻이 겹치지 않게 한다.
--
-- 난수 하나로 셋을 가른다 — 갈래마다 random() 을 따로 뽑으면 확률이
-- 조건부로 얽혀 읽기 어렵다.
--   v_r < 0.10          → 꽝(null)
--   v_r < 0.10 + 0.30   → 비상식량
--   그 외                → 등급 추첨. 그 등급에 후보가 없으면(장소의 갈래가
--                          좁아 특급 이상이 아예 없는 곳도 있다) 한 등급씩
--                          내려가며(전설→특급→희귀→고급→일반) 다시 찾는다.
create or replace function app.roll_search(p_place text)
returns text
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_kinds text[] := app.search_kinds(p_place);
  -- 전설부터 일반까지, 내려가는 순서 그대로.
  v_order text[] := array['legendary', 'epic', 'rare', 'uncommon', 'common'];
  v_r     numeric := random();
  v_start integer;
  v_grade text;
  v_code  text;
begin
  if v_kinds is null then raise exception 'INVALID_PLACE'; end if;

  if v_r < app.search_miss_rate() then
    return null;
  end if;

  if v_r < app.search_miss_rate() + app.search_ration_rate() then
    return app.search_ration_item();
  end if;

  v_grade := app.roll_search_grade();
  v_start := array_position(v_order, v_grade);

  for i in v_start .. array_length(v_order, 1) loop
    select code into v_code
      from public.item_defs
     where grade = v_order[i]
       and kind = any(v_kinds)
       and kind <> 'permit'
       and code <> all(app.search_exclude())
       and buy_price is not null
     order by random()
     limit 1;

    exit when v_code is not null;
  end loop;

  -- 카탈로그가 각 장소 갈래에 최소 일반 등급 하나씩은 갖도록 맞춰 뒀으니
  -- 이론상 도달하지 않는다. 그래도 비면 "꽝"과 겹치지 않도록 예외로 던진다.
  if v_code is null then raise exception 'NO_SUCH_ITEM'; end if;

  return v_code;
end;
$$;


-- 시험 계정 — 관리자 권한이 있고 이름이 app.hidden_name()('관리자')인 계정.
-- (경마의 app.race_is_tester 와 같은 방식.) 하루 한 번 제한·체력 없이 탐색하고,
-- 고양이 공개 전에도 고양이를 만나며 테스트 패널(public.cat_test, 24_cat.sql)을 쓴다.
create or replace function app.search_is_tester(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select coalesce((select is_admin and username = app.hidden_name()
                     from public.profiles where id = p_uid), false)
$$;


-- -------------------------------------------------------------
-- 4. 조회
-- -------------------------------------------------------------
create or replace function public.search_board()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.search_offers;
  v_used boolean;
  v_cat_name  text;
  v_petted    boolean;
  v_tester    boolean;
  v_open      boolean;
  v_board     jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  v_tester := app.search_is_tester(v_uid);
  -- 고양이가 공개 전이면 시험 계정 말고는 고양이 값을 전혀 받지 않는다.
  v_open := v_tester or app.cat_public();

  select * into v_row from public.search_offers
   where user_id = v_uid and day = app.today_kst();
  v_used := found;

  if v_open then
    -- 이름은 사람마다 따로 짓는다(24_cat.sql 의 cat_bonds.name).
    select name, petted into v_cat_name, v_petted from public.cat_bonds where user_id = v_uid;
  end if;

  v_board := jsonb_build_object(
    'hp_cost', case when v_tester then 0 else app.search_hp_cost() end,
    'used', v_used,
    'place', case when v_used then v_row.place else null end,
    -- 고양이를 만나 놓고 아직 간식주기/쓰다듬기를 안 눌렀다 — 팝업을 다시 연다.
    'cat_waiting', v_open and v_used and v_row.cat is not distinct from 'waiting',
    'cat_met', v_open and v_used and v_row.cat is not null,
    'cat_name', v_cat_name,
    -- 쓰다듬기에 성공했는데 아직 내가 부를 이름을 안 지었다.
    'can_name', v_open and v_cat_name is null and coalesce(v_petted, false),
    -- 이름을 지어 준 사이면 오늘 고양이 자리를 알려 준다 — 화면이 그 칸에 발자국을
    -- 찍는다. 이때부터 생선 냄새로 다른 곳에서 만나는 일은 없다(search_look).
    'cat_spot', case when v_open and v_cat_name is not null
                     then app.cat_place(v_uid, app.today_kst()) end,
    'tester', v_tester
  );

  -- 시험 계정에게만 테스트 패널 값을 붙인다.
  if v_tester then
    v_board := v_board || jsonb_build_object(
      'cat_place', app.cat_place(v_uid, app.today_kst()),
      'churu_given', coalesce(
        (select churu_given from public.cat_bonds where user_id = v_uid), 0),
      'churu_held', coalesce(
        (select qty from public.inventories
          where user_id = v_uid and item_code = app.cat_churu_item()), 0),
      'gifts_waiting', (select count(*) from public.cat_gifts
                         where user_id = v_uid and resolved_at is null),
      'bless_left', (select cat_boost_left from public.profiles where id = v_uid)
    );
  end if;

  return v_board;
end;
$$;


-- -------------------------------------------------------------
-- 5. 실행
-- -------------------------------------------------------------
create or replace function public.search_look(p_place text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_code   text;
  v_def    public.item_defs;
  v_ration boolean;
  v_miss   boolean;
  v_ins    integer;
  v_cat    text;
  v_tester boolean;
  v_hp_cut integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);
  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;

  -- 시험 계정은 하루 한 번 제한도 체력도 없다 — 고양이를 시험하려고 몇 번이고 뒤진다.
  v_tester := app.search_is_tester(v_uid);
  v_hp_cut := case when v_tester then 0 else app.search_hp_cost() end;

  if not v_tester and exists (
    select 1 from public.search_offers
     where user_id = v_uid and day = app.today_kst()
  ) then
    raise exception 'SEARCH_USED';
  end if;

  -- 체력이 딱 소모량이어도 막는다 — 탐색으로는 쓰러지지 않는다.
  if not v_tester and v_p.hp <= app.search_hp_cost() then raise exception 'NO_HP'; end if;

  if app.search_kinds(p_place) is null then raise exception 'INVALID_PLACE'; end if;

  -- 여기서부터는 되돌릴 수 없다. 오늘 몫을 먼저 박아 둔다 — 동시 호출로
  -- 두 곳을 뒤지는 걸 막는다(위 exists 확인과 이 insert 사이의 경합은
  -- on conflict 가 최종적으로 잡는다). 시험 계정은 오늘 행을 덮어써 새로 시작한다.
  if v_tester then
    insert into public.search_offers (user_id, day, place)
    values (v_uid, app.today_kst(), p_place)
    on conflict (user_id, day) do update set place = excluded.place, cat = null;
  else
    insert into public.search_offers (user_id, day, place)
    values (v_uid, app.today_kst(), p_place)
    on conflict (user_id, day) do nothing;

    get diagnostics v_ins = row_count;
    if v_ins = 0 then raise exception 'SEARCH_USED'; end if;
  end if;

  -- 오늘 고양이 자리면 추첨을 건너뛴다 — 고양이를 만난 날은 물건을 못 찾는다.
  -- 체력과 오늘 몫은 그대로 나간다. 간식주기/쓰다듬기는 public.cat_act 가 받는다.
  -- 공개 전(app.cat_public() = false)에는 시험 계정만 고양이를 만난다.
  -- 소지품에 생선(app.cat_fish_items)이 있으면 다른 곳에서도
  -- app.cat_fish_lure_chance() 확률로 냄새를 맡은 고양이가 나온다.
  -- 단, 이름을 지어 준 뒤에는 화면이 고양이 자리에 발자국을 찍어 준다 — 그걸 피해
  -- 다른 곳을 골랐다면 만나고 싶지 않은 것이라 생선 냄새로는 나오지 않는다.
  if (v_tester or app.cat_public())
     and (p_place = app.cat_place(v_uid, app.today_kst())
          or (not exists (select 1 from public.cat_bonds
                           where user_id = v_uid and name is not null)
              and exists (select 1 from public.inventories
                           where user_id = v_uid and qty > 0
                             and item_code = any(app.cat_fish_items()))
              and random() < app.cat_fish_lure_chance())) then
    update public.search_offers set cat = 'waiting'
     where user_id = v_uid and day = app.today_kst();

    v_p := app.spend_hp(v_uid, v_hp_cut);
    select name into v_cat from public.cat_bonds where user_id = v_uid;

    perform app.log(v_uid, 'search', '고양이', 0, v_p.coins,
      jsonb_build_object('place', p_place, 'cat', true));

    return app.state_json(v_p) || jsonb_build_object('search',
      jsonb_build_object(
        'place', p_place,
        'miss', false,
        'ration', false,
        'hp_cut', v_hp_cut,
        'item', null,
        'cat', jsonb_build_object('name', v_cat)
      ));
  end if;

  -- v_code 가 null 이면 꽝이다 — roll_search() 안에서 이미 등급 추첨의
  -- 진짜 실패(후보 없음)는 예외로 갈라 뒀으니, 여기 도달하는 null 은
  -- 오직 꽝(app.search_miss_rate() 분기)뿐이다.
  v_code := app.roll_search(p_place);
  v_miss := (v_code is null);
  v_ration := (not v_miss) and (v_code = app.search_ration_item());

  v_p := app.spend_hp(v_uid, v_hp_cut);

  if v_miss then
    perform app.log(v_uid, 'search', '빈손', 0, v_p.coins,
      jsonb_build_object('place', p_place, 'miss', true));

    return app.state_json(v_p) || jsonb_build_object('search',
      jsonb_build_object(
        'place', p_place,
        'miss', true,
        'ration', false,
        'hp_cut', v_hp_cut,
        'item', null
      ));
  end if;

  -- 30% 비상식량 분기는 item_defs 를 거치지 않고 코드를 그대로 돌려주는
  -- 유일한 경로다 — 17_items.sql 을 아직 안 돌린 DB 라면 여기서
  -- 못 찾을 수 있다. 날것의 FK 에러 대신 알아볼 수 있는 예외로 막는다.
  select * into v_def from public.item_defs where code = v_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;

  insert into public.inventories (user_id, item_code, qty)
  values (v_uid, v_code, 1)
  on conflict (user_id, item_code)
    do update set qty = inventories.qty + excluded.qty;

  perform app.log(v_uid, 'search', v_def.name, 0, v_p.coins,
    jsonb_build_object('code', v_code, 'place', p_place, 'ration', v_ration));

  return app.state_json(v_p) || jsonb_build_object('search',
    jsonb_build_object(
      'place', p_place,
      'miss', false,
      'ration', v_ration,
      'hp_cut', v_hp_cut,
      'item', jsonb_build_object(
        'code', v_def.code,
        'name', v_def.name,
        'emoji', v_def.emoji,
        'grade', v_def.grade,
        'kind', v_def.kind,
        'buy_price', v_def.buy_price,
        'description', v_def.description
      )
    ));
end;
$$;


-- -------------------------------------------------------------
-- 6. 권한
-- -------------------------------------------------------------
alter table public.search_offers enable row level security;
-- 정책을 만들지 않는다 — search_board()/search_look() 로만 나간다.

revoke all on function app.search_kinds(text)      from public, anon, authenticated;
revoke all on function app.search_exclude()       from public, anon, authenticated;
revoke all on function app.roll_search_grade()     from public, anon, authenticated;
revoke all on function app.roll_search(text)       from public, anon, authenticated;
revoke all on function app.search_hp_cost()        from public, anon, authenticated;
revoke all on function app.search_ration_rate()    from public, anon, authenticated;
revoke all on function app.search_ration_item()    from public, anon, authenticated;
revoke all on function app.search_miss_rate()      from public, anon, authenticated;
revoke all on function app.search_is_tester(uuid)  from public, anon, authenticated;

revoke all on function public.search_board()     from public;
revoke all on function public.search_look(text)  from public;

grant execute on function public.search_board()    to authenticated;
grant execute on function public.search_look(text) to authenticated;

commit;
