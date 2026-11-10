-- =============================================================
--  MINI CASINO - 작업장
--
--  왜
--    코인을 버는 길이 전부 판돈을 거는 게임뿐이었다. 다 잃으면 관리자가
--    admin_give_coins() 로 꽂아 주기 전까지 아무것도 할 수 없었다. 무간은
--    섬이고 시설 유지에 필요한 구내작업이 있다는 설정(안내문 참고)에 맞춰,
--    판돈 없이 체력만으로 코인을 버는 길을 하나 연다.
--
--  규칙
--    · 하루 3개의 작업이 뜬다(shop_offers 와 같은 (user_id, day) 행 패턴 —
--      자정이 지나면 저절로 새 행이 된다).
--    · 근무 시간은 한국 시간(KST) 13시부터 19시가 되기 직전까지다. 그
--      밖에서는 오늘 배정을 볼 수는 있어도 일할 수는 없다.
--    · 한 작업은 하루에 한 번만, 전체로도 하루 2번까지만 할 수 있다.
--    · 한 번 하면 2시간이 지나야 다음 작업을 할 수 있다. 창이 6시간이라
--      17시를 넘겨 첫 작업을 하면 그날 두 번째는 못 한다 — 그대로 둔다.
--    · 체력 10을 쓴다. 체력이 딱 10이어도 할 수 없다(<= 로 막는다) — 작업으로
--      쓰러지는 일은 없다. 시설이 자기 노동력을 굳이 기절시키지는 않는다.
--    · 보수는 작업마다 정해진 범위(하 32~45 / 중 48~70 / 상 72~95 / 특 112~150)
--      안에서 그때그때 뽑힌다. 난이도·범위는 클라이언트에 절대 나가지 않는다
--      — labor_defs 테이블에 RLS만 켜고 정책은 만들지 않는다.
--    · 야간작업: 어제 낮 작업을 한 번도 못 한 사람은 새벽 2시부터 5시가 되기
--      직전까지 한 번 할 수 있다. 표 3개, 특·극(야간 전용, 작업마다 100~300
--      안에서 범위가 다 다르다)만, 낮과 겹치지 않는 일(labor_defs.night).
--      체력은 한 번에 35(app.labor_night_hp_cost). 코인이 많으면 특(보수가
--      낮은 쪽)이 더 잘 뜬다.
--    · 농장 밭일(farm)은 절반 확률로 밤고구마·호박고구마 중 하나를 챙긴다.
--      축사 관리(pens)는 절반 확률로 우유를 챙긴다(app.pens_milk_chance).
--      야간 물고기잡이(fishing)는 절반 확률로 고등어·전갱이 중 하나를 챙긴다.
--
--  안전성: create table if not exists / on conflict do nothing(오늘의 배정) 뿐이라
--  몇 번을 다시 돌려도 안전하다(멱등). 다만 labor_defs 시드는 on conflict do
--  update 라 — 재실행하면 보수 범위가 그 자리에서 새 값으로 덮인다(의도한
--  동작이다. 표를 고치는 유일한 방법이 이 파일을 다시 돌리는 것이다).
--  item_defs·shop_offers 는 건드리지 않는다.
--
--  배포 순서: 17_items.sql(비상식량 등) 다음, 이 SQL, 그 다음 클라이언트.
--  19_search.sql 과는 순서 무관 — 서로 참조하지 않는다.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. 상수
-- -------------------------------------------------------------
create or replace function app.labor_hp_cost() returns integer
  language sql immutable as $$ select 10 $$;

create or replace function app.labor_daily_limit() returns integer
  language sql immutable as $$ select 2 $$;

create or replace function app.labor_cooldown() returns interval
  language sql immutable as $$ select interval '2 hours' $$;

-- labor_work() 반환에 초 단위로 실어 보낼 때 쓴다(간결함용).
create or replace function app.labor_cooldown_seconds() returns integer
  language sql immutable as $$
    select extract(epoch from app.labor_cooldown())::int
  $$;

