-- explore — 탐험 · 고양이
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.cat_bonds (
    user_id uuid NOT NULL,
    churu_given integer DEFAULT 0 NOT NULL,
    petted boolean DEFAULT false NOT NULL,
    name text,
    named_at timestamp with time zone
);

CREATE TABLE public.cat_favorite (
    id integer DEFAULT 1 NOT NULL,
    user_id uuid,
    since timestamp with time zone,
    CONSTRAINT cat_favorite_id_check CHECK ((id = 1))
);

CREATE TABLE public.cat_gifts (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    item_code text NOT NULL,
    ready_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    kept boolean
);

CREATE SEQUENCE public.cat_gifts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.cat_gifts_id_seq OWNED BY public.cat_gifts.id;

CREATE TABLE public.search_offers (
    user_id uuid NOT NULL,
    day date NOT NULL,
    place text NOT NULL,
    cat text
);

ALTER TABLE ONLY public.cat_gifts ALTER COLUMN id SET DEFAULT nextval('public.cat_gifts_id_seq'::regclass);

ALTER TABLE ONLY public.cat_bonds
    ADD CONSTRAINT cat_bonds_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.cat_favorite
    ADD CONSTRAINT cat_favorite_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cat_gifts
    ADD CONSTRAINT cat_gifts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_offers
    ADD CONSTRAINT search_offers_pkey PRIMARY KEY (user_id, day);

CREATE INDEX cat_gifts_user_open ON public.cat_gifts USING btree (user_id, ready_at) WHERE (resolved_at IS NULL);

ALTER TABLE ONLY public.cat_bonds
    ADD CONSTRAINT cat_bonds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cat_favorite
    ADD CONSTRAINT cat_favorite_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cat_gifts
    ADD CONSTRAINT cat_gifts_item_code_fkey FOREIGN KEY (item_code) REFERENCES public.item_defs(code);

ALTER TABLE ONLY public.cat_gifts
    ADD CONSTRAINT cat_gifts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_offers
    ADD CONSTRAINT search_offers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.cat_bonds ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cat_favorite ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cat_gifts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.search_offers ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.cat_bird_plays() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.cat_bird_stake() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 10 $$;

