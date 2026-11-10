-- core — 프로필 · 원장 · 판 기록 · 에너지/휴식 · 규칙 상수 · 상태 JSON
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

create schema if not exists app;

-- ════════ 테이블 기본값에 쓰는 함수 ════════

CREATE FUNCTION app.today_kst() RETURNS date
    LANGUAGE sql STABLE
    AS $$ select (timezone('Asia/Seoul', now()))::date $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

-- ════════ 테이블 ════════

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    username text NOT NULL,
    coins integer DEFAULT 0 NOT NULL,
    plays_used integer DEFAULT 0 NOT NULL,
    last_reset date DEFAULT app.today_kst() NOT NULL,
    hl_card integer DEFAULT 7 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hl_stage integer DEFAULT 0 NOT NULL,
    hl_bet integer DEFAULT 0 NOT NULL,
    hl_pot integer DEFAULT 0 NOT NULL,
    hl_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    debt integer DEFAULT 0 NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    bonus_plays integer DEFAULT 0 NOT NULL,
    win_double integer DEFAULT 0 NOT NULL,
    hp integer DEFAULT 100 NOT NULL,
    hp_at timestamp with time zone DEFAULT now() NOT NULL,
    meals_at timestamp with time zone DEFAULT now() NOT NULL,
    ward_until timestamp with time zone,
    suspended_until timestamp with time zone,
    suspend_reason text,
    avatar_path text,
    status_message text,
    age smallint,
    height_cm numeric(4,1),
    weight_kg numeric(4,1),
    bio text,
    hl_bonus integer DEFAULT 0 NOT NULL,
    hl_wage integer DEFAULT 0 NOT NULL,
    stake_boost integer DEFAULT 0 NOT NULL,
    stake_boost_until timestamp with time zone,
    cell_id bigint,
    cat_boost integer DEFAULT 0 NOT NULL,
    cat_boost_left integer DEFAULT 0 NOT NULL,
    cat_search_boost boolean DEFAULT false NOT NULL,
    cat_labor_good boolean DEFAULT false NOT NULL,
    CONSTRAINT coins_non_negative CHECK ((coins >= 0)),
    CONSTRAINT hl_card_range CHECK (((hl_card >= 1) AND (hl_card <= 13))),
    CONSTRAINT profiles_age_check CHECK (((age IS NULL) OR ((age >= 1) AND (age <= 120)))),
    CONSTRAINT profiles_bonus_plays_check CHECK ((bonus_plays >= 0)),
    CONSTRAINT profiles_debt_check CHECK ((debt >= 0)),
    CONSTRAINT profiles_height_check CHECK (((height_cm IS NULL) OR ((height_cm >= (50)::numeric) AND (height_cm <= (250)::numeric)))),
    CONSTRAINT profiles_hp_check CHECK (((hp >= 0) AND (hp <= 100))),
    CONSTRAINT profiles_weight_check CHECK (((weight_kg IS NULL) OR ((weight_kg >= (20)::numeric) AND (weight_kg <= (300)::numeric))))
);

CREATE TABLE public.cells (
    id bigint NOT NULL,
    block smallint NOT NULL,
    room smallint NOT NULL
);

ALTER TABLE public.cells ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cells_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.game_rounds (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    username text NOT NULL,
    game text NOT NULL,
    bet integer NOT NULL,
    choice text,
    outcome jsonb NOT NULL,
    payout integer NOT NULL,
    balance_after integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_rounds_game_check CHECK ((game = ANY (ARRAY['roulette'::text, 'slots'::text, 'keno'::text, 'highlow'::text, 'dice'::text, 'indian'::text, 'blackjack'::text, 'race'::text])))
);

ALTER TABLE public.game_rounds ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.game_rounds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.ledger (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    coin_delta integer DEFAULT 0 NOT NULL,
    coin_after integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.ledger ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.cells
    ADD CONSTRAINT cells_block_room_key UNIQUE (block, room);

ALTER TABLE ONLY public.cells
    ADD CONSTRAINT cells_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.game_rounds
    ADD CONSTRAINT game_rounds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);