create or replace function app.labor_board_size() returns integer
  language sql immutable as $$ select 3 $$;

-- 근무 시간대(KST). app.cell_week_kst()/app.meal_slots() 와 같은 결로
-- timezone('Asia/Seoul', now()) 벽시계 안에서만 계산한다(한국은 서머타임이
-- 없어 이 프레임이 항상 안전하다).
create or replace function app.labor_open_from() returns integer
  language sql immutable as $$ select 13 $$;

-- 이 시각이 되는 순간 닫힌다 — 19:00:00 은 이미 시간 밖이다.
create or replace function app.labor_open_to() returns integer
  language sql immutable as $$ select 19 $$;

create or replace function app.labor_is_open() returns boolean
language sql stable as $$
  select h >= app.labor_open_from() and h < app.labor_open_to()
    from (select extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;

-- 열림/닫힘이 바뀔 때까지 남은 초. 열려 있으면 오늘 19시까지, 닫혀 있으면
-- 다음 13시까지(자정을 넘는 경우 포함).
create or replace function app.labor_window_left() returns integer
language sql stable as $$
  select greatest(0, extract(epoch from (
           case when h <  app.labor_open_from() then d + make_interval(hours => app.labor_open_from())
                when h <  app.labor_open_to()   then d + make_interval(hours => app.labor_open_to())
                else d + interval '1 day' + make_interval(hours => app.labor_open_from())
           end - t)))::int
    from (select timezone('Asia/Seoul', now()) as t,
                 date_trunc('day', timezone('Asia/Seoul', now())) as d,
                 extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;


-- -------------------------------------------------------------
-- 2. 작업표 — 정본. 클라이언트는 이 테이블을 직접 읽지 못한다.
--    이름·설명·결과 문구는 src/lib/labor.ts 에 code 로 대응해 둔다.
-- -------------------------------------------------------------
create table if not exists public.labor_defs (
  code    text primary key,
  tier    smallint not null check (tier between 1 and 5),
  pay_min integer  not null check (pay_min > 0),
  pay_max integer  not null check (pay_max >= pay_min)
);

-- 5(극)는 야간작업에만 있다. 테이블이 이미 있으면 위 check 가 안 바뀌므로
-- 여기서 갈아 끼운다(멱등).
alter table public.labor_defs drop constraint if exists labor_defs_tier_check;
alter table public.labor_defs add constraint labor_defs_tier_check check (tier between 1 and 5);

-- 야간작업(새벽 2~5시) 전용 작업인지. 낮 표(app.roll_labor)는 false 만,
-- 야간 표(app.roll_labor_night)는 true 만 뽑는다 — 두 표가 섞이지 않는다.
alter table public.labor_defs add column if not exists night boolean not null default false;

insert into public.labor_defs (code, tier, pay_min, pay_max) values
  -- 1 하 (32~45)
  ('laundry',   1,  32, 45),
  ('serving',   1,  32, 45),
  ('corridor',  1,  32, 45),
  ('supply',    1,  32, 45),
  -- 2 중 (48~70)
  ('sewing',    2, 48, 70),
  ('kitchen',   2, 48, 70),
  ('carpentry', 2, 48, 70),
  ('farm',      2, 48, 70),
  -- 3 상 (72~95)
  ('unload',    3, 72, 95),
  ('pens',      3, 72, 95),
  ('saltern',   3, 72, 95),
  ('generator', 3, 72, 95),
  -- 4 특 (112~150)
  ('quarry',    4, 112, 150),
  ('seawall',   4, 112, 150),
  ('furnace',   4, 112, 150),
  ('sewer',     4, 112, 150)
on conflict (code) do update
  set tier = excluded.tier, pay_min = excluded.pay_min, pay_max = excluded.pay_max;

-- 야간작업. 특·극만 있고(극(5)은 야간에만 있다), 낮과 달리 작업마다 하한·상한이
-- 다 다르다(100~300 안). 같은 등급 안에서도 보수가 갈린다.
insert into public.labor_defs (code, tier, pay_min, pay_max, night) values
  -- 4 특
  ('fishing',    4, 100, 150, true),
  ('coldstore',  4, 105, 165, true),
  ('boiler',     4, 110, 180, true),
  ('nets',       4, 120, 195, true),
  -- 5 극
  ('septic',     5, 140, 230, true),
  ('latrine',    5, 150, 250, true),
  ('lighthouse', 5, 160, 275, true),
  ('pump',       5, 175, 300, true)
on conflict (code) do update
  set tier = excluded.tier, pay_min = excluded.pay_min, pay_max = excluded.pay_max,
      night = excluded.night;


-- -------------------------------------------------------------
-- 3. 오늘의 배정 — (user_id, day) 한 행. shop_offers 와 같은 결이다.
-- -------------------------------------------------------------
create table if not exists public.labor_offers (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  codes   text[] not null,
  done    text[] not null default '{}',
  last_at timestamptz,
  primary key (user_id, day)
);

-- 난이도(tier) 추첨. app.roll_grade() 와 같은 결 — 쉬운 쪽이 잘 뜨도록
-- 누적 확률을 고정 값으로 둔다. 하 35% / 중 30% / 상 22% / 특 13%.
create or replace function app.roll_labor_tier()
returns smallint
language sql
volatile
as $$
  select case
           when r < 0.35 then 1
           when r < 0.65 then 2
           when r < 0.87 then 3
           else 4
         end
    from (select random() as r) s;
$$;

-- tier 를 먼저 뽑고 그 tier 안에서 균등하게 하나를 고른다(app.roll_smuggle()
-- 과 같은 이단계 구조). 같은 code 가 중복되지 않는다.
--
-- 뽑는 순간의 보유 코인으로 표가 조용히 달라진다(00_rules.sql 의 코인 구간).
--   · app.labor_rich_line() 이상: 상·특이 나오면 tier 를 다시 뽑는다 — 하:중
--     비율(35:30)은 그대로다.
--   · app.labor_poor_line() 이하: 첫 칸을 특으로 고정하고 나머지는 평소대로.
-- 그날 표는 한 번 뽑히면 고정이라, 낮에 코인이 바뀌어도 다음 자정부터 반영된다.
drop function if exists app.roll_labor();
create or replace function app.roll_labor(p_uid uuid)
returns text[]
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_codes text[] := array[]::text[];
  v_have  integer := 0;
  v_tier  smallint;
  v_code  text;
  v_try   integer := 0;
  v_coins integer;
begin
  select coins into v_coins from public.profiles where id = p_uid;
  v_coins := coalesce(v_coins, 0);

  while v_have < app.labor_board_size() and v_try < 300 loop
    v_try := v_try + 1;
    if v_have = 0 and v_coins <= app.labor_poor_line() then
      v_tier := 4;
    else
      v_tier := app.roll_labor_tier();
      while v_coins >= app.labor_rich_line() and v_tier >= 3 loop
        v_tier := app.roll_labor_tier();
      end loop;
    end if;

    select code into v_code
      from public.labor_defs
     where tier = v_tier and not night and not (code = any(v_codes))
     order by random()
     limit 1;

    if v_code is not null then
      v_codes := v_codes || v_code;
      v_have  := v_have + 1;
    end if;
  end loop;

  return v_codes;
end;
$$;

create or replace function app.labor_today(p_uid uuid)
returns public.labor_offers
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_day  date := app.today_kst();
  v_row  public.labor_offers;
begin
  select * into v_row from public.labor_offers
   where user_id = p_uid and day = v_day;
  if found then return v_row; end if;

  insert into public.labor_offers (user_id, day, codes)
  values (p_uid, v_day, app.roll_labor(p_uid))
  on conflict (user_id, day) do nothing;

  select * into v_row from public.labor_offers
   where user_id = p_uid and day = v_day;
  return v_row;
end;
$$;


-- -------------------------------------------------------------
-- 3-1. 야간작업 — 어제 낮 작업을 한 번도 못 한 사람에게만 열린다.
--      새벽 2시부터 5시가 되기 직전까지(KST), 표 3개 중 한 번.
--      체력·보수 범위·band 는 낮과 같다. 쿨다운은 없다(한 번뿐이라).
-- -------------------------------------------------------------
create table if not exists public.labor_night (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  codes   text[] not null,
  done    text,
  done_at timestamptz,
  primary key (user_id, day)
);

-- 썰물 갯벌 굴 채취(tideflat)는 물고기잡이(fishing)로 바뀌었다. 오늘 밤 표에 이미
-- 뽑혀 있으면 물고기잡이로 옮겨 적고 행을 지운다(옛 기록은 ledger 의 code 로 남는다).
update public.labor_night
   set codes = array_replace(codes, 'tideflat', 'fishing'),
       done  = case when done = 'tideflat' then 'fishing' else done end
 where 'tideflat' = any(codes);
delete from public.labor_defs where code = 'tideflat';

create or replace function app.labor_night_is_open() returns boolean
language sql stable as $$
  select h >= app.labor_night_from() and h < app.labor_night_to()
    from (select extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;

-- app.labor_window_left() 와 같은 계산을 야간 시간대로.
create or replace function app.labor_night_window_left() returns integer
language sql stable as $$
  select greatest(0, extract(epoch from (
           case when h <  app.labor_night_from() then d + make_interval(hours => app.labor_night_from())
                when h <  app.labor_night_to()   then d + make_interval(hours => app.labor_night_to())
                else d + interval '1 day' + make_interval(hours => app.labor_night_from())
           end - t)))::int
    from (select timezone('Asia/Seoul', now()) as t,
                 date_trunc('day', timezone('Asia/Seoul', now())) as d,
                 extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;

-- 어제(KST) 낮 작업을 한 번도 하지 않았는가. 어제 표를 열어 보지도 않았으면
-- 행이 없다 — 그것도 못 한 것으로 본다.
create or replace function app.labor_night_eligible(p_uid uuid) returns boolean
language sql stable
set search_path = public, app
as $$
  select not exists (
    select 1 from public.labor_offers
     where user_id = p_uid and day = app.today_kst() - 1
       and coalesce(array_length(done, 1), 0) > 0
  );
$$;

-- 3칸, 특·극만. 칸마다 극일 확률을 따로 굴린다 — 보유 코인이
-- app.labor_rich_line() 이상이면 app.labor_night_rich_hi_chance() 로 내려가
-- 특(보수가 낮은 쪽)이 더 잘 뜬다. app.labor_poor_line() 이하면 첫 칸은
-- 극으로 고정(낮 표와 같은 규칙). 같은 code 는 겹치지 않는다.
create or replace function app.roll_labor_night(p_uid uuid)
returns text[]
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_codes text[] := array[]::text[];
  v_tier  smallint;
  v_code  text;
  v_try   integer := 0;
  v_coins integer;
  v_hi    numeric;
begin
  select coins into v_coins from public.profiles where id = p_uid;
  v_coins := coalesce(v_coins, 0);
  v_hi := case when v_coins >= app.labor_rich_line() then app.labor_night_rich_hi_chance()
               else app.labor_night_hi_chance() end;

  while coalesce(array_length(v_codes, 1), 0) < app.labor_board_size() and v_try < 300 loop
    v_try := v_try + 1;
    if coalesce(array_length(v_codes, 1), 0) = 0 and v_coins <= app.labor_poor_line() then
      v_tier := 5;
    else
      v_tier := case when random() < v_hi then 5 else 4 end;
    end if;

    v_code := null;
    select code into v_code
      from public.labor_defs
     where tier = v_tier and night and not (code = any(v_codes))
     order by random()
     limit 1;

    if v_code is not null then
      v_codes := v_codes || v_code;
    end if;
  end loop;

  return v_codes;
end;
$$;

-- 자격이 있을 때만 오늘 밤 표를 만든다. 자격이 없으면 null.
create or replace function app.labor_night_today(p_uid uuid)
returns public.labor_night
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_day date := app.today_kst();
  v_row public.labor_night;
begin
  select * into v_row from public.labor_night
   where user_id = p_uid and day = v_day;
  if found then return v_row; end if;

  if not app.labor_night_eligible(p_uid) then return null; end if;

  insert into public.labor_night (user_id, day, codes)
  values (p_uid, v_day, app.roll_labor_night(p_uid))
  on conflict (user_id, day) do nothing;

  select * into v_row from public.labor_night
   where user_id = p_uid and day = v_day;
  return v_row;
end;
$$;


-- -------------------------------------------------------------
-- 4. 조회 — 이름·설명은 클라이언트가 들고 있다. 서버는 code 와
--    끝냈는지 여부, 쿨다운만 내려준다. tier·pay 는 여기 없다.
-- -------------------------------------------------------------
create or replace function public.labor_board()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.labor_offers;
  v_night public.labor_night;
  v_nj    jsonb := null;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  v_row := app.labor_today(v_uid);

  -- 오늘 밤 몫은 그날 새벽 5시가 지나면 사라진다 — 그 뒤로는 내려보내지 않는다.
  if extract(hour from timezone('Asia/Seoul', now()))::int < app.labor_night_to() then
    v_night := app.labor_night_today(v_uid);
    if v_night.user_id is not null then
      v_nj := jsonb_build_object(
        'done', v_night.done is not null,
        'hp_cost', app.labor_night_hp_cost(),
        'open', app.labor_night_is_open(),
        'open_from', app.labor_night_from(),
        'open_to', app.labor_night_to(),
        'window_left', app.labor_night_window_left(),
        'jobs', (
          select jsonb_agg(jsonb_build_object(
                   'code', c, 'done', coalesce(c = v_night.done, false)
                 ) order by c)
            from unnest(v_night.codes) c
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'night', v_nj,
    'hp_cost', app.labor_hp_cost(),
    'done', coalesce(array_length(v_row.done, 1), 0),
    'limit', app.labor_daily_limit(),
    'cooldown_left', case when v_row.last_at is null then 0
                          else greatest(0, extract(epoch from
                            (v_row.last_at + app.labor_cooldown() - now())))::int
                     end,
    'open', app.labor_is_open(),
    'open_from', app.labor_open_from(),
    'open_to', app.labor_open_to(),
    'window_left', app.labor_window_left(),
    'jobs', (
      select jsonb_agg(jsonb_build_object(
               'code', c, 'done', (c = any(v_row.done))
             ) order by c)
        from unnest(v_row.codes) c
    )
  );
end;
$$;


-- -------------------------------------------------------------
-- 5. 실행
-- -------------------------------------------------------------
create or replace function public.labor_work(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_def   public.labor_defs;
  v_row   public.labor_offers;
  v_pay   integer;
  v_span  numeric;
  v_lo    integer;
  v_band  text;
  v_coins_after integer;
  v_item  jsonb := null;
  v_potato text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);
  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;

  select * into v_def from public.labor_defs where code = p_code;
  if not found or v_def.night then raise exception 'NOT_ON_BOARD'; end if;

  -- 오늘 배정이 있는지 먼저 보장한 뒤 잠근다 — 동시 호출로 done/last_at 이
  -- 겹쳐 쓰이지 않게.
  perform app.labor_today(v_uid);
  select * into v_row from public.labor_offers
   where user_id = v_uid and day = app.today_kst() for update;
  -- labor_today() 가 이 행을 보장했으니 못 찾을 일이 없다. 그래도 만에
  -- 하나 못 찾으면 아래 네 가드가 전부 NULL(= 거짓)로 조용히 통과해
  -- 상한 없이 보수가 나가므로, 여기서 확실히 막는다.
  if not found then raise exception 'NOT_ON_BOARD'; end if;

  if not (p_code = any(v_row.codes)) then raise exception 'NOT_ON_BOARD'; end if;
  if p_code = any(v_row.done) then raise exception 'ALREADY_WORKED'; end if;
  if coalesce(array_length(v_row.done, 1), 0) >= app.labor_daily_limit() then
    raise exception 'LABOR_DONE';
  end if;
  if not app.labor_is_open() then raise exception 'LABOR_CLOSED'; end if;
  if v_row.last_at is not null and now() < v_row.last_at + app.labor_cooldown() then
    raise exception 'LABOR_COOLDOWN';
  end if;
  -- 체력이 딱 소모량이어도 막는다 — 작업으로는 쓰러지지 않는다.
  if v_p.hp <= app.labor_hp_cost() then raise exception 'NO_HP'; end if;

  -- 여기서부터는 되돌릴 수 없다.
  -- 죽은 벌레(24_cat.sql)를 써 뒀으면 하한을 band high 경계 위로 올려 뽑는다 —
  -- 최대치 고정이 아니라 언제나 "후하게 받은" 판정이 된다.
  v_span := greatest(1, v_def.pay_max - v_def.pay_min);
  v_lo   := case when app.cat_labor_good_take(v_uid)
                 then least(v_def.pay_max, floor(v_def.pay_max - v_span / 3.0)::int + 1)
                 else v_def.pay_min end;
  v_pay  := v_lo + floor(random() * (v_def.pay_max - v_lo + 1))::int;
  v_band := case when v_pay < v_def.pay_min + v_span / 3.0 then 'low'
                 when v_pay > v_def.pay_max - v_span / 3.0 then 'high'
                 else 'mid' end;

  v_p := app.spend_hp(v_uid, app.labor_hp_cost());

  v_coins_after := v_p.coins + v_pay;
  update public.profiles set coins = v_coins_after where id = v_uid
  returning * into v_p;

  update public.labor_offers
     set done = done || p_code, last_at = now()
   where user_id = v_uid and day = app.today_kst()
  returning * into v_row;

  -- 작업 이름(한글)은 서버에 없다 — src/lib/labor.ts 의 LABOR_JOBS 가 유일한
  -- 출처다. 그래서 title 에는 code 를 그대로 남기고, 클라이언트(Record.tsx)가
  -- kind='labor' 일 때만 이 code 를 이름으로 바꿔 보여준다.
  perform app.log(v_uid, 'labor', p_code,
    v_pay, v_coins_after, jsonb_build_object('code', p_code, 'band', v_band));

  -- 농장 밭일은 app.farm_potato_chance() 확률로 고구마 하나를 챙겨 온다
  -- (밤·호박 반반). 품목 행은 17_items.sql 이 만든다.
  if p_code = 'farm' and random() < app.farm_potato_chance() then
    v_potato := case when random() < 0.5 then 'sweet_potato_chestnut'
                     else 'sweet_potato_pumpkin' end;
    insert into public.inventories (user_id, item_code, qty)
    values (v_uid, v_potato, 1)
    on conflict (user_id, item_code)
      do update set qty = inventories.qty + excluded.qty;
    select jsonb_build_object('code', d.code, 'name', d.name, 'emoji', d.emoji)
      into v_item
      from public.item_defs d where d.code = v_potato;
    -- 인벤이 바뀌었으니 상태를 다시 읽는다.
    select * into v_p from public.profiles where id = v_uid;
  end if;

  -- 축사 관리는 app.pens_milk_chance() 확률로 우유 하나를 챙겨 온다.
  -- 고구마와 같은 결, 품목 행은 17_items.sql 이 만든다.
  if p_code = 'pens' and random() < app.pens_milk_chance() then
    insert into public.inventories (user_id, item_code, qty)
    values (v_uid, 'milk', 1)
    on conflict (user_id, item_code)
      do update set qty = inventories.qty + excluded.qty;
    select jsonb_build_object('code', d.code, 'name', d.name, 'emoji', d.emoji)
      into v_item
      from public.item_defs d where d.code = 'milk';
    select * into v_p from public.profiles where id = v_uid;
  end if;

  return app.state_json(v_p) || jsonb_build_object('labor',
    jsonb_build_object(
      'code', p_code,
      'pay', v_pay,
      'band', v_band,
      'hp_cut', app.labor_hp_cost(),
      'done', array_length(v_row.done, 1),
      'cooldown_left', app.labor_cooldown_seconds(),
      'item', v_item
    ));
end;
$$;


-- -------------------------------------------------------------
-- 5-1. 야간작업 실행 — labor_work 와 같은 결. 한 번뿐이라 쿨다운이 없다.
--      체력은 app.labor_night_hp_cost(), 물고기잡이는 생선을 챙길 수 있다.
-- -------------------------------------------------------------
create or replace function public.labor_night_work(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_def   public.labor_defs;
  v_row   public.labor_night;
  v_pay   integer;
  v_span  numeric;
  v_lo    integer;
  v_band  text;
  v_coins_after integer;
  v_item  jsonb := null;
  v_fish  text;
  v_visitor text := null;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);
  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;

  select * into v_def from public.labor_defs where code = p_code and night;
  if not found then raise exception 'NOT_ON_BOARD'; end if;

  -- 오늘 밤 표가 있는지 먼저 보장한 뒤 잠근다. 자격이 없으면 표가 없다.
  perform app.labor_night_today(v_uid);
  select * into v_row from public.labor_night
   where user_id = v_uid and day = app.today_kst() for update;
  if not found then raise exception 'NIGHT_NOT_ELIGIBLE'; end if;

  if not (p_code = any(v_row.codes)) then raise exception 'NOT_ON_BOARD'; end if;
  if v_row.done is not null then raise exception 'LABOR_DONE'; end if;
  if not app.labor_night_is_open() then raise exception 'NIGHT_CLOSED'; end if;
  -- 체력이 딱 소모량이어도 막는다 — 작업으로는 쓰러지지 않는다.
  if v_p.hp <= app.labor_night_hp_cost() then raise exception 'NO_HP'; end if;

  -- 여기서부터는 되돌릴 수 없다. 죽은 벌레는 낮 작업과 같다(labor_work).
  v_span := greatest(1, v_def.pay_max - v_def.pay_min);
  v_lo   := case when app.cat_labor_good_take(v_uid)
                 then least(v_def.pay_max, floor(v_def.pay_max - v_span / 3.0)::int + 1)
                 else v_def.pay_min end;
  v_pay  := v_lo + floor(random() * (v_def.pay_max - v_lo + 1))::int;
  v_band := case when v_pay < v_def.pay_min + v_span / 3.0 then 'low'
                 when v_pay > v_def.pay_max - v_span / 3.0 then 'high'
                 else 'mid' end;

  -- 공중변소 청소를 후하게 받으면 결과 문구에 "밤에 온 ○○" 이 붙는다. 숨긴
  -- 계정·본인·app.latrine_excluded_names() 를 뺀 수감자 중 하나. 화면에만 쓴다.
  if p_code = 'latrine' and v_band = 'high' then
    select username into v_visitor from public.profiles
     where not hidden and id <> v_uid
       and username <> all(app.latrine_excluded_names())
     order by random() limit 1;
  end if;

  v_p := app.spend_hp(v_uid, app.labor_night_hp_cost());

  v_coins_after := v_p.coins + v_pay;
  update public.profiles set coins = v_coins_after where id = v_uid
  returning * into v_p;

  update public.labor_night
     set done = p_code, done_at = now()
   where user_id = v_uid and day = app.today_kst();

  -- 기록 화면이 낮 작업과 똑같이 code 를 이름으로 바꿔 보여준다.
  perform app.log(v_uid, 'labor', p_code,
    v_pay, v_coins_after, jsonb_build_object('code', p_code, 'band', v_band, 'night', true));

  -- 물고기잡이는 app.fishing_fish_chance() 확률로 생선 하나를 챙겨 온다
  -- (고등어·전갱이 반반). 농장 고구마와 같은 결, 품목 행은 17_items.sql 이 만든다.
  if p_code = 'fishing' and random() < app.fishing_fish_chance() then
    v_fish := case when random() < 0.5 then 'fish_mackerel'
                   else 'fish_horse_mackerel' end;
    insert into public.inventories (user_id, item_code, qty)
    values (v_uid, v_fish, 1)
    on conflict (user_id, item_code)
      do update set qty = inventories.qty + excluded.qty;
    select jsonb_build_object('code', d.code, 'name', d.name, 'emoji', d.emoji)
      into v_item
      from public.item_defs d where d.code = v_fish;
    -- 인벤이 바뀌었으니 상태를 다시 읽는다.
    select * into v_p from public.profiles where id = v_uid;
  end if;

  return app.state_json(v_p) || jsonb_build_object('labor',
    jsonb_build_object(
      'code', p_code,
      'pay', v_pay,
      'band', v_band,
      'hp_cut', app.labor_night_hp_cost(),
      'done', 1,
      'cooldown_left', 0,
      'night', true,
      'item', v_item,
      'visitor', v_visitor
    ));
end;
$$;


-- -------------------------------------------------------------
-- 6. 권한
-- -------------------------------------------------------------
alter table public.labor_defs   enable row level security;
alter table public.labor_offers enable row level security;
alter table public.labor_night  enable row level security;
-- 정책을 만들지 않는다 — labor_board()/labor_work() 로만 나간다.
-- (cells 테이블과 같은 처리, 02_schema.sql 18절 참고)

revoke all on function app.roll_labor(uuid)           from public, anon, authenticated;
revoke all on function app.roll_labor_tier()           from public, anon, authenticated;
revoke all on function app.labor_today(uuid)          from public, anon, authenticated;
revoke all on function app.labor_hp_cost()            from public, anon, authenticated;
revoke all on function app.labor_daily_limit()        from public, anon, authenticated;
revoke all on function app.labor_cooldown()           from public, anon, authenticated;
revoke all on function app.labor_cooldown_seconds()   from public, anon, authenticated;
revoke all on function app.labor_board_size()         from public, anon, authenticated;
revoke all on function app.labor_open_from()          from public, anon, authenticated;
revoke all on function app.labor_open_to()             from public, anon, authenticated;
revoke all on function app.labor_is_open()             from public, anon, authenticated;
revoke all on function app.labor_window_left()         from public, anon, authenticated;

revoke all on function app.labor_night_is_open()      from public, anon, authenticated;
revoke all on function app.labor_night_window_left()  from public, anon, authenticated;
revoke all on function app.labor_night_eligible(uuid) from public, anon, authenticated;
revoke all on function app.roll_labor_night(uuid)     from public, anon, authenticated;
revoke all on function app.labor_night_today(uuid)    from public, anon, authenticated;
revoke all on function app.latrine_excluded_names()   from public, anon, authenticated;

revoke all on function public.labor_board()  from public;
revoke all on function public.labor_work(text) from public;
revoke all on function public.labor_night_work(text) from public;

grant execute on function public.labor_board()   to authenticated;
grant execute on function public.labor_work(text) to authenticated;
grant execute on function public.labor_night_work(text) to authenticated;

commit;
