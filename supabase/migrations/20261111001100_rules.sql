-- rules — 게임 배당표와 get_rules()
--
-- 규칙 값의 정본은 서버다. play_game 은 아래 함수들로 배당을 정하고,
-- 화면은 get_rules() 한 번으로 같은 값을 받아 그린다(클라이언트에 같은 숫자를 따로 적지 않는다).
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다.

set check_function_bodies = false;

-- ── 룰렛: 0 = 초록, 1~7 = 빨강, 8~14 = 검정 ─────────────────────────────
-- 15칸이라 색(7칸) ×2.1 과 숫자(1칸) ×14.7 의 하우스 엣지가 같다(둘 다 2.00%).
CREATE FUNCTION app.roulette_slots() RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$ select 15 $$;

CREATE FUNCTION app.roulette_color_mult() RETURNS numeric
    LANGUAGE sql IMMUTABLE AS $$ select 2.1 $$;

CREATE FUNCTION app.roulette_number_mult() RETURNS numeric
    LANGUAGE sql IMMUTABLE AS $$ select 14.7 $$;

-- ── 슬롯: 릴 하나에 들어 있는 그림 21칸 ────────────────────────────────
CREATE FUNCTION app.slot_pool() RETURNS text[]
    LANGUAGE sql IMMUTABLE AS $$
  select array[
    'cherry','cherry','cherry','cherry','cherry','cherry',
    'lemon','lemon','lemon','lemon','lemon',
    'bell','bell','bell','bell',
    'star','star','star',
    'seven','seven',
    'diamond'
  ]
$$;

-- 세 칸 일치 배당
CREATE FUNCTION app.slot_triple_mult(p_symbol text) RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$
  select case p_symbol
           when 'diamond' then 40 when 'seven' then 25
           when 'star' then 12 when 'bell' then 8
           when 'lemon' then 6 else 4 end
$$;

-- 두 칸 일치 배당. 위 표와 합쳐 하우스 엣지 1.91%.
CREATE FUNCTION app.slot_pair_mult() RETURNS numeric
    LANGUAGE sql IMMUTABLE AS $$ select 1.45 $$;

-- ── 키노: 1~40 중 5개를 고르면 서버가 10개를 뽑는다 ───────────────────
CREATE FUNCTION app.keno_range() RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$ select 40 $$;

CREATE FUNCTION app.keno_picks() RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$ select 5 $$;

CREATE FUNCTION app.keno_draws() RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$ select 10 $$;

-- 적중 수별 배당. 1개 이하는 0. 재추첨(app.keno_*_keep)과 합쳐 RTP ≈ 0.98.
CREATE FUNCTION app.keno_mult(p_hits integer) RETURNS numeric
    LANGUAGE sql IMMUTABLE AS $$
  select case p_hits when 5 then 60 when 4 then 30 when 3 then 15 when 2 then 1.5 else 0 end
$$;

-- ── 화면에 내려주는 규칙 한 묶음 ────────────────────────────────────────
-- 비밀이 아닌 값만 담는다. 경마 컨디션·공제 계산 같은 숨은 값은 넣지 않는다.
CREATE FUNCTION public.get_rules() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select jsonb_build_object(
    'play_limit',      app.daily_play_limit(),
    'play_wage',       app.play_wage(),
    'initial_coins',   app.initial_coins(),
    'hp_max',          app.hp_max(),
    'hp_per_play',     app.hp_per_play(),
    'rest_hours',      app.ward_hours(),
    'bonus_plays_max', app.max_bonus_plays(),
    'extra_plays_max', app.max_extra_plays(),
    'pvp_min_bet',     app.pvp_min_bet(),
    'operator_name',   app.hidden_name(),
    'roulette', jsonb_build_object(
      'slots',       app.roulette_slots(),
      'color_mult',  app.roulette_color_mult(),
      'number_mult', app.roulette_number_mult()),
    'slots', jsonb_build_object(
      'pool',      to_jsonb(app.slot_pool()),
      'triple',    (select jsonb_object_agg(s, app.slot_triple_mult(s))
                      from (select distinct unnest(app.slot_pool()) s) x),
      'pair_mult', app.slot_pair_mult()),
    'highlow', jsonb_build_object(
      'max_stage', app.hl_max_stage(),
      'edge',      (select jsonb_agg(app.hl_edge(i) order by i)
                      from generate_series(1, app.hl_max_stage()) i),
      'max_mult',  app.hl_max_mult()),
    'keno', jsonb_build_object(
      'range', app.keno_range(),
      'picks', app.keno_picks(),
      'draws', app.keno_draws(),
      'mult',  (select jsonb_object_agg(n, app.keno_mult(n))
                  from generate_series(2, app.keno_picks()) n)),
    'clover_stake',    (select stake_bonus from public.item_defs where code = 'clover'),
    'race', jsonb_build_object(
      'public',  app.race_public(),
      'min_bet', app.race_min_bet(),
      'max_bet', app.race_max_bet(),
      'take',    app.race_take())
  );
$$;

REVOKE ALL ON FUNCTION public.get_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rules() TO anon, authenticated, service_role;
