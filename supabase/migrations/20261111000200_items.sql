-- items — 아이템 카탈로그 · 인벤토리 · 상점 · 아이템 사용 · 도시락
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.inventories (
    user_id uuid NOT NULL,
    item_code text NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    gifted_qty integer DEFAULT 0 NOT NULL,
    open_left integer DEFAULT 0 NOT NULL,
    open_gifted boolean DEFAULT false NOT NULL,
    gift_from uuid,
    CONSTRAINT inventories_gifted_check CHECK (((gifted_qty >= 0) AND (gifted_qty <= qty))),
    CONSTRAINT inventories_open_left_check CHECK ((open_left >= 0)),
    CONSTRAINT inventories_qty_check CHECK ((qty >= 0))
);

CREATE TABLE public.item_defs (
    code text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'food'::text NOT NULL,
    grade text DEFAULT 'common'::text NOT NULL,
    emoji text DEFAULT '📦'::text NOT NULL,
    heal integer DEFAULT 0 NOT NULL,
    plays integer DEFAULT 0 NOT NULL,
    ward_cut integer DEFAULT 0 NOT NULL,
    win_double integer DEFAULT 0 NOT NULL,
    buy_price integer,
    sell_price integer,
    tradable boolean DEFAULT true NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    flex_kind text,
    flex_hours integer DEFAULT 0 NOT NULL,
    flex_text text,
    flex_text_gift text,
    flex_text_with text,
    uses integer DEFAULT 1 NOT NULL,
    stake_bonus integer DEFAULT 0 NOT NULL,
    CONSTRAINT item_flex_kind_check CHECK (((flex_kind IS NULL) OR (flex_kind = ANY (ARRAY['consume'::text, 'wear'::text])))),
    CONSTRAINT item_grade_check CHECK ((grade = ANY (ARRAY['common'::text, 'uncommon'::text, 'rare'::text, 'epic'::text, 'legendary'::text]))),
    CONSTRAINT item_price_check CHECK ((((buy_price IS NULL) OR (buy_price >= 0)) AND ((sell_price IS NULL) OR (sell_price >= 0)))),
    CONSTRAINT item_uses_check CHECK ((uses >= 1))
);

CREATE TABLE public.player_flex (
    user_id uuid NOT NULL,
    item_code text NOT NULL,
    gifted boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    together boolean DEFAULT false NOT NULL,
    stack integer DEFAULT 1 NOT NULL,
    gift_from uuid,
    CONSTRAINT player_flex_stack_check CHECK ((stack >= 1))
);

CREATE TABLE public.shop_offers (
    user_id uuid NOT NULL,
    day date NOT NULL,
    codes text[] NOT NULL,
    bought jsonb DEFAULT '{}'::jsonb NOT NULL,
    clover_price integer
);

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_pkey PRIMARY KEY (user_id, item_code);

ALTER TABLE ONLY public.item_defs
    ADD CONSTRAINT item_defs_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.player_flex
    ADD CONSTRAINT player_flex_pkey PRIMARY KEY (user_id, item_code);

ALTER TABLE ONLY public.shop_offers
    ADD CONSTRAINT shop_offers_pkey PRIMARY KEY (user_id, day);

CREATE INDEX inventories_user_idx ON public.inventories USING btree (user_id);

CREATE INDEX player_flex_user_idx ON public.player_flex USING btree (user_id);

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_gift_from_fkey FOREIGN KEY (gift_from) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_item_code_fkey FOREIGN KEY (item_code) REFERENCES public.item_defs(code) ON DELETE CASCADE;

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.player_flex
    ADD CONSTRAINT player_flex_gift_from_fkey FOREIGN KEY (gift_from) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.player_flex
    ADD CONSTRAINT player_flex_item_code_fkey FOREIGN KEY (item_code) REFERENCES public.item_defs(code) ON DELETE CASCADE;

ALTER TABLE ONLY public.player_flex
    ADD CONSTRAINT player_flex_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shop_offers
    ADD CONSTRAINT shop_offers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.inventories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.item_defs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_flex ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shop_offers ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.clean_items(p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_out jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'qty', qty)
                            order by code), '[]'::jsonb)
    into v_out
    from (
      select e->>'code' as code, sum((e->>'qty')::int) as qty
        from jsonb_array_elements(p_items) e
       where (e->>'qty')::int > 0
       group by e->>'code'
    ) s;

  return v_out;
end;
$$;

CREATE FUNCTION app.clover_cheap_line() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 100 $$;

CREATE FUNCTION app.clover_daily_cap() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 1 $$;

CREATE FUNCTION app.clover_poor_line() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 200 $$;

