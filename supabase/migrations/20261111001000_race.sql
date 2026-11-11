-- race — 경마장
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.races (
    id bigint NOT NULL,
    day date NOT NULL,
    no smallint NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    created_by uuid,
    post_at timestamp with time zone NOT NULL,
    distance integer NOT NULL,
    track smallint NOT NULL,
    entries smallint[] NOT NULL,
    cond smallint[] NOT NULL,
    wdelta smallint[] NOT NULL,
    odds jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    result jsonb,
    ranks smallint[],
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT races_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text])))
);

CREATE TABLE public.race_bets (
    id bigint NOT NULL,
    race_id bigint NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    picks smallint[] NOT NULL,
    amount integer NOT NULL,
    odds numeric(6,1) NOT NULL,
    payout integer,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT race_bets_amount_check CHECK ((amount > 0)),
    CONSTRAINT race_bets_kind_check CHECK ((kind = ANY (ARRAY['win'::text, 'place'::text, 'quin'::text])))
);

ALTER TABLE public.race_bets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.race_bets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.race_days (
    day date NOT NULL,
    track smallint NOT NULL,
    lineup smallint[] NOT NULL,
    cond smallint[] NOT NULL,
    wdelta smallint[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT race_days_track_check CHECK (((track >= 0) AND (track <= 3)))
);

CREATE TABLE public.race_horses (
    id smallint NOT NULL,
    name text NOT NULL,
    coat text NOT NULL,
    face text NOT NULL,
    legs text NOT NULL,
    sex text NOT NULL,
    age smallint NOT NULL,
    weight smallint NOT NULL,
    spd smallint NOT NULL,
    sta smallint NOT NULL,
    acc smallint NOT NULL,
    gut smallint NOT NULL,
    stb smallint NOT NULL,
    style smallint NOT NULL,
    dist text NOT NULL,
    wet smallint NOT NULL,
    bio text NOT NULL,
    CONSTRAINT race_horses_dist_check CHECK ((dist = ANY (ARRAY['S'::text, 'M'::text, 'L'::text]))),
    CONSTRAINT race_horses_style_check CHECK (((style >= 1) AND (style <= 4))),
    CONSTRAINT race_horses_wet_check CHECK (((wet >= '-1'::integer) AND (wet <= 1)))
);

CREATE TABLE public.race_tips (
    user_id uuid NOT NULL,
    race_id bigint NOT NULL,
    gates smallint[] NOT NULL,
    revealed smallint DEFAULT 0 NOT NULL
);

ALTER TABLE public.races ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.races_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.race_bets
    ADD CONSTRAINT race_bets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.race_days
    ADD CONSTRAINT race_days_pkey PRIMARY KEY (day);

ALTER TABLE ONLY public.race_horses
    ADD CONSTRAINT race_horses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.race_tips
    ADD CONSTRAINT race_tips_pkey PRIMARY KEY (user_id, race_id);

ALTER TABLE ONLY public.races
    ADD CONSTRAINT races_pkey PRIMARY KEY (id);

CREATE INDEX race_bets_race_idx ON public.race_bets USING btree (race_id, user_id);

CREATE UNIQUE INDEX races_day_no_idx ON public.races USING btree (day, no) WHERE (NOT is_test);

CREATE INDEX races_open_idx ON public.races USING btree (status, post_at);

ALTER TABLE ONLY public.race_bets
    ADD CONSTRAINT race_bets_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.races(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.race_bets
    ADD CONSTRAINT race_bets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.race_tips
    ADD CONSTRAINT race_tips_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.races(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.race_tips
    ADD CONSTRAINT race_tips_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.races
    ADD CONSTRAINT races_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.race_bets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.race_days ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.race_horses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.race_tips ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.race_cond_pct(p_lvl smallint) RETURNS double precision
    LANGUAGE sql IMMUTABLE
    AS $$
  select (array[0.6, 0.3, 0, -0.3, -0.6]::double precision[])[p_lvl + 1]
$$;

CREATE FUNCTION app.race_create(p_day date, p_no smallint, p_test boolean, p_post timestamp with time zone, p_entries smallint[], p_dist integer, p_track smallint, p_cond smallint[], p_wdelta smallint[], p_by uuid) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_id bigint;
begin
  insert into public.races
    (day, no, is_test, created_by, post_at, distance, track, entries, cond, wdelta, odds)
  values
    (p_day, p_no, p_test, p_by, p_post, p_dist, p_track, p_entries, p_cond, p_wdelta,
     app.race_odds(app.race_stats(p_entries), p_dist, p_track, app.race_mc_runs()))
  on conflict (day, no) where not is_test do nothing
  returning id into v_id;
  return v_id;
end;
$$;

CREATE FUNCTION app.race_distances() RETURNS integer[]
    LANGUAGE sql IMMUTABLE
    AS $$ select array[1000, 1200, 1400, 1600, 1800, 2000] $$;

CREATE FUNCTION app.race_ensure(p_day date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  d       public.race_days;
  v_hours integer[] := app.race_post_hours();
  v_f     integer := app.race_field();
  v_no    integer;
  v_cond  smallint[];
  v_wd    smallint[];
  v_ent   smallint[];
  i       integer;
begin
  if (select count(*) from public.races
       where day = p_day and not is_test) >= array_length(v_hours, 1) then
    return;
  end if;

  -- 출전표 만들기(몬테카를로)는 한 사람만 한다.
  perform pg_advisory_xact_lock(hashtext('race_ensure'));

  select * into d from public.race_days where day = p_day;
  if not found then
    v_cond := '{}'; v_wd := '{}';
    for i in 1..20 loop
      v_cond := v_cond || app.race_roll_cond();
      v_wd   := v_wd || app.race_wdelta(v_cond[i]);
    end loop;
    insert into public.race_days (day, track, lineup, cond, wdelta)
    values (p_day, floor(random() * 4)::smallint,
            app.pick_shuffled(1, 20, v_f * array_length(v_hours, 1)), v_cond, v_wd)
    on conflict (day) do nothing;
    select * into d from public.race_days where day = p_day;
  end if;

  for v_no in 1..array_length(v_hours, 1) loop
    if exists (select 1 from public.races where day = p_day and no = v_no and not is_test) then
      continue;
    end if;
    -- 발주 시각이 이미 지난 칸은 만들지 않는다 — 아무도 살 수 없었던 경주이고,
    -- 지운 경주가 다음 호출 때 결과까지 난 채로 되살아나는 것도 막는다.
    if ((p_day + make_time(v_hours[v_no], 0, 0)) at time zone 'Asia/Seoul') <= now() then
      continue;
    end if;
    v_ent := d.lineup[(v_no - 1) * v_f + 1 : v_no * v_f];
    select array_agg(d.cond[e] order by o), array_agg(d.wdelta[e] order by o)
      into v_cond, v_wd
      from unnest(v_ent) with ordinality u(e, o);
    perform app.race_create(
      p_day, v_no::smallint, false,
      ((p_day + make_time(v_hours[v_no], 0, 0)) at time zone 'Asia/Seoul'),
      v_ent,
      (app.race_distances())[1 + floor(random() * array_length(app.race_distances(), 1))::integer],
      d.track, v_cond, v_wd, null);
  end loop;
end;
$$;

CREATE FUNCTION app.race_field() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 8 $$;

CREATE FUNCTION app.race_gate() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_tester boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_tester := app.race_is_tester(auth.uid());
  if not app.race_public() and not v_tester then
    raise exception 'RACE_NOT_OPEN';
  end if;
  return v_tester;
end;
$$;

CREATE FUNCTION app.race_is_tester(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((select is_admin and username = app.race_tester_name()
                     from public.profiles where id = p_uid), false)
$$;

CREATE FUNCTION app.race_json(r public.races, p_uid uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'id',       r.id,
    'day',      r.day,
    'no',       r.no,
    'is_test',  r.is_test,
    'post_at',  r.post_at,
    'distance', r.distance,
    'track',    r.track,
    'status',   r.status,
    'entries',  (select jsonb_agg(jsonb_build_object(
                          'gate', g, 'horse', r.entries[g],
                          'weight', h.weight + r.wdelta[g], 'wdelta', r.wdelta[g])
                        order by g)
                   from generate_subscripts(r.entries, 1) g
                   join public.race_horses h on h.id = r.entries[g]),
    'odds',     r.odds,
    'result',   r.result,
    'ranks',    to_jsonb(r.ranks),
    'cond',     case when r.status = 'done' then to_jsonb(r.cond) end,
    'tickets',  coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', b.id, 'kind', b.kind, 'picks', b.picks,
                                   'amount', b.amount, 'odds', b.odds, 'payout', b.payout)
                                 order by b.id)
                            from public.race_bets b
                           where b.race_id = r.id and b.user_id = p_uid), '[]'::jsonb)
  )
$$;

CREATE FUNCTION app.race_max_bet() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 300 $$;

CREATE FUNCTION app.race_mc_runs() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 1500 $$;

CREATE FUNCTION app.race_min_bet() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 20 $$;

CREATE FUNCTION app.race_odds(p_stats double precision[], p_dist integer, p_track smallint, p_runs integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare
  n    integer := array_length(p_stats, 1) / 8;
  w    integer[] := array_fill(0, array[n]);
  pl   integer[] := array_fill(0, array[n]);
  q    integer[] := array_fill(0, array[n * n]);
  c    smallint[];
  t    double precision[];
  rk   smallint[];
  r integer; i integer; a integer; b integer;
  pairs integer := n * (n - 1) / 2;
  jw   jsonb := '[]';
  jp   jsonb := '[]';
  jq   jsonb := '{}';
begin
  for r in 1..p_runs loop
    c := '{}';
    for i in 1..n loop c := c || app.race_roll_cond(); end loop;
    t  := app.race_run(p_stats, p_dist, p_track, c);
    rk := app.race_ranks(t, n);
    for i in 1..n loop
      if rk[i] = 1 then w[i] := w[i] + 1; a := i; end if;
      if rk[i] = 2 then b := i; end if;
      if rk[i] <= 3 then pl[i] := pl[i] + 1; end if;
    end loop;
    i := (least(a, b) - 1) * n + greatest(a, b);
    q[i] := q[i] + 1;
  end loop;

  for i in 1..n loop
    jw := jw || to_jsonb(app.race_price(greatest(w[i], 0.5) / p_runs));
    jp := jp || to_jsonb(app.race_price(greatest(pl[i], 0.5) / p_runs));
  end loop;
  -- 복승은 조합이 많아 0회가 흔하다 — +1 평활로 터무니없는 배당을 막는다.
  for a in 1..n - 1 loop
    for b in a + 1..n loop
      jq := jq || jsonb_build_object(a || '-' || b,
              app.race_price((q[(a - 1) * n + b] + 1)::double precision / (p_runs + pairs)));
    end loop;
  end loop;
  return jsonb_build_object('win', jw, 'place', jp, 'quin', jq);
end;
$$;

CREATE FUNCTION app.race_odds_cap() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 200.0 $$;

CREATE FUNCTION app.race_post_hours() RETURNS integer[]
    LANGUAGE sql IMMUTABLE
    AS $$ select array[10, 22] $$;

CREATE FUNCTION app.race_practice_gap() RETURNS interval
    LANGUAGE sql IMMUTABLE
    AS $$ select interval '20 seconds' $$;

CREATE FUNCTION app.race_price(p double precision) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
  select least(app.race_odds_cap(),
               greatest(1.1, floor((1 - app.race_take()) / greatest(p, 1e-6) * 10) / 10))::numeric(6, 1)
$$;

CREATE FUNCTION app.race_public() RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$ select true $$;

CREATE FUNCTION app.race_ranks(p_times double precision[], p_n integer) RETURNS smallint[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_r smallint[] := '{}';
  i integer; j integer; c integer;
begin
  for i in 1..p_n loop
    c := 1;
    for j in 1..p_n loop
      if p_times[j * 10] < p_times[i * 10]
         or (p_times[j * 10] = p_times[i * 10] and j < i) then
        c := c + 1;
      end if;
    end loop;
    v_r := v_r || c::smallint;
  end loop;
  return v_r;
end;
$$;

CREATE FUNCTION app.race_roll_cond() RETURNS smallint
    LANGUAGE sql
    AS $$
  select case when r < 0.10 then 0 when r < 0.32 then 1 when r < 0.68 then 2
              when r < 0.90 then 3 else 4 end::smallint
    from (select random() as r) x
$$;

CREATE FUNCTION app.race_run(p_stats double precision[], p_dist integer, p_track smallint, p_cond smallint[]) RETURNS double precision[]
    LANGUAGE plpgsql
    AS $$
declare
  n     integer := array_length(p_cond, 1);
  seg   double precision := p_dist / 10.0;
  dcat  integer := case when p_dist <= 1200 then 0 when p_dist <= 1600 then 1 else 2 end;
  v_out double precision[] := array_fill(0::double precision, array[n * 10]);
  i integer; k integer; o integer;
  spd double precision; sta double precision; acc double precision; gut double precision;
  stb double precision; sty integer; dp integer; wp double precision;
  base double precision; cm double precision; dmis double precision; wm double precision;
  sig double precision; form double precision; m double precision; t double precision;
  curve double precision[];
begin
  for i in 1..n loop
    o   := (i - 1) * 8;
    spd := p_stats[o + 1]; sta := p_stats[o + 2]; acc := p_stats[o + 3]; gut := p_stats[o + 4];
    stb := p_stats[o + 5]; sty := p_stats[o + 6]::integer; dp := p_stats[o + 7]::integer;
    wp  := p_stats[o + 8];

    base := 16 + (spd - 75) * 0.018;
    cm   := app.race_cond_pct(p_cond[i]) / 100;
    dmis := abs(dp - dcat) * 0.01;
    wm   := wp * (p_track - 1.5) * 0.005;
    sig  := 0.014 * (1.6 - stb / 100);
    form := sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()) * sig;
    -- 초반(0~2) · 중반(3~6) · 막판(7~9) 가감(%). 구간 수를 곱한 합이 0 이다.
    curve := case sty
               when 1 then array[2.0, 0, -2.0]
               when 2 then array[1.0, 0.5, -5.0 / 3]
               when 3 then array[-1.0, 0, 1.0]
               else        array[-2.0, -0.5, 8.0 / 3]
             end::double precision[];
    t := 0;
    for k in 0..9 loop
      m := 1 + cm - dmis + wm + form
             + curve[case when k < 3 then 1 when k < 7 then 2 else 3 end] / 100;
      if k < 2 then m := m + (acc - 75) * 0.0008; end if;
      if k >= 7 then m := m + (gut - 75) * 0.0008; end if;
      m := m - greatest(0, (p_dist / 1000.0) * ((k + 0.5) / 10) - sta / 80) * 0.04;
      m := m + sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()) * sig;
      t := t + seg / (base * m);
      v_out[(i - 1) * 10 + k + 1] := t;
    end loop;
  end loop;
  return v_out;
end;
$$;

CREATE FUNCTION app.race_settle(p_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  r        public.races;
  n        integer;
  v_t      double precision[];
  v_rk     smallint[];
  v_order  smallint[];
  v_splits jsonb;
  v_winner text;
  u        record;
  v_coins  integer;
  v_name   text;
begin
  select * into r from public.races where id = p_id for update;
  if not found or r.status <> 'open' or r.post_at > now() then return; end if;

  n    := array_length(r.entries, 1);
  v_t  := app.race_run(app.race_stats(r.entries), r.distance, r.track, r.cond);
  v_rk := app.race_ranks(v_t, n);

  select array_agg(g::smallint order by v_rk[g]) into v_order from generate_series(1, n) g;
  select jsonb_agg(
           (select jsonb_agg(round(v_t[(g - 1) * 10 + k]::numeric, 3) order by k)
              from generate_series(1, 10) k)
           order by g)
    into v_splits
    from generate_series(1, n) g;

  update public.races
     set status = 'done', ranks = v_rk, settled_at = now(),
         result = jsonb_build_object('order', to_jsonb(v_order), 'splits', v_splits)
   where id = p_id;

  update public.race_bets b
     set payout = case
           when b.kind = 'win'   and v_rk[b.picks[1]] = 1 then floor(b.amount * b.odds)
           when b.kind = 'place' and v_rk[b.picks[1]] <= 3 then floor(b.amount * b.odds)
           when b.kind = 'quin'  and v_rk[b.picks[1]] <= 2 and v_rk[b.picks[2]] <= 2
             then floor(b.amount * b.odds)
           else 0
         end,
         settled_at = now()
   where b.race_id = p_id;

  -- 테스트 경주는 코인 · 원장 · 피드를 건드리지 않는다.
  if r.is_test then return; end if;

  select name into v_winner from public.race_horses where id = r.entries[v_order[1]];

  for u in
    select user_id, sum(amount)::integer as bet, sum(payout)::integer as pay,
           jsonb_agg(jsonb_build_object('kind', kind, 'picks', picks, 'amount', amount,
                                        'odds', odds, 'payout', payout) order by id) as tickets
      from public.race_bets
     where race_id = p_id
     group by user_id
  loop
    update public.profiles set coins = coins + u.pay
     where id = u.user_id
     returning coins, username into v_coins, v_name;
    if not found then continue; end if;

    insert into public.game_rounds
      (user_id, username, game, bet, choice, outcome, payout, balance_after)
    values
      (u.user_id, v_name, 'race', u.bet, r.no::text,
       jsonb_build_object('race_id', r.id, 'day', r.day, 'no', r.no,
                          'winner', v_winner, 'winner_gate', v_order[1],
                          'tickets', u.tickets),
       u.pay, v_coins);

    if u.pay > 0 then
      perform app.log(u.user_id, 'game', format('경마 · 제%s경주 적중', r.no),
                      u.pay, v_coins, jsonb_build_object('race_id', r.id, 'tickets', u.tickets));
    end if;
  end loop;
end;
$$;

CREATE FUNCTION app.race_settle_due() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_id bigint;
  v_n  integer := 0;
begin
  for v_id in
    select id from public.races
     where status = 'open' and post_at <= now()
     order by post_at
  loop
    perform app.race_settle(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

CREATE FUNCTION app.race_stats(p_entries smallint[]) RETURNS double precision[]
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select array_agg(v order by e.ord, s.k)
    from unnest(p_entries) with ordinality e(hid, ord)
    join public.race_horses h on h.id = e.hid
   cross join lateral unnest(array[
     h.spd, h.sta, h.acc, h.gut, h.stb, h.style,
     case h.dist when 'S' then 0 when 'M' then 1 else 2 end,
     h.wet
   ]::double precision[]) with ordinality s(v, k)
$$;

CREATE FUNCTION app.race_take() RETURNS double precision
    LANGUAGE sql IMMUTABLE
    AS $$ select 0.20::double precision $$;

-- 테스트(연습) 경주 편성. 정식 경주와 같은 출전표 · 배당 계산을 쓰고, 편성한 사람에게만 보인다.
-- 정산은 race_settle 이 하되 is_test 라 코인 · 원장 · 피드를 건드리지 않는다.
CREATE FUNCTION app.race_test_create(p_uid uuid, p_opts jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_ent   smallint[];
  v_cond  smallint[] := '{}';
  v_wd    smallint[] := '{}';
  v_dist  integer;
  v_track smallint;
  v_delay integer;
  i       integer;
begin
  p_opts := coalesce(p_opts, '{}'::jsonb);

  delete from public.races
   where is_test and created_by = p_uid
     and (status = 'open' or created_at < now() - interval '1 day');

  v_ent  := app.pick_shuffled(1, 20, app.race_field());
  v_dist := coalesce((p_opts ->> 'distance')::integer,
                     (app.race_distances())[1 + floor(random() * array_length(app.race_distances(), 1))::integer]);
  if not v_dist = any (app.race_distances()) then raise exception 'INVALID_CHOICE'; end if;
  v_track := coalesce((p_opts ->> 'track')::smallint, floor(random() * 4)::smallint);
  if v_track not between 0 and 3 then raise exception 'INVALID_CHOICE'; end if;
  v_delay := least(3600, greatest(10, coalesce((p_opts ->> 'delay_sec')::integer, 120)));
  for i in 1..array_length(v_ent, 1) loop
    v_cond := v_cond || app.race_roll_cond();
    v_wd   := v_wd || app.race_wdelta(v_cond[i]);
  end loop;
  return app.race_create(app.today_kst(), 0::smallint, true, now() + make_interval(secs => v_delay),
                         v_ent, v_dist, v_track, v_cond, v_wd, p_uid);
end;
$$;

-- 열린 테스트(연습) 경주를 지금 발주하고 바로 결과를 낸다.
CREATE FUNCTION app.race_test_start(p_uid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_id bigint;
begin
  select id into v_id from public.races
   where is_test and created_by = p_uid and status = 'open'
   order by created_at desc limit 1;
  if v_id is null then raise exception 'RACE_NOT_FOUND'; end if;
  update public.races set post_at = now() where id = v_id;
  perform app.race_settle(v_id);
end;
$$;

CREATE FUNCTION app.race_tester_name() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select app.hidden_name() $$;

CREATE FUNCTION app.race_tips_per_race() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.race_wdelta(p_lvl smallint) RETURNS smallint
    LANGUAGE sql
    AS $$
  select ((2 - p_lvl) * 2
          + round(sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()) * 1.5) * 2)::smallint
$$;

CREATE FUNCTION public.race_admin_test(p_action text, p_opts jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app.race_is_tester(v_uid) then raise exception 'NOT_ADMIN'; end if;

  if p_action = 'create' then
    perform app.race_test_create(v_uid, p_opts);

  elsif p_action = 'start' then
    perform app.race_test_start(v_uid);

  elsif p_action = 'reset_tips' then
    delete from public.race_tips where user_id = v_uid;

  else
    raise exception 'INVALID_CHOICE';
  end if;

  return public.race_card();
end;
$$;

CREATE FUNCTION public.race_bet(p_race bigint, p_kind text, p_picks integer[], p_amount integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  r       public.races;
  v_p     public.profiles;
  n       integer;
  v_picks smallint[];
  v_sum   integer;
  v_odds  numeric(6, 1);
  v_label text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.race_gate();

  -- 경주 행을 먼저 잠근다(정산과 같은 순서: 경주 → 프로필).
  select * into r from public.races where id = p_race for update;
  if not found or (r.is_test and r.created_by is distinct from v_uid) then
    raise exception 'RACE_NOT_FOUND';
  end if;
  if r.status <> 'open' or now() >= r.post_at then raise exception 'RACE_CLOSED'; end if;

  perform app.require_active();

  n := array_length(r.entries, 1);
  if p_kind is null or p_kind not in ('win', 'place', 'quin') or p_picks is null then
    raise exception 'INVALID_CHOICE';
  end if;
  if exists (select 1 from unnest(p_picks) x where x is null or x < 1 or x > n) then
    raise exception 'INVALID_CHOICE';
  end if;
  if p_kind = 'quin' then
    if coalesce(array_length(p_picks, 1), 0) <> 2 or p_picks[1] = p_picks[2] then
      raise exception 'INVALID_CHOICE';
    end if;
    v_picks := array[least(p_picks[1], p_picks[2]), greatest(p_picks[1], p_picks[2])]::smallint[];
    v_odds  := (r.odds -> 'quin' ->> (v_picks[1] || '-' || v_picks[2]))::numeric;
  else
    if coalesce(array_length(p_picks, 1), 0) <> 1 then raise exception 'INVALID_CHOICE'; end if;
    v_picks := array[p_picks[1]]::smallint[];
    v_odds  := (r.odds -> p_kind ->> (v_picks[1] - 1))::numeric;
  end if;

  if p_amount is null or p_amount < app.race_min_bet() then raise exception 'RACE_BET_LOW'; end if;
  select coalesce(sum(amount), 0) into v_sum
    from public.race_bets where race_id = r.id and user_id = v_uid;
  if v_sum + p_amount > app.race_max_bet() then raise exception 'RACE_BET_HIGH'; end if;

  v_p := app.accrue(v_uid);

  if not r.is_test then
    if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;
    if v_p.coins < p_amount then raise exception 'NOT_ENOUGH_COINS'; end if;
    if v_p.hp < app.hp_per_play() then raise exception 'NO_HP'; end if;

    update public.profiles set coins = coins - p_amount where id = v_uid;
    -- 베팅 한 장마다 에너지를 쓴다. 0 이 되면 spend_hp 가 휴식으로 보낸다.
    v_p := app.spend_hp(v_uid, app.hp_per_play());

    v_label := case p_kind when 'win' then '단승' when 'place' then '연승' else '복승' end;
    perform app.log(v_uid, 'game',
      format('경마 · 제%s경주 %s %s', r.no, v_label, array_to_string(v_picks, '-')),
      -p_amount, v_p.coins, jsonb_build_object('race_id', r.id, 'kind', p_kind,
                                               'picks', v_picks, 'odds', v_odds));
  end if;

  insert into public.race_bets (race_id, user_id, kind, picks, amount, odds)
  values (r.id, v_uid, p_kind, v_picks, p_amount, v_odds);

  return app.state_json(v_p);
end;
$$;

CREATE FUNCTION public.race_card() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_tester boolean;
begin
  v_tester := app.race_gate();

  -- 편성 먼저, 정산은 그 다음 — 발주 시각이 지난 칸은 편성하지 않고(race_ensure),
  -- 지났는데 아직 열린 경주는 여기서 결과가 난다.
  perform app.race_ensure(app.today_kst());
  perform app.race_ensure(app.today_kst() + 1);
  perform app.race_settle_due();

  return jsonb_build_object(
    'public',   app.race_public(),
    'tester',   v_tester,
    'now',      now(),
    'min_bet',  app.race_min_bet(),
    'max_bet',  app.race_max_bet(),
    'tips_per_race', app.race_tips_per_race(),
    'horses', (
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'name', h.name, 'coat', h.coat, 'face', h.face, 'legs', h.legs,
               'sex', h.sex, 'age', h.age, 'weight', h.weight,
               'spd', h.spd, 'sta', h.sta, 'acc', h.acc, 'gut', h.gut, 'stb', h.stb,
               'style', h.style, 'dist', h.dist, 'wet', h.wet, 'bio', h.bio,
               'runs', coalesce(rec.runs, 0), 'wins', coalesce(rec.wins, 0),
               'top3', coalesce(rec.top3, 0), 'last5', coalesce(rec.last5, '[]'::jsonb))
             order by h.id)
        from public.race_horses h
        left join lateral (
          select count(*)::integer as runs,
                 count(*) filter (where x.rk = 1)::integer as wins,
                 count(*) filter (where x.rk <= 3)::integer as top3,
                 (select jsonb_agg(y.rk order by y.post_at desc)
                    from (select r2.ranks[g2] as rk, r2.post_at
                            from public.races r2, generate_subscripts(r2.entries, 1) g2
                           where not r2.is_test and r2.status = 'done' and r2.entries[g2] = h.id
                           order by r2.post_at desc
                           limit 5) y) as last5
            from (select r.ranks[g] as rk
                    from public.races r, generate_subscripts(r.entries, 1) g
                   where not r.is_test and r.status = 'done' and r.entries[g] = h.id) x
        ) rec on true
    ),
    'upcoming', coalesce((
      select jsonb_agg(x.j order by x.post_at)
        from (select app.race_json(r, v_uid) as j, r.post_at
                from public.races r
               where not r.is_test and r.status = 'open' and r.post_at > now()
               order by r.post_at
               limit 2) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x.j order by x.post_at desc)
        from (select app.race_json(r, v_uid) as j, r.post_at
                from public.races r
               where not r.is_test and r.status = 'done'
               order by r.post_at desc
               limit 4) x), '[]'::jsonb),
    -- 본인이 편성한 연습 경주(관리자의 테스트 경주 포함). 남에게는 보이지 않는다.
    'test', (
      select app.race_json(r, v_uid)
        from public.races r
       where r.is_test and r.created_by = v_uid
       order by r.created_at desc
       limit 1)
  );
end;
$$;

-- 연습 경주 — 정식 발주(10:00 · 22:00) 밖에서도 누구나 경주를 한 번 돌려 볼 수 있다.
-- 코인 · 에너지 · 원장 · 피드는 움직이지 않는다(race_bet · race_settle 의 is_test 분기).
-- 편성은 배당 몬테카를로를 돌려 비싸므로 사람마다 간격을 둔다.
CREATE FUNCTION public.race_practice(p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.race_gate();
  perform app.require_active();

  if p_action = 'create' then
    perform pg_advisory_xact_lock(hashtext('race_practice:' || v_uid::text));
    if exists (select 1 from public.races
                where is_test and created_by = v_uid
                  and created_at > now() - app.race_practice_gap()) then
      raise exception 'RACE_PRACTICE_WAIT';
    end if;
    perform app.race_test_create(v_uid, jsonb_build_object('delay_sec', 60));

  elsif p_action = 'start' then
    perform app.race_test_start(v_uid);

  else
    raise exception 'INVALID_CHOICE';
  end if;

  return public.race_card();
end;
$$;

CREATE FUNCTION public.race_radio() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_tester boolean;
  r       public.races;
  t       public.race_tips;
  v_fresh boolean := false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  v_tester := app.race_gate();

  if not v_tester and not exists (
    select 1 from public.inventories
     where user_id = v_uid and item_code = 'radio' and qty > 0) then
    raise exception 'NOT_ENOUGH_ITEMS';
  end if;

  if v_tester then
    select * into r from public.races
     where is_test and created_by = v_uid and status = 'open'
     order by created_at desc limit 1;
  end if;
  if r.id is null then
    perform app.race_ensure(app.today_kst());
    perform app.race_ensure(app.today_kst() + 1);
    select * into r from public.races
     where not is_test and status = 'open' and post_at > now()
     order by post_at limit 1;
  end if;
  if r.id is null then
    return jsonb_build_object('race', null, 'tips', '[]'::jsonb, 'left', 0, 'fresh', false);
  end if;

  insert into public.race_tips (user_id, race_id, gates)
  values (v_uid, r.id,
          app.pick_shuffled(1, array_length(r.entries, 1), app.race_tips_per_race()))
  on conflict do nothing;

  update public.race_tips
     set revealed = revealed + 1
   where user_id = v_uid and race_id = r.id and revealed < array_length(gates, 1)
  returning * into t;
  v_fresh := found;
  if not v_fresh then
    select * into t from public.race_tips where user_id = v_uid and race_id = r.id;
  end if;

  return jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'day', r.day, 'no', r.no, 'is_test', r.is_test,
                               'post_at', r.post_at, 'distance', r.distance, 'track', r.track),
    'tips', coalesce((select jsonb_agg(jsonb_build_object(
                      'gate', g, 'horse', r.entries[g], 'name', h.name,
                      'level', r.cond[g], 'wdelta', r.wdelta[g])
                    order by o)
               from unnest(t.gates[1:t.revealed]) with ordinality u(g, o)
               join public.race_horses h on h.id = r.entries[g]), '[]'::jsonb),
    'left',  array_length(t.gates, 1) - t.revealed,
    'fresh', v_fresh
  );
end;
$$;

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.race_create(p_day date, p_no smallint, p_test boolean, p_post timestamp with time zone, p_entries smallint[], p_dist integer, p_track smallint, p_cond smallint[], p_wdelta smallint[], p_by uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_ensure(p_day date) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_gate() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_is_tester(p_uid uuid) FROM PUBLIC;

GRANT ALL ON TABLE public.races TO anon;
GRANT ALL ON TABLE public.races TO authenticated;
GRANT ALL ON TABLE public.races TO service_role;

REVOKE ALL ON FUNCTION app.race_json(r public.races, p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_odds(p_stats double precision[], p_dist integer, p_track smallint, p_runs integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_run(p_stats double precision[], p_dist integer, p_track smallint, p_cond smallint[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_settle(p_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_settle_due() FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_stats(p_entries smallint[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_test_create(p_uid uuid, p_opts jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.race_test_start(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.race_practice(p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.race_practice(p_action text) TO anon;
GRANT ALL ON FUNCTION public.race_practice(p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.race_practice(p_action text) TO service_role;

REVOKE ALL ON FUNCTION public.race_admin_test(p_action text, p_opts jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.race_admin_test(p_action text, p_opts jsonb) TO anon;
GRANT ALL ON FUNCTION public.race_admin_test(p_action text, p_opts jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.race_admin_test(p_action text, p_opts jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.race_bet(p_race bigint, p_kind text, p_picks integer[], p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.race_bet(p_race bigint, p_kind text, p_picks integer[], p_amount integer) TO anon;
GRANT ALL ON FUNCTION public.race_bet(p_race bigint, p_kind text, p_picks integer[], p_amount integer) TO authenticated;
GRANT ALL ON FUNCTION public.race_bet(p_race bigint, p_kind text, p_picks integer[], p_amount integer) TO service_role;

REVOKE ALL ON FUNCTION public.race_card() FROM PUBLIC;
GRANT ALL ON FUNCTION public.race_card() TO anon;
GRANT ALL ON FUNCTION public.race_card() TO authenticated;
GRANT ALL ON FUNCTION public.race_card() TO service_role;

REVOKE ALL ON FUNCTION public.race_radio() FROM PUBLIC;
GRANT ALL ON FUNCTION public.race_radio() TO anon;
GRANT ALL ON FUNCTION public.race_radio() TO authenticated;
GRANT ALL ON FUNCTION public.race_radio() TO service_role;

GRANT ALL ON TABLE public.race_bets TO anon;
GRANT ALL ON TABLE public.race_bets TO authenticated;
GRANT ALL ON TABLE public.race_bets TO service_role;

GRANT ALL ON SEQUENCE public.race_bets_id_seq TO anon;
GRANT ALL ON SEQUENCE public.race_bets_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.race_bets_id_seq TO service_role;

GRANT ALL ON TABLE public.race_days TO anon;
GRANT ALL ON TABLE public.race_days TO authenticated;
GRANT ALL ON TABLE public.race_days TO service_role;

GRANT ALL ON TABLE public.race_horses TO anon;
GRANT ALL ON TABLE public.race_horses TO authenticated;
GRANT ALL ON TABLE public.race_horses TO service_role;

GRANT ALL ON TABLE public.race_tips TO anon;
GRANT ALL ON TABLE public.race_tips TO authenticated;
GRANT ALL ON TABLE public.race_tips TO service_role;

GRANT ALL ON SEQUENCE public.races_id_seq TO anon;
GRANT ALL ON SEQUENCE public.races_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.races_id_seq TO service_role;
