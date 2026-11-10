-- missions — 일일 미션
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.labor_night (
    user_id uuid NOT NULL,
    day date NOT NULL,
    codes text[] NOT NULL,
    done text,
    done_at timestamp with time zone
);

CREATE TABLE public.labor_offers (
    user_id uuid NOT NULL,
    day date NOT NULL,
    codes text[] NOT NULL,
    done text[] DEFAULT '{}'::text[] NOT NULL,
    last_at timestamp with time zone
);

CREATE TABLE public.labor_defs (
    code text NOT NULL,
    tier smallint NOT NULL,
    pay_min integer NOT NULL,
    pay_max integer NOT NULL,
    night boolean DEFAULT false NOT NULL,
    CONSTRAINT labor_defs_check CHECK ((pay_max >= pay_min)),
    CONSTRAINT labor_defs_pay_min_check CHECK ((pay_min > 0)),
    CONSTRAINT labor_defs_tier_check CHECK (((tier >= 1) AND (tier <= 5)))
);

ALTER TABLE ONLY public.labor_defs
    ADD CONSTRAINT labor_defs_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.labor_night
    ADD CONSTRAINT labor_night_pkey PRIMARY KEY (user_id, day);

ALTER TABLE ONLY public.labor_offers
    ADD CONSTRAINT labor_offers_pkey PRIMARY KEY (user_id, day);

ALTER TABLE ONLY public.labor_night
    ADD CONSTRAINT labor_night_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.labor_offers
    ADD CONSTRAINT labor_offers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.labor_defs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.labor_night ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.labor_offers ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.farm_potato_chance() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.5 $$;

CREATE FUNCTION app.fishing_fish_chance() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.5 $$;

CREATE FUNCTION app.labor_board_size() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.labor_cooldown() RETURNS interval
    LANGUAGE sql IMMUTABLE
    AS $$ select interval '2 hours' $$;

CREATE FUNCTION app.labor_cooldown_seconds() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    select extract(epoch from app.labor_cooldown())::int
  $$;

CREATE FUNCTION app.labor_daily_limit() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 2 $$;

CREATE FUNCTION app.labor_hp_cost() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 10 $$;

CREATE FUNCTION app.labor_is_open() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select h >= app.labor_open_from() and h < app.labor_open_to()
    from (select extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;

CREATE FUNCTION app.labor_night_eligible(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'app'
    AS $$
  select not exists (
    select 1 from public.labor_offers
     where user_id = p_uid and day = app.today_kst() - 1
       and coalesce(array_length(done, 1), 0) > 0
  );
$$;

CREATE FUNCTION app.labor_night_from() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 2 $$;

CREATE FUNCTION app.labor_night_hi_chance() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.40 $$;

CREATE FUNCTION app.labor_night_hp_cost() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 35 $$;

CREATE FUNCTION app.labor_night_is_open() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select h >= app.labor_night_from() and h < app.labor_night_to()
    from (select extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;

CREATE FUNCTION app.labor_night_rich_hi_chance() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.15 $$;

CREATE FUNCTION app.labor_night_to() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 5 $$;

CREATE FUNCTION app.labor_night_today(p_uid uuid) RETURNS public.labor_night
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION app.labor_night_window_left() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  select greatest(0, extract(epoch from (
           case when h <  app.labor_night_from() then d + make_interval(hours => app.labor_night_from())
                when h <  app.labor_night_to()   then d + make_interval(hours => app.labor_night_to())
                else d + interval '1 day' + make_interval(hours => app.labor_night_from())
           end - t)))::int
    from (select timezone('Asia/Seoul', now()) as t,
                 date_trunc('day', timezone('Asia/Seoul', now())) as d,
                 extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;

CREATE FUNCTION app.labor_open_from() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 13 $$;

CREATE FUNCTION app.labor_open_to() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 19 $$;

CREATE FUNCTION app.labor_poor_line() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 200 $$;

CREATE FUNCTION app.labor_rich_line() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 1200 $$;

CREATE FUNCTION app.labor_today(p_uid uuid) RETURNS public.labor_offers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION app.labor_window_left() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  select greatest(0, extract(epoch from (
           case when h <  app.labor_open_from() then d + make_interval(hours => app.labor_open_from())
                when h <  app.labor_open_to()   then d + make_interval(hours => app.labor_open_to())
                else d + interval '1 day' + make_interval(hours => app.labor_open_from())
           end - t)))::int
    from (select timezone('Asia/Seoul', now()) as t,
                 date_trunc('day', timezone('Asia/Seoul', now())) as d,
                 extract(hour from timezone('Asia/Seoul', now()))::int as h) s;
$$;

CREATE FUNCTION app.latrine_excluded_names() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$ select array['강건우','신도혁','최형욱','서진우'] $$;

CREATE FUNCTION app.pens_milk_chance() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.5 $$;

CREATE FUNCTION app.roll_labor(p_uid uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION app.roll_labor_night(p_uid uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION app.roll_labor_tier() RETURNS smallint
    LANGUAGE sql
    AS $$
  select case
           when r < 0.35 then 1
           when r < 0.65 then 2
           when r < 0.87 then 3
           else 4
         end
    from (select random() as r) s;
$$;

CREATE FUNCTION public.labor_board() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.labor_night_work(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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
  -- 에너지가 딱 소모량이어도 막는다 — 미션으로는 바닥나지 않는다.
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
  -- 계정·본인·app.latrine_excluded_names() 를 뺀 플레이어 중 하나. 화면에만 쓴다.
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

CREATE FUNCTION public.labor_work(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

  -- 오늘 미션 목록이 있는지 먼저 보장한 뒤 잠근다 — 동시 호출로 done/last_at 이
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
  -- 에너지가 딱 소모량이어도 막는다 — 미션으로는 바닥나지 않는다.
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

  -- 목장 관리는 app.pens_milk_chance() 확률로 우유 하나를 챙겨 온다.
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

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.labor_board_size() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_cooldown() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_cooldown_seconds() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_daily_limit() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_hp_cost() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_is_open() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_night_eligible(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_night_is_open() FROM PUBLIC;

GRANT ALL ON TABLE public.labor_night TO anon;
GRANT ALL ON TABLE public.labor_night TO authenticated;
GRANT ALL ON TABLE public.labor_night TO service_role;

REVOKE ALL ON FUNCTION app.labor_night_today(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_night_window_left() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_open_from() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_open_to() FROM PUBLIC;

GRANT ALL ON TABLE public.labor_offers TO anon;
GRANT ALL ON TABLE public.labor_offers TO authenticated;
GRANT ALL ON TABLE public.labor_offers TO service_role;

REVOKE ALL ON FUNCTION app.labor_today(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.labor_window_left() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.latrine_excluded_names() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.roll_labor(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.roll_labor_night(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.roll_labor_tier() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.labor_board() FROM PUBLIC;
GRANT ALL ON FUNCTION public.labor_board() TO anon;
GRANT ALL ON FUNCTION public.labor_board() TO authenticated;
GRANT ALL ON FUNCTION public.labor_board() TO service_role;

REVOKE ALL ON FUNCTION public.labor_night_work(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.labor_night_work(p_code text) TO anon;
GRANT ALL ON FUNCTION public.labor_night_work(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.labor_night_work(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.labor_work(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.labor_work(p_code text) TO anon;
GRANT ALL ON FUNCTION public.labor_work(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.labor_work(p_code text) TO service_role;

GRANT ALL ON TABLE public.labor_defs TO anon;
GRANT ALL ON TABLE public.labor_defs TO authenticated;
GRANT ALL ON TABLE public.labor_defs TO service_role;