CREATE FUNCTION app.cat_bless_charge(p_uid uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_stake integer;
begin
  update public.profiles
     set cat_boost_left = cat_boost_left - 1
   where id = p_uid and cat_boost_left > 0
  returning cat_boost into v_stake;
  return coalesce(v_stake, 0);
end;
$$;

CREATE FUNCTION app.cat_churu_bond() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 1 $$;

CREATE FUNCTION app.cat_churu_item() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select 'churu' $$;

CREATE FUNCTION app.cat_favorite_refresh(p_actor uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_cur       uuid;
  v_cur_score integer;
  v_top       integer;
  v_new       uuid;
begin
  select user_id into v_cur from public.cat_favorite where id = 1 for update;

  select max(s.score), max(s.score) filter (where s.user_id = v_cur)
    into v_top, v_cur_score
    from app.cat_scores() s;

  if coalesce(v_top, 0) <= 0 then
    update public.cat_favorite set user_id = null, since = null where id = 1;
    return;
  end if;

  if v_cur is not null and v_cur_score = v_top then return; end if;

  select s.user_id into v_new from app.cat_scores() s
   where s.score = v_top
   order by (s.user_id = p_actor) desc nulls last
   limit 1;

  update public.cat_favorite set user_id = v_new, since = now() where id = 1;
end;
$$;

CREATE FUNCTION app.cat_fish_bond() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 2 $$;

CREATE FUNCTION app.cat_fish_gift_rate() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 1.0 $$;

CREATE FUNCTION app.cat_fish_items() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$ select array['fish_mackerel','fish_horse_mackerel','milk'] $$;

CREATE FUNCTION app.cat_fish_lure_chance() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.5 $$;

CREATE FUNCTION app.cat_friend_need() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.cat_gift_delay() RETURNS interval
    LANGUAGE sql IMMUTABLE
    AS $$ select interval '3 hours' $$;

CREATE FUNCTION app.cat_gift_items() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$ select array['feather','toy_mouse','butterfly'] $$;

CREATE FUNCTION app.cat_gift_rate() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.5 $$;

CREATE FUNCTION app.cat_labor_good_take(p_uid uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_on boolean;
begin
  update public.profiles set cat_labor_good = false
   where id = p_uid and cat_labor_good
  returning true into v_on;
  return coalesce(v_on, false);
end;
$$;

-- 장난감 쥐(toy_mouse) 효과: 다음 탐험 한 번은 등급을 두 번 뽑아 높은 쪽을 쓴다.
-- 켜져 있으면 끄면서 true 를 돌려준다(app.cat_labor_good_take 와 같은 모양).
CREATE FUNCTION app.cat_search_boost_take(p_uid uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_on boolean;
begin
  update public.profiles set cat_search_boost = false
   where id = p_uid and cat_search_boost
  returning true into v_on;
  return coalesce(v_on, false);
end;
$$;

CREATE FUNCTION app.cat_name_max() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 12 $$;

CREATE FUNCTION app.cat_name_of(p_uid uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  return (select name from public.cat_bonds where user_id = p_uid);
end;
$$;

CREATE FUNCTION app.cat_open(p_uid uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  return app.cat_public() or app.search_is_tester(p_uid);
end;
$$;

CREATE FUNCTION app.cat_place(p_uid uuid, p_day date) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select (array['cell', 'mess', 'shower', 'works', 'infirm'])
           [((hashtext(p_uid::text || ':' || p_day::text) % 5) + 5) % 5 + 1]
$$;

CREATE FUNCTION app.cat_public() RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$ select true $$;

CREATE FUNCTION app.cat_scores() RETURNS TABLE(user_id uuid, score integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  return query
  select i.user_id, sum(i.qty)::integer
    from public.inventories i
   where i.qty > 0
     and i.item_code = any(app.cat_gift_items())
   group by i.user_id;
end;
$$;

-- p_lucky: 장난감 쥐 효과. 등급을 두 번 뽑아 더 높은 쪽을 쓴다(꽝·간식 확률은 그대로).
CREATE FUNCTION app.roll_search(p_place text, p_lucky boolean DEFAULT false) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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
  if p_lucky then
    v_grade := v_order[least(array_position(v_order, v_grade),
                             array_position(v_order, app.roll_search_grade()))];
  end if;
  v_start := array_position(v_order, v_grade);

  for i in v_start .. array_length(v_order, 1) loop
    select code into v_code
      from public.item_defs
     where grade = v_order[i]
       and kind = any(v_kinds)
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

CREATE FUNCTION app.roll_search_grade() RETURNS text
    LANGUAGE sql
    AS $$
  select case
           when r < 0.54 then 'common'
           when r < 0.82 then 'uncommon'
           when r < 0.95 then 'rare'
           when r < 0.99 then 'epic'
           else 'legendary'
         end
    from (select random() as r) s;
$$;

CREATE FUNCTION app.search_exclude() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  select array['radio', 'churu']
$$;

CREATE FUNCTION app.search_hp_cost() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 15 $$;

CREATE FUNCTION app.search_is_tester(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select coalesce((select is_admin and username = app.hidden_name()
                     from public.profiles where id = p_uid), false)
$$;

CREATE FUNCTION app.search_kinds(p_place text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_place
           when 'cell'   then array['luxury', 'treat']
           when 'mess'   then array['food', 'treat', 'liquor']
           when 'shower' then array['luxury', 'treat']
           when 'works'  then array['tool', 'luxury']
           when 'infirm' then array['medicine', 'treat']
           else null
         end;
$$;

CREATE FUNCTION app.search_miss_rate() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.10 $$;

CREATE FUNCTION app.search_ration_item() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select 'emg_ration' $$;

CREATE FUNCTION app.search_ration_rate() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.30 $$;

CREATE FUNCTION public.cat_act(p_action text, p_snack text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_p        public.profiles;
  v_offer    public.search_offers;
  v_bond     public.cat_bonds;
  v_given    integer;
  v_outcome  text;
  v_can_name boolean := false;
  v_gifts    text[] := app.cat_gift_items();
  v_held     text[];
  v_snack    text;
  v_fish     boolean := false;
  v_snack_nm text;
  v_rate     numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if not app.cat_open(v_uid) then raise exception 'CAT_NOT_OPEN'; end if;
  if p_action is null or p_action not in ('feed', 'pet') then
    raise exception 'INVALID_ACTION';
  end if;

  v_p := app.accrue(v_uid);

  -- 오늘 만난 고양이가 아직 기다리고 있어야 한다. 행을 잡아 두 번 누르는 걸 막는다.
  select * into v_offer from public.search_offers
   where user_id = v_uid and day = app.today_kst()
   for update;
  if not found or v_offer.cat is distinct from 'waiting' then
    raise exception 'CAT_GONE';
  end if;

  insert into public.cat_bonds (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_bond from public.cat_bonds where user_id = v_uid for update;
  v_given := v_bond.churu_given;

  if p_action = 'feed' then
    -- 지금 가진 간식 종류 — 츄르 · 날생선 중 하나라도 남은 것.
    select array_agg(item_code order by item_code) into v_held
      from public.inventories
     where user_id = v_uid and qty > 0
       and item_code = any(array[app.cat_churu_item()] || app.cat_fish_items());

    if v_held is null then
      v_outcome := 'no_snack';
    else
      if p_snack is null then
        -- 고르지 않았는데 여러 종류면 화면이 먼저 고르게 한다.
        if array_length(v_held, 1) > 1 then raise exception 'SNACK_CHOICE'; end if;
        v_snack := v_held[1];
      elsif p_snack = any(v_held) then
        v_snack := p_snack;
      else
        raise exception 'NO_SUCH_ITEM';
      end if;

      v_fish := v_snack = any(app.cat_fish_items());
      select name into v_snack_nm from public.item_defs where code = v_snack;

      perform app.take_one_item(v_uid, v_snack);

      -- 친밀도가 다 찼어도 그냥 더한다 — 넘친 몫은 화면에 안 보일 뿐이다.
      update public.cat_bonds
         set churu_given = churu_given
               + case when v_fish then app.cat_fish_bond() else app.cat_churu_bond() end
       where user_id = v_uid
      returning churu_given into v_given;

      v_outcome := 'fed';

      -- 내가 이름을 지어 준 뒤에만 은혜를 갚는다. 화면에는 알리지 않는다.
      -- 생선은 츄르보다 확실하게 갚는다(app.cat_fish_gift_rate).
      if v_fish then
        v_rate := app.cat_fish_gift_rate();
      else
        v_rate := app.cat_gift_rate();
      end if;

      if v_bond.name is not null and random() < v_rate then
        insert into public.cat_gifts (user_id, item_code, ready_at)
        values (
          v_uid,
          v_gifts[1 + floor(random() * array_length(v_gifts, 1))::integer],
          now() + app.cat_gift_delay()
        );
      end if;
    end if;
  else
    if v_given < app.cat_friend_need() then
      v_outcome := 'shy';
    else
      v_outcome := 'petted';
      update public.cat_bonds set petted = true where user_id = v_uid;
      v_can_name := v_bond.name is null;
    end if;
  end if;

  update public.search_offers set cat = 'done'
   where user_id = v_uid and day = app.today_kst();

  perform app.log(v_uid, 'cat',
    case v_outcome
      when 'fed'    then '고양이 간식'
      when 'petted' then '고양이 쓰다듬기'
      else '고양이 도망'
    end,
    0, v_p.coins,
    jsonb_build_object('outcome', v_outcome, 'place', v_offer.place, 'snack', v_snack));

  return jsonb_build_object(
    'outcome', v_outcome,
    'snack', v_snack,
    'snack_name', v_snack_nm,
    'churu_given', v_given,
    'need', app.cat_friend_need(),
    'cat_name', v_bond.name,
    'can_name', v_can_name
  );
end;
$$;

CREATE FUNCTION public.cat_favorite() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app.cat_open(v_uid) then return jsonb_build_object('username', null); end if;

  perform app.cat_favorite_refresh(null);

  return jsonb_build_object('username', (
    select p.username from public.cat_favorite f
      join public.profiles p on p.id = f.user_id
     where f.id = 1));
end;
$$;

CREATE FUNCTION public.cat_gift_resolve(p_id bigint, p_keep boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_p        public.profiles;
  v_code     text;
  v_def      public.item_defs;
  v_keep     boolean := coalesce(p_keep, false);
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if not app.cat_open(v_uid) then raise exception 'CAT_NOT_OPEN'; end if;

  update public.cat_gifts
     set resolved_at = now(), kept = v_keep
   where id = p_id and user_id = v_uid
     and resolved_at is null and ready_at <= now()
  returning item_code into v_code;
  if v_code is null then raise exception 'GIFT_GONE'; end if;

  select * into v_def from public.item_defs where code = v_code;

  if v_keep then
    insert into public.inventories (user_id, item_code, qty)
    values (v_uid, v_code, 1)
    on conflict (user_id, item_code)
      do update set qty = inventories.qty + excluded.qty;

    perform app.cat_favorite_refresh(v_uid);
  end if;

  v_p := app.accrue(v_uid);
  perform app.log(v_uid, 'cat',
    case when v_keep then '고양이의 선물' else '선물 돌려줌' end,
    0, v_p.coins,
    jsonb_build_object('code', v_code, 'kept', v_keep));

  return jsonb_build_object(
    'kept', v_keep,
    'cat_name', app.cat_name_of(v_uid),
    'item', jsonb_build_object(
      'code', v_def.code,
      'name', v_def.name,
      'emoji', v_def.emoji,
      'grade', v_def.grade,
      'kind', v_def.kind
    )
  );
end;
$$;

CREATE FUNCTION public.cat_gift_toss(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
  v_def public.item_defs;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_code is null or not (p_code = any(app.cat_gift_items())) then
    raise exception 'NO_SUCH_ITEM';
  end if;

  select * into v_def from public.item_defs where code = p_code;
  perform app.take_one_item(v_uid, p_code);
  perform app.cat_favorite_refresh(v_uid);

  v_p := app.accrue(v_uid);
  perform app.log(v_uid, 'cat', '선물 몰래 정리', 0, v_p.coins,
    jsonb_build_object('code', p_code));

  return app.state_json(v_p) || jsonb_build_object('cat_toss', jsonb_build_object(
    'code', v_def.code,
    'name', v_def.name,
    'cat_name', app.cat_name_of(v_uid)
  ));
end;
$$;

CREATE FUNCTION public.cat_gift_use(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
  v_def public.item_defs;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_code is null or not (p_code = any(app.cat_gift_items())) then
    raise exception 'NO_SUCH_ITEM';
  end if;

  -- 행을 잡아 두 번 눌러 효과가 겹쳐 켜지는 걸 막는다.
  perform app.accrue(v_uid);
  select * into v_p from public.profiles where id = v_uid for update;

  -- 네잎클로버처럼 한 번에 하나 — 같은 효과가 남아 있으면 막는다.
  if (p_code = 'feather'  and v_p.cat_boost_left > 0)
  or (p_code = 'toy_mouse' and v_p.cat_search_boost)
  or (p_code = 'butterfly'   and v_p.cat_labor_good) then
    raise exception 'CAT_GIFT_ACTIVE';
  end if;

  select * into v_def from public.item_defs where code = p_code;
  perform app.take_one_item(v_uid, p_code);

  update public.profiles
     set cat_boost       = case when p_code = 'feather' then app.cat_bird_stake() else cat_boost end,
         cat_boost_left  = case when p_code = 'feather' then app.cat_bird_plays() else cat_boost_left end,
         cat_search_boost = cat_search_boost or p_code = 'toy_mouse',
         cat_labor_good  = cat_labor_good  or p_code = 'butterfly'
   where id = v_uid;

  perform app.cat_favorite_refresh(v_uid);

  v_p := app.accrue(v_uid);
  perform app.log(v_uid, 'cat', '선물 사용', 0, v_p.coins,
    jsonb_build_object('code', p_code));

  return app.state_json(v_p) || jsonb_build_object('cat_use', jsonb_build_object(
    'code', p_code,
    'name', v_def.name,
    'cat_name', app.cat_name_of(v_uid)
  ));
end;
$$;

CREATE FUNCTION public.cat_gifts_pending() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_p    public.profiles;
  v_fx   jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_p from public.profiles where id = v_uid;
  v_fx := jsonb_build_object(
    'bless_left',  coalesce(v_p.cat_boost_left, 0),
    'search_ready', coalesce(v_p.cat_search_boost, false),
    'labor_ready', coalesce(v_p.cat_labor_good, false));

  -- 공개 전에는 일반 유저에게 아무것도 보이지 않는다.
  if not app.cat_open(v_uid) then
    return v_fx || jsonb_build_object('cat_name', null, 'gifts', '[]'::jsonb);
  end if;

  return v_fx || jsonb_build_object(
    'cat_name', app.cat_name_of(v_uid),
    'gifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'code', d.code,
               'name', d.name,
               'emoji', d.emoji,
               'grade', d.grade,
               'kind', d.kind
             ) order by g.ready_at)
        from public.cat_gifts g
        join public.item_defs d on d.code = g.item_code
       where g.user_id = v_uid
         and g.resolved_at is null
         and g.ready_at <= now()
    ), '[]'::jsonb)
  );
end;
$$;

CREATE FUNCTION public.cat_set_name(p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_bond  public.cat_bonds;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if not app.cat_open(v_uid) then raise exception 'CAT_NOT_OPEN'; end if;

  if char_length(v_name) < 1 or char_length(v_name) > app.cat_name_max() then
    raise exception 'CAT_NAME_INVALID';
  end if;

  select * into v_bond from public.cat_bonds where user_id = v_uid for update;
  if not found or not v_bond.petted or v_bond.name is not null then
    raise exception 'CAT_NAME_TAKEN';
  end if;

  update public.cat_bonds set name = v_name, named_at = now() where user_id = v_uid;

  v_p := app.accrue(v_uid);
  perform app.log(v_uid, 'cat', '고양이 이름', 0, v_p.coins,
    jsonb_build_object('name', v_name));

  return jsonb_build_object('cat_name', v_name);
end;
$$;

CREATE FUNCTION public.cat_test(p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app.search_is_tester(v_uid) then raise exception 'NOT_ADMIN'; end if;

  case p_action
    when 'here' then
      insert into public.search_offers (user_id, day, place, cat)
      values (v_uid, app.today_kst(), app.cat_place(v_uid, app.today_kst()), 'waiting')
      on conflict (user_id, day)
        do update set place = excluded.place, cat = 'waiting';
    when 'churu' then
      insert into public.inventories (user_id, item_code, qty)
      values (v_uid, app.cat_churu_item(), 3)
      on conflict (user_id, item_code)
        do update set qty = inventories.qty + excluded.qty;
    when 'fish' then
      insert into public.inventories (user_id, item_code, qty)
      select v_uid, f, 1 from unnest(app.cat_fish_items()) f
      on conflict (user_id, item_code)
        do update set qty = inventories.qty + excluded.qty;
    when 'friend' then
      insert into public.cat_bonds (user_id, churu_given)
      values (v_uid, app.cat_friend_need())
      on conflict (user_id)
        do update set churu_given = greatest(cat_bonds.churu_given, excluded.churu_given);
    when 'gifts_now' then
      update public.cat_gifts set ready_at = now()
       where user_id = v_uid and resolved_at is null and ready_at > now();
    when 'deads' then
      insert into public.inventories (user_id, item_code, qty)
      select v_uid, g, 1 from unnest(app.cat_gift_items()) g
      on conflict (user_id, item_code)
        do update set qty = inventories.qty + excluded.qty;
      perform app.cat_favorite_refresh(v_uid);
    when 'reset' then
      delete from public.cat_bonds where user_id = v_uid;
      delete from public.cat_gifts where user_id = v_uid;
      delete from public.inventories
       where user_id = v_uid and item_code = any(app.cat_gift_items());
      update public.profiles
         set cat_boost = 0, cat_boost_left = 0, cat_search_boost = false, cat_labor_good = false
       where id = v_uid;
      perform app.cat_favorite_refresh(null);
    else
      raise exception 'INVALID_ACTION';
  end case;

  return public.search_board();
end;
$$;

CREATE FUNCTION public.search_board() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.search_look(p_place text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

  -- 시험 계정은 하루 한 번 제한도 에너지도 없다 — 고양이를 시험하려고 몇 번이고 탐험한다.
  v_tester := app.search_is_tester(v_uid);
  v_hp_cut := case when v_tester then 0 else app.search_hp_cost() end;

  if not v_tester and exists (
    select 1 from public.search_offers
     where user_id = v_uid and day = app.today_kst()
  ) then
    raise exception 'SEARCH_USED';
  end if;

  -- 에너지가 딱 소모량이어도 막는다 — 탐험으로는 바닥나지 않는다.
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
  -- 에너지와 오늘 몫은 그대로 나간다. 간식주기/쓰다듬기는 public.cat_act 가 받는다.
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
  v_code := app.roll_search(p_place, app.cat_search_boost_take(v_uid));
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

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.cat_bless_charge(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.cat_favorite_refresh(p_actor uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.cat_labor_good_take(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.cat_search_boost_take(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.cat_name_of(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.cat_open(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.cat_place(p_uid uuid, p_day date) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.cat_scores() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.roll_search(p_place text, p_lucky boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.roll_search_grade() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.search_exclude() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.search_hp_cost() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.search_is_tester(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.search_kinds(p_place text) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.search_miss_rate() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.search_ration_item() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.search_ration_rate() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.cat_act(p_action text, p_snack text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_act(p_action text, p_snack text) TO anon;
GRANT ALL ON FUNCTION public.cat_act(p_action text, p_snack text) TO authenticated;
GRANT ALL ON FUNCTION public.cat_act(p_action text, p_snack text) TO service_role;

REVOKE ALL ON FUNCTION public.cat_favorite() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_favorite() TO anon;
GRANT ALL ON FUNCTION public.cat_favorite() TO authenticated;
GRANT ALL ON FUNCTION public.cat_favorite() TO service_role;

REVOKE ALL ON FUNCTION public.cat_gift_resolve(p_id bigint, p_keep boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_gift_resolve(p_id bigint, p_keep boolean) TO anon;
GRANT ALL ON FUNCTION public.cat_gift_resolve(p_id bigint, p_keep boolean) TO authenticated;
GRANT ALL ON FUNCTION public.cat_gift_resolve(p_id bigint, p_keep boolean) TO service_role;

REVOKE ALL ON FUNCTION public.cat_gift_toss(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_gift_toss(p_code text) TO anon;
GRANT ALL ON FUNCTION public.cat_gift_toss(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.cat_gift_toss(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.cat_gift_use(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_gift_use(p_code text) TO anon;
GRANT ALL ON FUNCTION public.cat_gift_use(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.cat_gift_use(p_code text) TO service_role;

REVOKE ALL ON FUNCTION public.cat_gifts_pending() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_gifts_pending() TO anon;
GRANT ALL ON FUNCTION public.cat_gifts_pending() TO authenticated;
GRANT ALL ON FUNCTION public.cat_gifts_pending() TO service_role;

REVOKE ALL ON FUNCTION public.cat_set_name(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_set_name(p_name text) TO anon;
GRANT ALL ON FUNCTION public.cat_set_name(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.cat_set_name(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.cat_test(p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cat_test(p_action text) TO anon;
GRANT ALL ON FUNCTION public.cat_test(p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.cat_test(p_action text) TO service_role;

REVOKE ALL ON FUNCTION public.search_board() FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_board() TO anon;
GRANT ALL ON FUNCTION public.search_board() TO authenticated;
GRANT ALL ON FUNCTION public.search_board() TO service_role;

REVOKE ALL ON FUNCTION public.search_look(p_place text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_look(p_place text) TO anon;
GRANT ALL ON FUNCTION public.search_look(p_place text) TO authenticated;
GRANT ALL ON FUNCTION public.search_look(p_place text) TO service_role;

GRANT ALL ON TABLE public.cat_bonds TO anon;
GRANT ALL ON TABLE public.cat_bonds TO authenticated;
GRANT ALL ON TABLE public.cat_bonds TO service_role;

GRANT ALL ON TABLE public.cat_favorite TO anon;
GRANT ALL ON TABLE public.cat_favorite TO authenticated;
GRANT ALL ON TABLE public.cat_favorite TO service_role;

GRANT ALL ON TABLE public.cat_gifts TO anon;
GRANT ALL ON TABLE public.cat_gifts TO authenticated;
GRANT ALL ON TABLE public.cat_gifts TO service_role;

GRANT ALL ON SEQUENCE public.cat_gifts_id_seq TO anon;
GRANT ALL ON SEQUENCE public.cat_gifts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.cat_gifts_id_seq TO service_role;

GRANT ALL ON TABLE public.search_offers TO anon;
GRANT ALL ON TABLE public.search_offers TO authenticated;
GRANT ALL ON TABLE public.search_offers TO service_role;