CREATE FUNCTION app.clover_price(p_coins integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    select case when coalesce(p_coins, 0) <= app.clover_cheap_line() then 100
                when coalesce(p_coins, 0) <= app.clover_poor_line()  then 150
           end
  $$;

CREATE FUNCTION app.clover_rich_cut() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 500 $$;

CREATE FUNCTION app.describe_items(p_items jsonb) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', d.code, 'name', d.name, 'emoji', d.emoji,
           'grade', d.grade, 'qty', (e->>'qty')::int) order by d.sort_order), '[]'::jsonb)
    from jsonb_array_elements(p_items) e
    join public.item_defs d on d.code = e->>'code';
$$;

CREATE FUNCTION app.flex_apply(p_uid uuid, p_code text, p_gifted boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_def   public.item_defs;
  v_count integer;
begin
  select * into v_def from public.item_defs where code = p_code;
  if v_def.flex_kind is distinct from 'consume' then return; end if;

  select count(*) into v_count
    from public.player_flex f
    join public.item_defs d on d.code = f.item_code
   where f.user_id = p_uid and d.flex_kind = 'consume' and f.item_code <> p_code;

  if v_count >= app.flex_consume_limit() then
    delete from public.player_flex
     where user_id = p_uid and item_code = (
       select f.item_code from public.player_flex f
         join public.item_defs d on d.code = f.item_code
        where f.user_id = p_uid and d.flex_kind = 'consume' and f.item_code <> p_code
        order by f.started_at asc
        limit 1
     );
  end if;

  insert into public.player_flex (user_id, item_code, gifted, expires_at, started_at)
  values (p_uid, p_code, p_gifted, now() + make_interval(hours => v_def.flex_hours), now())
  on conflict (user_id, item_code) do update
     set gifted     = excluded.gifted,
         together   = false,
         expires_at = least(
                        greatest(player_flex.expires_at, now()) + make_interval(hours => v_def.flex_hours),
                        now() + make_interval(hours => v_def.flex_hours * 2)
                      );
end;
$$;

CREATE FUNCTION app.flex_consume_limit() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 10 $$;

CREATE FUNCTION app.flex_render(p_text text, p_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select replace(replace(p_text, '{giver}', coalesce(p_name, '누군가')),
                 '{이/가}',
                 case when ascii(right(coalesce(p_name, '누군가'), 1)) between 44032 and 55203
                       and (ascii(right(coalesce(p_name, '누군가'), 1)) - 44032) % 28 > 0
                      then '이' else '가' end);
$$;

CREATE FUNCTION app.flex_wear_limit() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 10 $$;

CREATE FUNCTION app.gear_codes() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$ select array['dumbbell', 'hand_gripper', 'harmonica', 'recorder'] $$;

CREATE FUNCTION app.has_food(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1
      from public.inventories i
      join public.item_defs d on d.code = i.item_code
     where i.user_id = p_uid and i.qty > 0 and d.heal > 0
  );
$$;

CREATE FUNCTION app.has_lighter(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from public.inventories i
     where i.user_id = p_uid and i.qty > 0
       and i.item_code in ('lighter_old', 'lighter_ag', 'lighter_au')
  );
$$;

CREATE FUNCTION app.meal_backfill_days() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.meal_item() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select 'lunchbox' $$;

CREATE FUNCTION app.meal_item_at(p_slot timestamp with time zone) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    select case when (timezone('Asia/Seoul', p_slot))::date = app.special_meal_date()
                then app.special_meal_item()
                else app.meal_item() end
  $$;

CREATE FUNCTION app.meal_slots(p_from timestamp with time zone, p_to timestamp with time zone) RETURNS SETOF timestamp with time zone
    LANGUAGE sql STABLE
    AS $$
  select slot
    from (
      select ((d::date + t) at time zone 'Asia/Seoul') as slot
        from generate_series(
               (timezone('Asia/Seoul', p_from))::date,
               (timezone('Asia/Seoul', p_to))::date,
               interval '1 day') d,
             unnest(app.meal_times()) t
    ) s
   where slot > p_from and slot <= p_to
   order by slot;
$$;

CREATE FUNCTION app.meal_times() RETURNS time without time zone[]
    LANGUAGE sql IMMUTABLE
    AS $$ select array['08:00', '12:00', '19:00']::time[] $$;

CREATE FUNCTION app.move_items(p_from uuid, p_to uuid, p_items jsonb, p_gift boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  e     jsonb;
  v_qty integer;
begin
  for e in select * from jsonb_array_elements(p_items) loop
    v_qty := (e->>'qty')::int;

    update public.inventories
       set qty = qty - v_qty,
           gifted_qty = greatest(0, least(gifted_qty, qty - v_qty))
     where user_id = p_from and item_code = e->>'code';

    -- 선물이면 준 사람을 덮어쓴다(가장 최근에 준 사람). 문구의 {giver} 가 이 이름이 된다.
    insert into public.inventories (user_id, item_code, qty, gifted_qty, gift_from)
    values (p_to,
            e->>'code',
            v_qty, case when p_gift then v_qty else 0 end,
            case when p_gift then p_from end)
    on conflict (user_id, item_code)
      do update set qty        = inventories.qty + excluded.qty,
                    gifted_qty = inventories.gifted_qty
                                 + (case when p_gift then v_qty else 0 end),
                    gift_from  = case when p_gift then p_from else inventories.gift_from end;
  end loop;
end;
$$;

CREATE FUNCTION app.roll_shop(p_uid uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_codes text[] := array[]::text[];
  v_have  integer := 0;
  v_grade text;
  v_code  text;
  v_try   integer;
  v_ward     boolean;
  v_boost    boolean;
  v_coins    integer;
begin
  select (ward_until is not null), coins
    into v_ward, v_coins
    from public.profiles where id = p_uid;
  v_boost := coalesce(v_ward, false);
  v_coins := coalesce(v_coins, 0);

  -- 앞의 네 칸은 보통 표, 마지막 한 칸만 다른 표를 쓴다.
  v_try := 0;
  while v_have < app.shop_size() - 1 and v_try < 300 loop
    v_try := v_try + 1;
    v_grade := app.roll_grade(false, v_boost);

    -- 상점에는 식량·회복 아이템·부적만 올라온다.
    -- 휴식 중이면 휴식 해제권 쪽으로 후보 선택을 당긴다(보장은 아니다).
    -- 네잎클로버는 가진 코인이 적은 사람에게만 오르고, 더 적으면 그쪽으로 당긴다
    -- (app.clover_* — 화면에는 드러내지 않는다).
    select code into v_code
      from public.item_defs
     where grade = v_grade and buy_price is not null
       and kind in ('food', 'medicine', 'charm')
       and not (code = any(v_codes))
       and (code <> 'clover' or v_coins <= app.clover_rich_cut())
     order by case when (v_ward and code = 'discharge')
                       or (v_coins <= app.clover_poor_line() and code = 'clover')
                   then random() * 0.1 else random() end
     limit 1;

    if v_code is not null then
      v_codes := v_codes || v_code;
      v_have  := v_have + 1;
    end if;
  end loop;

  v_try := 0;
  while v_have < app.shop_size() and v_try < 300 loop
    v_try := v_try + 1;
    v_grade := app.roll_grade(true, v_boost);

    select code into v_code
      from public.item_defs
     where grade = v_grade and buy_price is not null
       and kind in ('food', 'medicine', 'charm')
       and not (code = any(v_codes))
       and (code <> 'clover' or v_coins <= app.clover_rich_cut())
     order by case when (v_ward and code = 'discharge')
                       or (v_coins <= app.clover_poor_line() and code = 'clover')
                   then random() * 0.1 else random() end
     limit 1;

    if v_code is not null then
      v_codes := v_codes || v_code;
      v_have  := v_have + 1;
    end if;
  end loop;

  return v_codes;
end;
$$;

CREATE FUNCTION app.shop_daily_cap() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.shop_item_cap(p_code text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    select case when p_code = 'clover' then app.clover_daily_cap() else app.shop_daily_cap() end
  $$;

CREATE FUNCTION app.shop_size() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 5 $$;

CREATE FUNCTION app.shop_today(p_uid uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_day   date := app.today_kst();
  v_codes text[];
begin
  select codes into v_codes
    from public.shop_offers where user_id = p_uid and day = v_day;
  if v_codes is not null then return v_codes; end if;

  -- 네잎클로버 할인가도 목록과 같은 순간의 보유 코인으로 정해 둔다.
  insert into public.shop_offers (user_id, day, codes, clover_price)
  select p_uid, v_day, app.roll_shop(p_uid), app.clover_price(p.coins)
    from public.profiles p where p.id = p_uid
  on conflict (user_id, day) do nothing;

  select codes into v_codes
    from public.shop_offers where user_id = p_uid and day = v_day;
  return v_codes;
end;
$$;

CREATE FUNCTION app.special_meal_date() RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$ select date '2026-09-18' $$;

CREATE FUNCTION app.special_meal_item() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select 'lunchbox_special' $$;

CREATE FUNCTION app.take_one_item(p_uid uuid, p_code text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_qty        integer;
  v_gifted_qty integer;
  v_gifted     boolean;
begin
  select qty, gifted_qty into v_qty, v_gifted_qty
    from public.inventories
   where user_id = p_uid and item_code = p_code for update;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  v_gifted := coalesce(v_gifted_qty, 0) > 0;

  -- 선물 받은 몫(gifted_qty)을 먼저 쓴다.
  update public.inventories
     set qty = qty - 1,
         gifted_qty = gifted_qty - (case when v_gifted then 1 else 0 end)
   where user_id = p_uid and item_code = p_code;

  return v_gifted;
end;
$$;

CREATE FUNCTION public.buy_item(p_code text, p_qty integer DEFAULT 1) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_def   public.item_defs;
  v_offer public.shop_offers;
  v_had   integer;
  v_price integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_qty is null or p_qty < 1 then raise exception 'INVALID_QTY'; end if;

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.buy_price is null then raise exception 'NOT_BUYABLE'; end if;

  -- 오퍼 행이 있는지 먼저 보장한 뒤 잠근다 — 동시 구매로 bought 갱신이 겹쳐 쓰이지 않게.
  perform app.shop_today(v_uid);
  select * into v_offer from public.shop_offers
   where user_id = v_uid and day = app.today_kst() for update;

  -- 오늘 상점에 올라온 물건만 살 수 있다.
  if not (p_code = any(v_offer.codes)) then raise exception 'NOT_IN_SHOP'; end if;

  v_had := coalesce((v_offer.bought->>p_code)::int, 0);
  if v_had + p_qty > app.shop_item_cap(p_code) then raise exception 'DAILY_ITEM_CAP'; end if;

  -- 네잎클로버는 목록이 뽑힐 때 정해진 할인가(shop_offers.clover_price)가 있으면 그 값.
  v_price := case when p_code = 'clover' then coalesce(v_offer.clover_price, v_def.buy_price)
                  else v_def.buy_price end;

  if v_p.coins < v_price * p_qty then raise exception 'NOT_ENOUGH_COINS'; end if;

  update public.profiles set coins = coins - v_price * p_qty
   where id = v_uid
  returning * into v_p;

  insert into public.inventories (user_id, item_code, qty)
  values (v_uid, p_code, p_qty)
  on conflict (user_id, item_code)
    do update set qty = inventories.qty + excluded.qty;

  update public.shop_offers
     set bought = bought || jsonb_build_object(p_code, v_had + p_qty)
   where user_id = v_uid and day = app.today_kst();

  perform app.log(v_uid, 'shop',
    format('%s %s개 구매', v_def.name, p_qty),
    -v_price * p_qty, v_p.coins,
    jsonb_build_object('code', p_code, 'qty', p_qty));

  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.flex_equip(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid        uuid := auth.uid();
  v_p          public.profiles;
  v_def        public.item_defs;
  v_qty        integer;
  v_gifted_qty integer;
  v_gift_from  uuid;
  v_count      integer;
  v_stack      integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.flex_kind is distinct from 'wear' then raise exception 'NOT_FLEX'; end if;

  select qty, gifted_qty, gift_from
    into v_qty, v_gifted_qty, v_gift_from
    from public.inventories
   where user_id = v_uid and item_code = p_code for update;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 같은 물건도 가진 수량까지 겹쳐 장착할 수 있다(player_flex.stack).
  -- 이미 가진 만큼 다 장착했으면 더 낄 것이 없다.
  select stack into v_stack from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at is null;
  if coalesce(v_stack, 0) >= v_qty then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 겹쳐 장착한 것도 그 수만큼 칸을 차지한다.
  select coalesce(sum(f.stack), 0) into v_count from public.player_flex f
    join public.item_defs d on d.code = f.item_code
   where f.user_id = v_uid and d.flex_kind = 'wear';
  if v_count >= app.flex_wear_limit() then raise exception 'FLEX_LIMIT'; end if;

  if v_stack is not null then
    -- 문구(받은 …)는 처음 장착할 때 정한 것을 그대로 쓴다.
    update public.player_flex set stack = stack + 1
     where user_id = v_uid and item_code = p_code and expires_at is null;
  else
    -- 선물 받은 몫이 있으면 "받은 …" 문구를 고르고, 준 사람(gift_from)도
    -- 함께 옮겨 문구의 {giver} 자리에 쓴다.
    insert into public.player_flex (user_id, item_code, gifted, gift_from, expires_at, started_at)
    values (v_uid, p_code,
            coalesce(v_gifted_qty, 0) > 0,
            case when coalesce(v_gifted_qty, 0) > 0 then v_gift_from end,
            null, now());
  end if;

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.flex_unequip(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
  v_def public.item_defs;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 겹쳐 장착한 것이면 하나만 벗는다.
  update public.player_flex set stack = stack - 1
   where user_id = v_uid and item_code = p_code and expires_at is null and stack > 1;
  if found then
    v_p := app.accrue(v_uid);
    return app.state_json(v_p);
  end if;

  delete from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at is null;
  if not found then raise exception 'NOT_EQUIPPED'; end if;

  v_p := app.accrue(v_uid);
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.flex_use(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid         uuid := auth.uid();
  v_p           public.profiles;
  v_def         public.item_defs;
  v_gifted      boolean;
  v_left        integer;
  v_open_gifted boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.flex_kind is distinct from 'consume' then raise exception 'NOT_FLEX'; end if;
  if v_def.heal > 0 or v_def.plays > 0 or v_def.ward_cut > 0
     or v_def.win_double > 0 then
    raise exception 'NOT_FLEX';
  end if;

  -- uses > 1 인 물건은 처음 한 번만 포장을 뜯어 qty 를 줄이고,
  -- 남은 횟수는 open_left 에서 빠진다. uses = 1 이면 open_left 가 항상 0 이라
  -- 매번 else 분기를 타 예전과 완전히 같은 동작을 한다.
  select open_left, open_gifted into v_left, v_open_gifted
    from public.inventories
   where user_id = v_uid and item_code = p_code for update;

  if coalesce(v_left, 0) > 0 then
    v_gifted := coalesce(v_open_gifted, false);
    v_left := v_left - 1;
  else
    v_gifted := app.take_one_item(v_uid, p_code);
    v_left := greatest(0, v_def.uses - 1);
    v_open_gifted := v_gifted;
  end if;

  update public.inventories
     set open_left = v_left,
         open_gifted = (v_left > 0 and v_open_gifted)
   where user_id = v_uid and item_code = p_code;

  perform app.flex_apply(v_uid, p_code, v_gifted);

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.gear_off(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  if p_code is null or not (p_code = any(app.gear_codes())) then
    raise exception 'NO_SUCH_ITEM';
  end if;

  delete from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at > now();
  if not found then raise exception 'NOT_EQUIPPED'; end if;

  v_p := app.accrue(v_uid);
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.gear_on(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_qty    integer;
  v_gifted integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  if p_code is null or not (p_code = any(app.gear_codes())) then
    raise exception 'NO_SUCH_ITEM';
  end if;

  select qty, gifted_qty into v_qty, v_gifted
    from public.inventories
   where user_id = v_uid and item_code = p_code;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 이미 착용 중이면 화면에는 `해제` 만 뜬다 — 두 번 눌려 시간이 늘어나지 않게 막는다.
  if exists (select 1 from public.player_flex
              where user_id = v_uid and item_code = p_code and expires_at > now()) then
    raise exception 'GEAR_ACTIVE';
  end if;

  perform app.flex_apply(v_uid, p_code, coalesce(v_gifted, 0) > 0);

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.mix_item(p_code text, p_with text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_to     text;
  v_gifted boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  if p_code is distinct from 'milk' then raise exception 'NOT_MIXABLE'; end if;
  v_to := case p_with when 'instant_coffee' then 'cafe_latte'
                      when 'ice_coffee'     then 'iced_latte'
                      when 'rooibos_tea'    then 'milk_tea' end;
  if v_to is null then raise exception 'NOT_MIXABLE'; end if;

  -- 어느 쪽이든 없으면 NOT_ENOUGH_ITEMS 로 막히고 트랜잭션째 되돌려진다.
  perform app.take_one_item(v_uid, p_with);
  v_gifted := app.take_one_item(v_uid, p_code);

  insert into public.inventories (user_id, item_code, qty, gifted_qty)
  values (v_uid, v_to, 1, case when v_gifted then 1 else 0 end)
  on conflict (user_id, item_code)
    do update set qty        = inventories.qty + excluded.qty,
                  gifted_qty = inventories.gifted_qty + excluded.gifted_qty;

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.radio_on(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_qty    integer;
  v_gifted integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  if p_code is distinct from 'radio' then raise exception 'NO_SUCH_ITEM'; end if;

  select qty, gifted_qty into v_qty, v_gifted
    from public.inventories
   where user_id = v_uid and item_code = p_code;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  perform app.flex_apply(v_uid, p_code, coalesce(v_gifted, 0) > 0);

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.roast_item(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_to     text;
  v_gifted boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  v_to := case p_code when 'sweet_potato_chestnut' then 'roast_potato_chestnut'
                      when 'sweet_potato_pumpkin'  then 'roast_potato_pumpkin'
                      when 'fish_mackerel'         then 'roast_fish_mackerel'
                      when 'fish_horse_mackerel'   then 'roast_fish_horse_mackerel' end;
  if v_to is null then raise exception 'NOT_ROASTABLE'; end if;
  if not app.has_lighter(v_uid) then raise exception 'NEED_LIGHTER'; end if;

  v_gifted := app.take_one_item(v_uid, p_code);

  insert into public.inventories (user_id, item_code, qty, gifted_qty)
  values (v_uid, v_to, 1, case when v_gifted then 1 else 0 end)
  on conflict (user_id, item_code)
    do update set qty        = inventories.qty + excluded.qty,
                  gifted_qty = inventories.gifted_qty + excluded.gifted_qty;

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.sell_item(p_code text, p_qty integer DEFAULT 1) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_def    public.item_defs;
  v_qty    integer;
  v_locked integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_qty is null or p_qty < 1 then raise exception 'INVALID_QTY'; end if;

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.sell_price is null then raise exception 'NOT_SELLABLE'; end if;

  select qty into v_qty from public.inventories
   where user_id = v_uid and item_code = p_code for update;
  if coalesce(v_qty, 0) < p_qty then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 장착 중인 몫(겹쳐 장착한 수 전부)은 팔 수 없다(해제 후 다시 시도).
  select coalesce(sum(stack), 0) into v_locked from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at is null;
  if v_qty - v_locked < p_qty then raise exception 'EQUIPPED_LOCKED'; end if;

  update public.inventories
     set qty = qty - p_qty,
         gifted_qty = least(gifted_qty, qty - p_qty)
   where user_id = v_uid and item_code = p_code;

  update public.profiles set coins = coins + v_def.sell_price * p_qty
   where id = v_uid
  returning * into v_p;

  perform app.log(v_uid, 'shop',
    format('%s %s개 판매', v_def.name, p_qty),
    v_def.sell_price * p_qty, v_p.coins,
    jsonb_build_object('code', p_code, 'qty', p_qty));

  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.shop_catalog() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_codes  text[];
  v_bought jsonb;
  v_clover integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  v_codes := app.shop_today(v_uid);

  select bought, clover_price into v_bought, v_clover from public.shop_offers
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
             'bought', coalesce((coalesce(v_bought, '{}'::jsonb)->>code)::int, 0)
           ) order by sort_order, code)
      from public.item_defs
     where code = any(v_codes) and buy_price is not null), '[]'::jsonb);
end;
$$;

CREATE FUNCTION public.use_item(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_def    public.item_defs;
  v_gained integer;
  v_headroom integer;
  v_ward   timestamptz;
  v_gifted boolean;
  v_hp_before integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  -- 장착형(라이터·반지 등)은 use_item 이 아니라 flex_equip/flex_unequip 으로 쓴다.
  -- heal/plays/ward_cut/win_double/stake_bonus 가 전부 0 인 물건은 여기서 NOT_USABLE.
  if v_def.heal <= 0 and v_def.plays <= 0 and v_def.ward_cut <= 0
     and v_def.win_double <= 0 and v_def.stake_bonus <= 0 then
    raise exception 'NOT_USABLE';
  end if;

  if v_def.ward_cut > 0 then
    -- 휴식을 줄이는 물건은 휴식 중일 때만 쓸 수 있다.
    if v_p.ward_until is null then raise exception 'NOT_IN_WARD'; end if;
  else
    -- 나머지는 휴식 중에 쓸 수 없다. 휴식 시간을 다 채워야 끝난다.
    if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;
  end if;

  -- 네잎클로버는 한 번에 하나 — 켜진 동안 또 쓰면 막는다(겹쳐 얹히지 않는다).
  if v_def.stake_bonus > 0 and v_p.stake_boost_until > now() then
    raise exception 'LUCK_ACTIVE';
  end if;

  -- 사용 전 에너지. 화면 팝업이 "에너지 이전 → 이후" 를 그린다.
  v_hp_before := v_p.hp;
  v_gifted := app.take_one_item(v_uid, p_code);

  -- 게임 횟수는 하루 상한(max_bonus_plays)과 하루 총량(max_extra_plays) 중
  -- 작은 쪽까지만 채워진다. 남는 분은 버려진다.
  v_headroom := greatest(0, app.max_extra_plays() - v_p.bonus_plays);
  v_gained := least(v_def.plays,
                    greatest(0, app.max_bonus_plays() - v_p.bonus_plays),
                    v_headroom);

  if v_def.ward_cut > 0 then
    v_ward := v_p.ward_until - make_interval(hours => v_def.ward_cut);

    if v_ward <= now() then
      -- 남은 시간을 다 깎았으면 그 자리에서 휴식이 끝난다.
      update public.profiles
         set ward_until = null,
             hp = greatest(hp, app.discharge_hp()),
             hp_at = now(),
             meals_at = now()
       where id = v_uid
      returning * into v_p;
    else
      update public.profiles set ward_until = v_ward
       where id = v_uid
      returning * into v_p;
    end if;
  else
    update public.profiles
       set hp = least(app.hp_max(), hp + v_def.heal),
           bonus_plays = bonus_plays + v_gained,
           win_double  = win_double + v_def.win_double,
           -- 네잎클로버: flex_hours 동안 판돈 추가(app.bonus_stake 가 시각으로 끈다).
           stake_boost       = case when v_def.stake_bonus > 0 then v_def.stake_bonus
                                    else stake_boost end,
           stake_boost_until = case when v_def.stake_bonus > 0
                                    then now() + make_interval(hours => v_def.flex_hours)
                                    else stake_boost_until end
     where id = v_uid
    returning * into v_p;
  end if;

  -- 효과와 별개로 프로필 표시도 함께 켜는 물건이 있다.
  if v_def.flex_kind = 'consume' then
    perform app.flex_apply(v_uid, p_code, v_gifted);
  end if;

  -- 네잎클로버의 특이사항 한 줄. flex_kind 가 null 이라 flex_apply 의 동시 칸
  -- 밀어내기에 끼지 않도록 직접 넣는다. 효과와 같은
  -- 시각에 만료되고, app.accrue 가 치운다.
  if v_def.stake_bonus > 0 then
    insert into public.player_flex (user_id, item_code, gifted, expires_at, started_at)
    values (v_uid, p_code, v_gifted, v_p.stake_boost_until, now())
    on conflict (user_id, item_code) do update
       set gifted = excluded.gifted, expires_at = excluded.expires_at,
           started_at = excluded.started_at;
  end if;

  return app.state_json(v_p) || jsonb_build_object('plays_gained', v_gained,
                                                   'hp_before', v_hp_before);
end;
$$;

CREATE FUNCTION public.use_together(p_code text, p_with text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_def  public.item_defs;
  v_mate public.profiles;
  v_out  jsonb;
  v_p    public.profiles;
  v_mate_hp    integer;
  v_mate_plays integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.flex_text_with is null then raise exception 'NOT_SHAREABLE'; end if;

  select * into v_mate from public.profiles where username = p_with and not hidden;
  if not found then raise exception 'NO_SUCH_USER'; end if;
  if v_mate.id = v_uid then raise exception 'SELF_TARGET'; end if;
  -- 휴식 중에는 프로필 표시가 가려진다. 화면은 애초에 휴식 중인 사람을 목록에서 빼지만,
  -- 팝업을 연 사이에 휴식에 들어갔을 수 있어 한 번 더 막는다.
  v_mate := app.accrue(v_mate.id);
  if v_mate.ward_until is not null then raise exception 'MATE_IN_WARD'; end if;

  if v_def.kind = 'food' then
    v_out := public.use_item(p_code);

    -- 고른 사람에게도 같은 효과. use_item 과 같은 식으로 상한을 건다.
    v_mate_plays := least(v_def.plays,
                          greatest(0, app.max_bonus_plays() - v_mate.bonus_plays),
                          greatest(0, app.max_extra_plays() - v_mate.bonus_plays));
    v_mate_hp := least(app.hp_max(), v_mate.hp + v_def.heal) - v_mate.hp;
    update public.profiles
       set hp = hp + greatest(0, v_mate_hp),
           bonus_plays = bonus_plays + v_mate_plays
     where id = v_mate.id;

    -- 음식은 flex_kind 가 없어 flex_apply 가 아무것도 안 한다. 함께 먹었다는
    -- 한 줄만 두 사람에게 직접 1시간 붙인다(네잎클로버와 같은 방식 — 음료의
    -- 동시 칸 밀어내기에 끼지 않는다). app.accrue 가 만료되면 치운다.
    insert into public.player_flex (user_id, item_code, gifted, together, expires_at, started_at)
    values (v_uid, p_code, false, true, now() + interval '1 hour', now()),
           (v_mate.id, p_code, false, true, now() + interval '1 hour', now())
    on conflict (user_id, item_code) do update
       set together = true, gifted = false,
           expires_at = excluded.expires_at, started_at = excluded.started_at;

    select * into v_p from public.profiles where id = v_uid;
    return v_out || app.state_json(v_p)
                 || jsonb_build_object('with', v_mate.username,
                                       'mate_heal', greatest(0, v_mate_hp),
                                       'mate_plays', v_mate_plays);
  end if;

  v_out := public.flex_use(p_code);

  update public.player_flex set together = true
   where user_id = v_uid and item_code = p_code;

  perform app.flex_apply(v_mate.id, p_code, false);
  update public.player_flex set together = true
   where user_id = v_mate.id and item_code = p_code;

  -- 앞 호출이 실은 값은 남기고, 상태는 together 가
  -- 켜진 뒤로 다시 읽는다.
  select * into v_p from public.profiles where id = v_uid;
  return v_out || app.state_json(v_p) || jsonb_build_object('with', v_mate.username);
end;
$$;

-- ════════ 정책 ════════

CREATE POLICY "item defs are readable" ON public.item_defs FOR SELECT TO authenticated USING (true);

CREATE POLICY "own flex is readable" ON public.player_flex FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "own inventory is readable" ON public.inventories FOR SELECT TO authenticated USING ((user_id = auth.uid()));

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.has_food(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.meal_item_at(p_slot timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.meal_slots(p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.move_items(p_from uuid, p_to uuid, p_items jsonb, p_gift boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.roll_shop(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.shop_item_cap(p_code text) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.shop_today(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.special_meal_date() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.special_meal_item() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.buy_item(p_code text, p_qty integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.buy_item(p_code text, p_qty integer) TO anon;
GRANT ALL ON FUNCTION public.buy_item(p_code text, p_qty integer) TO authenticated;
GRANT ALL ON FUNCTION public.buy_item(p_code text, p_qty integer) TO service_role;

REVOKE ALL ON FUNCTION public.flex_equip(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.flex_equip(p_code text) TO anon;
GRANT ALL ON FUNCTION public.flex_equip(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.flex_equip(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.flex_unequip(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.flex_unequip(p_code text) TO anon;
GRANT ALL ON FUNCTION public.flex_unequip(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.flex_unequip(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.flex_use(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.flex_use(p_code text) TO anon;
GRANT ALL ON FUNCTION public.flex_use(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.flex_use(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.gear_off(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gear_off(p_code text) TO anon;
GRANT ALL ON FUNCTION public.gear_off(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.gear_off(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.gear_on(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gear_on(p_code text) TO anon;
GRANT ALL ON FUNCTION public.gear_on(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.gear_on(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.mix_item(p_code text, p_with text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mix_item(p_code text, p_with text) TO anon;
GRANT ALL ON FUNCTION public.mix_item(p_code text, p_with text) TO authenticated;
GRANT ALL ON FUNCTION public.mix_item(p_code text, p_with text) TO service_role;

REVOKE ALL ON FUNCTION public.radio_on(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.radio_on(p_code text) TO anon;
GRANT ALL ON FUNCTION public.radio_on(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.radio_on(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.roast_item(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roast_item(p_code text) TO anon;
GRANT ALL ON FUNCTION public.roast_item(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.roast_item(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.sell_item(p_code text, p_qty integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sell_item(p_code text, p_qty integer) TO anon;
GRANT ALL ON FUNCTION public.sell_item(p_code text, p_qty integer) TO authenticated;
GRANT ALL ON FUNCTION public.sell_item(p_code text, p_qty integer) TO service_role;

REVOKE ALL ON FUNCTION public.shop_catalog() FROM PUBLIC;
GRANT ALL ON FUNCTION public.shop_catalog() TO anon;
GRANT ALL ON FUNCTION public.shop_catalog() TO authenticated;
GRANT ALL ON FUNCTION public.shop_catalog() TO service_role;

REVOKE ALL ON FUNCTION public.use_item(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.use_item(p_code text) TO anon;
GRANT ALL ON FUNCTION public.use_item(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.use_item(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.use_together(p_code text, p_with text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.use_together(p_code text, p_with text) TO anon;
GRANT ALL ON FUNCTION public.use_together(p_code text, p_with text) TO authenticated;
GRANT ALL ON FUNCTION public.use_together(p_code text, p_with text) TO service_role;

GRANT ALL ON TABLE public.inventories TO anon;
GRANT ALL ON TABLE public.inventories TO authenticated;
GRANT ALL ON TABLE public.inventories TO service_role;

GRANT ALL ON TABLE public.item_defs TO anon;
GRANT ALL ON TABLE public.item_defs TO authenticated;
GRANT ALL ON TABLE public.item_defs TO service_role;

GRANT ALL ON TABLE public.player_flex TO anon;
GRANT ALL ON TABLE public.player_flex TO authenticated;
GRANT ALL ON TABLE public.player_flex TO service_role;

GRANT ALL ON TABLE public.shop_offers TO anon;
GRANT ALL ON TABLE public.shop_offers TO authenticated;
GRANT ALL ON TABLE public.shop_offers TO service_role;