CREATE INDEX game_rounds_created_at_idx ON public.game_rounds USING btree (created_at DESC);

CREATE INDEX game_rounds_user_idx ON public.game_rounds USING btree (user_id, created_at DESC);

CREATE INDEX ledger_user_idx ON public.ledger USING btree (user_id, created_at DESC);

ALTER TABLE ONLY public.game_rounds
    ADD CONSTRAINT game_rounds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_cell_id_fkey FOREIGN KEY (cell_id) REFERENCES public.cells(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.cells ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.accrue(p_uid uuid) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  p           public.profiles;
  v_now       timestamptz := now();
  v_today     date := app.today_kst();
  v_hp        integer;
  v_cursor    timestamptz;
  v_meal_from timestamptz;
  v_ward      timestamptz;
  v_blocks    integer;
  v_to_zero   integer;
  v_zero_at   timestamptz;
  v_meals     integer := 0;
  v_guard     integer := 0;
  v_changed   boolean := false;
  v_plays     integer;
  v_bonus     integer;
  v_decay     integer;
  v_reset     date;
  v_frozen    timestamptz;
begin
  select * into p from public.profiles where id = p_uid for update;
  if not found then raise exception 'NO_PROFILE'; end if;

  v_hp        := p.hp;
  v_cursor    := p.hp_at;
  v_meal_from := p.meals_at;
  v_ward      := p.ward_until;
  v_plays     := p.plays_used;
  v_bonus     := p.bonus_plays;
  v_reset     := p.last_reset;

  v_decay := app.hp_decay_per_block();

  -- 날짜가 넘어갔으면 플레이 횟수와 아이템 보너스를 초기화한다.
  -- 코인은 보충하지 않는다.
  if v_reset < v_today then
    v_plays      := 0;
    v_bonus      := 0;
    v_reset      := v_today;
    v_changed    := true;
  end if;

  -- 정지 중에는 에너지·식사 시계가 멈춘다 — 두 시계를 지금으로 당겨 둬서 그동안
  -- 에너지도 깎이지 않고 도시락도 쌓이지 않는다. 정지가 끝났는데 아직 칸이
  -- 비워지기 전이면(app.require_active 가 지우기 전) 끝난 시각부터 센다.
  -- 휴식 시계(ward_until)는 그대로 흐른다.
  if p.suspended_until is not null then
    v_frozen := least(p.suspended_until, v_now);
    if v_cursor < v_frozen then
      v_cursor  := v_frozen;
      v_changed := true;
    end if;
    if v_meal_from < v_frozen then
      v_meal_from := v_frozen;
      v_changed   := true;
    end if;
  end if;

  -- 운영자 계정(app.hidden_name())은 에너지가 소모되지 않고 항상 가득 차 있다.
  if p.username = app.hidden_name() then
    if v_hp <> app.hp_max() or v_ward is not null then
      v_hp      := app.hp_max();
      v_cursor  := v_now;
      v_ward    := null;
      v_changed := true;
    end if;
  else

  -- 휴식 <-> 에너지 감소가 여러 번 반복될 수 있어(오래 비운 경우) 루프로 처리한다.
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 30;

    if v_ward is not null then
      exit when v_now < v_ward;              -- 아직 휴식 중이다
      v_hp        := app.discharge_hp();     -- 휴식 종료
      v_cursor    := greatest(v_ward, coalesce(v_frozen, v_ward));  -- 정지 중 휴식이 끝났으면 정지 끝부터
      v_meal_from := greatest(v_ward, coalesce(v_frozen, v_ward));  -- 휴식 중이던 동안의 식사는 없던 일로
      v_ward      := null;
      v_changed   := true;
      continue;
    end if;

    v_blocks := floor(extract(epoch from (v_now - v_cursor))
                       / (app.hp_decay_block_hours() * 3600))::int;
    exit when v_blocks <= 0;

    if v_hp - v_blocks * v_decay > 0 then
      v_hp      := v_hp - v_blocks * v_decay;
      v_cursor  := v_cursor + make_interval(hours => v_blocks * app.hp_decay_block_hours());
      v_changed := true;
      exit;
    end if;

    -- 시간이 흘러 에너지가 0이 된 경우. 그 시점을 먼저 계산한다.
    v_to_zero   := ceil(v_hp::numeric / v_decay)::int;
    v_zero_at   := greatest(
      v_cursor + make_interval(hours => v_to_zero * app.hp_decay_block_hours()),
      v_cursor
    );

    -- 먹을 것이 있으면 곧바로 휴식으로 보내지 않고 쓰러지기 직전 상태로 둔다.
    -- (접속하면 화면에서 바로 먹을 기회를 준다)
    --   · 에너지 0 도달 후 15시간까지만 이 유예를 준다
    --   · 단, 사흘 넘게 비운 뒤 복귀한 경우는 시간에 관계없이 유예한다
    --     (오랜만에 켠 판을 곧바로 휴식으로 시작하게 두지 않는다)
    -- 게임을 해서 0이 된 경우는 app.spend_hp 에서 즉시 휴식으로 보낸다.
    if app.has_food(p_uid)
       and (v_now < v_zero_at + interval '15 hours'
            or v_now - p.hp_at >= interval '72 hours') then
      v_hp      := 0;
      v_cursor  := v_now;     -- 더 깎을 것이 없다
      v_changed := true;
      exit;
    end if;

    -- 휴식은 유예가 끝난 시점부터 센다. 유예는 바로 위 분기대로
    -- "먹을 것이 있을 때만" 주어지므로, 식량이 없으면 에너지가 0이 된 그 시점부터
    -- 바로 센다. (오래 비웠다고 지금부터 시작하면 부당하게 길어지므로
    -- now() 를 기준으로 삼지는 않는다)
    -- 휴식 시간은 app.ward_hours() 로 고정이다.
    v_hp        := 0;
    v_ward      := v_zero_at                 -- 이번 휴식이 시작되는 시각
                   + case when app.has_food(p_uid)
                          then interval '15 hours' else interval '0' end;
    v_ward      := v_ward + make_interval(hours => app.ward_hours());
    -- 남은 시간이 휴식 시간을 넘어 보이는 일이 없도록 한 번 더 잠근다.
    v_ward      := least(v_ward, v_now + make_interval(hours => app.ward_hours()));
    v_cursor    := v_zero_at;
    v_meal_from := v_zero_at;
    v_changed   := true;
  end loop;

  end if;

  -- 식사 지급 (휴식 중이거나 에너지가 0이면 지급하지 않는다)
  if v_ward is null and v_hp > 0 then
    v_meal_from := greatest(
      v_meal_from,
      v_now - make_interval(days => app.meal_backfill_days())
    );

    select count(*) into v_meals from app.meal_slots(v_meal_from, v_now);

    if v_meals > 0 then
      -- 슬롯마다 날짜를 보고 품목을 정한다. 밀린 정산이 특선일을 걸쳐
      -- 있으면 그 날 몫만 특선으로, 나머지는 평소 도시락으로 나뉜다.
      insert into public.inventories (user_id, item_code, qty)
      select p_uid, app.meal_item_at(m.slot), count(*)
        from app.meal_slots(v_meal_from, v_now) as m(slot)
       group by app.meal_item_at(m.slot)
      on conflict (user_id, item_code)
        do update set qty = inventories.qty + excluded.qty;
      v_changed := true;
    end if;
  end if;

  -- 만료된 소모형 프로필 표시를 청소한다. 장착(expires_at is null)은 건드리지 않는다.
  delete from public.player_flex
   where user_id = p_uid and expires_at is not null and expires_at <= v_now;

  if v_changed then
    update public.profiles
       set hp         = v_hp,
           hp_at      = v_cursor,
           ward_until = v_ward,
           meals_at   = case when v_ward is null then v_now else v_meal_from end,
           plays_used = v_plays,
           bonus_plays = v_bonus,
           last_reset = v_reset
     where id = p_uid
    returning * into p;
  end if;

  return p;
end;
$$;

CREATE FUNCTION app.can_give(p_uid uuid, p_items jsonb) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select not exists (
    select 1
      from jsonb_array_elements(p_items) e
      left join public.inventories i
             on i.user_id = p_uid and i.item_code = e->>'code'
      left join public.item_defs d on d.code = e->>'code'
      left join lateral (
        select coalesce(sum(f.stack), 0) as n from public.player_flex f
         where f.user_id = p_uid and f.item_code = e->>'code' and f.expires_at is null
      ) locked on true
     where d.code is null                     -- 없는 아이템
        or d.tradable = false                 -- 거래 불가 아이템
        or coalesce(i.qty, 0) - coalesce(locked.n, 0) < (e->>'qty')::int
  );
$$;

CREATE FUNCTION app.daily_play_limit() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 20 $$;

CREATE FUNCTION app.discharge_hp() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 80 $$;

-- 관리자가 계정을 발급할 때 쓰는 초기 비밀번호. 헷갈리는 글자(O·0·I·l·1)를 뺀 10자.
-- 평문은 어디에도 저장하지 않는다 — 발급 응답으로 한 번만 돌려준다.
CREATE FUNCTION app.gen_password() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  v_pool text := 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  v_pw   text;
begin
  loop
    v_pw := '';
    for i in 1..10 loop
      v_pw := v_pw || substr(v_pool, 1 + floor(random() * length(v_pool))::int, 1);
    end loop;
    exit when v_pw ~ '[A-Za-z]' and v_pw ~ '[0-9]';
  end loop;
  return v_pw;
end;
$$;

CREATE FUNCTION app.hidden_name() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select 'admin' $$;

CREATE FUNCTION app.hp_decay_block_hours() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 2 $$;

CREATE FUNCTION app.hp_decay_per_block() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.hp_max() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 100 $$;

CREATE FUNCTION app.hp_per_play() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 1 $$;

CREATE FUNCTION app.hp_status(p_hp integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select case
             when p_hp <= 0  then '휴식'
             when p_hp <= 10 then '바닥'
             when p_hp <= 30 then '부족'
             when p_hp <= 50 then '보통'
             else '충분'
           end;
  $$;

CREATE FUNCTION app.initial_coins() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 20 $$;

CREATE FUNCTION app.is_hidden_name(p_username text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select coalesce((select hidden from public.profiles where username = p_username), false);
$$;

CREATE FUNCTION app.is_hidden_uid(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select coalesce((select hidden from public.profiles where id = p_uid), false);
$$;

CREATE FUNCTION app.is_suspended(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from public.profiles
     where id = p_uid and suspended_until is not null and suspended_until > now()
  );
$$;

CREATE FUNCTION app.ko_eul(p_word text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case when app.ko_jong(p_word) > 0 then '을' else '를' end;
$$;

CREATE FUNCTION app.ko_eun(p_word text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case when app.ko_jong(p_word) > 0 then '은' else '는' end;
$$;

CREATE FUNCTION app.ko_jong(p_word text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when coalesce(p_word, '') = '' then -1
    when ascii(right(p_word, 1)) between 44032 and 55203
      then (ascii(right(p_word, 1)) - 44032) % 28
    else -1
  end;
$$;

CREATE FUNCTION app.ko_ro(p_word text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case when app.ko_jong(p_word) > 0 and app.ko_jong(p_word) <> 8
              then '으로' else '로' end;
$$;

CREATE FUNCTION app.log(p_uid uuid, p_kind text, p_title text, p_delta integer, p_after integer, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.ledger (user_id, kind, title, detail, coin_delta, coin_after)
  values (p_uid, p_kind, p_title, coalesce(p_detail, '{}'::jsonb), p_delta, p_after);
$$;

CREATE FUNCTION app.max_bonus_plays() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 8 $$;

CREATE FUNCTION app.max_extra_plays() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 8 $$;

CREATE FUNCTION app.pick_shuffled(p_lo integer, p_hi integer, p_n integer) RETURNS smallint[]
    LANGUAGE plpgsql
    AS $$
declare
  v_out smallint[] := '{}';
begin
  while coalesce(array_length(v_out, 1), 0) < p_n loop
    v_out := v_out || (select array_agg(g::smallint order by random())
                         from generate_series(p_lo, p_hi) g);
  end loop;
  return v_out[1:p_n];
end;
$$;

CREATE FUNCTION app.play_wage() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 4 $$;

CREATE FUNCTION app.play_wage(p_coins integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    select case when coalesce(p_coins, 0) >= app.wage_rich_line() then 0
                when coalesce(p_coins, 0) <  app.wage_poor_line() then app.play_wage_poor()
                else app.play_wage() end
  $$;

CREATE FUNCTION app.play_wage_poor() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 6 $$;

CREATE FUNCTION app.require_active() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select suspended_until into v_until from public.profiles where id = auth.uid();

  if v_until is not null and v_until <= now() then
    -- 지우기 전에 정산한다 — accrue 는 suspended_until 을 보고 정지 기간을
    -- 에너지·식사 계산에서 빼므로, 먼저 지우면 그 기간이 한꺼번에 계산된다.
    perform app.accrue(auth.uid());
    update public.profiles
       set suspended_until = null, suspend_reason = null
     where id = auth.uid();
    v_until := null;
  end if;

  if v_until is not null then raise exception 'SUSPENDED'; end if;
end;
$$;

CREATE FUNCTION app.require_admin() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
end;
$$;

CREATE FUNCTION app.roll_grade(p_last boolean DEFAULT false, p_epic_boost boolean DEFAULT false) RETURNS text
    LANGUAGE sql
    AS $$
  select case
           when p_last then
             case when p_epic_boost then
               case when r < 0.20 then 'common'
                    when r < 0.45 then 'uncommon'
                    when r < 0.60 then 'rare'
                    else 'epic' end
             else
               case when r < 0.30 then 'common'
                    when r < 0.70 then 'uncommon'
                    when r < 0.95 then 'rare'
                    else 'epic' end
             end
           else
             case when p_epic_boost then
               case when r < 0.55 then 'common'
                    when r < 0.80 then 'uncommon'
                    when r < 0.90 then 'rare'
                    else 'epic' end
             else
               case when r < 0.60 then 'common'
                    when r < 0.90 then 'uncommon'
                    else 'rare' end
             end
         end
    from (select random() as r) s;
$$;

CREATE FUNCTION app.spend_hp(p_uid uuid, p_amount integer) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  p        public.profiles;
  v_hp     integer;
begin
  select * into p from public.profiles where id = p_uid for update;

  -- 운영자 계정(app.hidden_name())은 에너지를 소모하지 않는다.
  if p.username = app.hidden_name() then
    return p;
  end if;

  v_hp := greatest(0, p.hp - p_amount);

  update public.profiles
     set hp = v_hp,
         ward_until = case when v_hp = 0 and p.ward_until is null
                           then now() + make_interval(hours => app.ward_hours())
                           else ward_until end,
         hp_at = case when v_hp = 0 then now() else hp_at end,
         meals_at = case when v_hp = 0 then now() else meals_at end
   where id = p_uid
  returning * into p;

  return p;
end;
$$;

CREATE FUNCTION app.state_json(p public.profiles) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select jsonb_build_object(
    'username',     p.username,
    'avatar_path',  p.avatar_path,
    'coins',        p.coins,
    'plays_used',   p.plays_used,
    'plays_left',   greatest(0, app.daily_play_limit() + p.bonus_plays - p.plays_used),
    'play_limit',   app.daily_play_limit() + p.bonus_plays,
    'bonus_plays',  p.bonus_plays,
    'bonus_max',    app.max_bonus_plays(),
    'bonus_left',   least(greatest(0, app.max_bonus_plays() - p.bonus_plays),
                          greatest(0, app.max_extra_plays() - p.bonus_plays)),
    'extra_plays',  p.bonus_plays,
    'extra_max',    app.max_extra_plays(),
    'extra_left',   greatest(0, app.max_extra_plays() - p.bonus_plays),
    'win_double',   p.win_double,
    'hl_card',      p.hl_card,
    'hl_stage',     p.hl_stage,
    'hl_bet',       p.hl_bet,
    'hl_pot',       p.hl_pot,
    'hl_steps',     p.hl_steps,
    'hl_max_stage', app.hl_max_stage(),
    'debt',         p.debt,
    'is_admin',     p.is_admin,
    'hidden',       p.hidden,
    'pvp_min_bet',  app.pvp_min_bet(),
    'play_wage',    app.play_wage(p.coins),
    'hp',           p.hp,
    'hp_max',       app.hp_max(),
    'hp_status',    app.hp_status(p.hp),
    'in_ward',      (p.ward_until is not null),
    'ward_left',    case when p.ward_until is null then 0
                         else greatest(0, extract(epoch from (p.ward_until - now()))::int) end,
    'suspended',        (p.suspended_until is not null and p.suspended_until > now()),
    'suspended_until',  p.suspended_until,
    'suspended_left',   case when p.suspended_until is null then 0
                              else greatest(0, extract(epoch from (p.suspended_until - now()))::int) end,
    'suspend_reason',   p.suspend_reason,
    'cell_id',      p.cell_id,
    'cell',         (select app.cell_label(c.block, c.room)
                       from public.cells c where c.id = p.cell_id),
    'status_message', p.status_message,
    'age',          p.age,
    'height_cm',    p.height_cm,
    'weight_kg',    p.weight_kg,
    'bio',          p.bio,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', d.code, 'name', d.name, 'kind', d.kind, 'grade', d.grade,
               'emoji', d.emoji, 'heal', d.heal, 'plays', d.plays,
               'ward_cut', d.ward_cut, 'win_double', d.win_double,
               'description', d.description,
               'buy_price', d.buy_price, 'sell_price', d.sell_price,
               'tradable', d.tradable, 'qty', i.qty,
               'flex_kind', d.flex_kind, 'flex_hours', d.flex_hours,
               'uses', d.uses, 'open_left', i.open_left,
               'shareable', (d.flex_text_with is not null)
             ) order by d.sort_order, d.code)
        from public.inventories i
        join public.item_defs d on d.code = i.item_code
       -- qty=0 인데 여러 번 쓰는 물건의 남은 횟수(open_left > 0)만 있는 경우도 계속 보여야
       -- 끝까지 쓸 수 있다.
       where i.user_id = p.id and (i.qty > 0 or i.open_left > 0)), '[]'::jsonb),
    -- 본인에게만 보이는 프로필 표시. 남은 시간(expires_at)은 여기서만 나간다 —
    -- player_roster() 는 같은 행에서 문장만 뽑아 남에게 보여준다.
    'flex', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', d.code, 'name', d.name, 'emoji', d.emoji,
               'kind', d.kind, 'grade', d.grade, 'flex_kind', d.flex_kind,
               -- {giver} 자리는 선물받아 장착했으면 준 사람, 아니면 본인 이름(app.flex_render).
               'text', app.flex_render(
                         case when f.together then coalesce(d.flex_text_with, d.flex_text)
                              when f.gifted then d.flex_text_gift
                              else d.flex_text end,
                         case when f.gifted and not f.together
                              then (select g.username from public.profiles g where g.id = f.gift_from)
                              else p.username end),
               'gifted', f.gifted, 'together', f.together, 'expires_at', f.expires_at
             ) order by f.started_at)
        from public.player_flex f
        join public.item_defs d on d.code = f.item_code
        -- 겹쳐 장착한 것은 그 수만큼 같은 줄을 낸다.
        cross join generate_series(1, f.stack)
       where f.user_id = p.id), '[]'::jsonb)
  )
  -- jsonb_build_object 는 인자를 100개까지만 받는다.
  -- 새 키는 여기 두 번째 객체에 붙인다.
  || jsonb_build_object(
    'hl_bonus',     p.hl_bonus,
    'wear_limit',   app.flex_wear_limit(),
    -- 네잎클로버. 켜져 있지 않으면 null.
    'luck',         case when p.stake_boost_until > now() then
                      jsonb_build_object('stake', p.stake_boost, 'ends_at', p.stake_boost_until)
                    end
  );
$$;

CREATE FUNCTION app.wage_poor_line() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 100 $$;

CREATE FUNCTION app.wage_rich_line() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 800 $$;

-- 에너지가 0이 되면 들어가는 휴식 쿨다운(시간). 원본의 단계별 사다리 대신 한 값으로 고정했다.
CREATE FUNCTION app.ward_hours() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 14 $$;

CREATE FUNCTION public.get_my_state() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 일일 리셋과 시간 경과 정산이 모두 app.accrue 안에서 처리된다.
  v_p := app.accrue(v_uid);
  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_name   text := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  v_hidden boolean := (v_name = app.hidden_name());
begin
  insert into public.profiles
    (id, username, coins, plays_used, last_reset, hl_card, hp, hp_at, meals_at, cell_id, hidden)
  values (
    new.id,
    v_name,
    app.initial_coins(),
    0,
    app.today_kst(),
    app.hl_draw(),
    app.hp_max(),
    now(),
    now(),
    case when v_hidden then null else app.assign_cell() end,
    v_hidden
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 아이디(영문 소문자·숫자 3~20자) → Supabase Auth 이메일. 클라이언트 src/lib/auth.ts 와 같은 규칙.
CREATE FUNCTION public.username_to_email(p_username text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select lower(btrim(p_username)) || '@paddock.local';
$$;

CREATE FUNCTION app.username_valid(p_username text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(p_username ~ '^[a-z0-9]{3,20}$', false);
$$;

-- ════════ 정책 ════════

CREATE POLICY "own ledger is readable" ON public.ledger FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "profiles are readable by logged in users" ON public.profiles FOR SELECT TO authenticated USING ((NOT hidden));

CREATE POLICY "rounds are readable by logged in users" ON public.game_rounds FOR SELECT TO authenticated USING (((NOT app.is_hidden_uid(user_id)) AND (NOT app.is_hidden_name(COALESCE((outcome ->> 'vs'::text), ''::text)))));

-- ════════ 권한 ════════

GRANT ALL ON TABLE public.profiles TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

GRANT SELECT(username) ON TABLE public.profiles TO authenticated;

GRANT SELECT(coins) ON TABLE public.profiles TO authenticated;

REVOKE ALL ON FUNCTION app.accrue(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.gen_password() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.hidden_name() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.ko_eul(p_word text) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.ko_eun(p_word text) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.ko_jong(p_word text) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.ko_ro(p_word text) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.log(p_uid uuid, p_kind text, p_title text, p_delta integer, p_after integer, p_detail jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.pick_shuffled(p_lo integer, p_hi integer, p_n integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.require_admin() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.roll_grade(p_last boolean, p_epic_boost boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.spend_hp(p_uid uuid, p_amount integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_my_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_state() TO anon;
GRANT ALL ON FUNCTION public.get_my_state() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_state() TO service_role;

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

REVOKE ALL ON FUNCTION public.username_to_email(p_username text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.username_to_email(p_username text) TO service_role;
REVOKE ALL ON FUNCTION app.username_valid(p_username text) FROM PUBLIC;

GRANT ALL ON TABLE public.cells TO anon;
GRANT ALL ON TABLE public.cells TO authenticated;
GRANT ALL ON TABLE public.cells TO service_role;

GRANT ALL ON SEQUENCE public.cells_id_seq TO anon;
GRANT ALL ON SEQUENCE public.cells_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.cells_id_seq TO service_role;

GRANT ALL ON TABLE public.game_rounds TO anon;
GRANT ALL ON TABLE public.game_rounds TO authenticated;
GRANT ALL ON TABLE public.game_rounds TO service_role;

GRANT ALL ON SEQUENCE public.game_rounds_id_seq TO anon;
GRANT ALL ON SEQUENCE public.game_rounds_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.game_rounds_id_seq TO service_role;

GRANT ALL ON TABLE public.ledger TO anon;
GRANT ALL ON TABLE public.ledger TO authenticated;
GRANT ALL ON TABLE public.ledger TO service_role;

GRANT ALL ON SEQUENCE public.ledger_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ledger_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ledger_id_seq TO service_role;
