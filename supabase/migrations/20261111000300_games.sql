-- games — 서버 판정 4게임(룰렛 · 슬롯 · 하이로우 · 키노)
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 함수 ════════

CREATE FUNCTION app.apply_win_double(p_uid uuid, p_payout integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_n integer;
begin
  if p_payout <= 0 then return p_payout; end if;

  select win_double into v_n from public.profiles where id = p_uid for update;
  if coalesce(v_n, 0) <= 0 then return p_payout; end if;

  update public.profiles set win_double = win_double - 1 where id = p_uid;
  return p_payout * 2;
end;
$$;

CREATE FUNCTION app.bonus_stake(p_uid uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_uid;
  return case when v_p.stake_boost_until > now() then v_p.stake_boost else 0 end
       + app.cat_bless_charge(p_uid);
end;
$$;

CREATE FUNCTION app.finish_round(p_id bigint, p_winner text, p_host jsonb, p_guest jsonb, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  m       public.matches;
  v_hw    integer;
  v_gw    integer;
  v_hist  jsonb;
begin
  select * into m from public.matches where id = p_id for update;

  v_hw := m.host_wins  + case when p_winner = 'host'  then 1 else 0 end;
  v_gw := m.guest_wins + case when p_winner = 'guest' then 1 else 0 end;

  v_hist := m.history || jsonb_build_array(jsonb_build_object(
    'round',  jsonb_array_length(m.history) + 1,
    'host',   p_host,
    'guest',  p_guest,
    'winner', case when p_winner = 'tie' then null else p_winner end,
    'reason', p_reason
  ));

  -- 두 판을 먼저 이겼으면 대전 종료
  if v_hw >= app.pvp_wins_needed() or v_gw >= app.pvp_wins_needed() then
    update public.matches
       set host_wins = v_hw, guest_wins = v_gw, history = v_hist,
           state = '{}'::jsonb, updated_at = now()
     where id = p_id;

    perform app.settle_match(
      p_id,
      case when v_hw > v_gw then 'host' else 'guest' end,
      jsonb_build_object('host_wins', v_hw, 'guest_wins', v_gw,
                         'history', v_hist, 'reason', p_reason));
    return;
  end if;

  -- 다음 판 준비
  if m.game = 'dice' then
    update public.matches
       set host_wins = v_hw, guest_wins = v_gw, history = v_hist,
           state = '{}'::jsonb, turn = null,
           expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
           updated_at = now()
     where id = p_id;
  elsif m.game = 'blackjack' then
    update public.matches
       set host_wins = v_hw, guest_wins = v_gw, history = v_hist,
           updated_at = now()
     where id = p_id;
    perform app.bj_deal(p_id);
  else
    update public.matches
       set host_wins = v_hw, guest_wins = v_gw, history = v_hist,
           state = jsonb_build_object(
                     'host_card',  1 + floor(random() * 13)::int,
                     'guest_card', 1 + floor(random() * 13)::int),
           turn = 'host',
           expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
           updated_at = now()
     where id = p_id;
  end if;
end;
$$;

CREATE FUNCTION app.hl_draw() RETURNS integer
    LANGUAGE sql
    AS $$ select 1 + floor(random() * 13)::int $$;

CREATE FUNCTION app.hl_edge(p_stage integer) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
    select case p_stage when 1 then 0.05 when 2 then 0.00
                        when 3 then -0.03 else 1 end;
  $$;

CREATE FUNCTION app.hl_max_mult() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 8.00 $$;

CREATE FUNCTION app.hl_max_stage() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.hl_mult(p_card integer, p_choice text, p_stage integer) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
    select case when app.hl_win_cards(p_card, p_choice) <= 0 then 0
           else least(app.hl_max_mult(),
                round((1 - app.hl_edge(p_stage)) * 13
                      / app.hl_win_cards(p_card, p_choice), 2))
           end;
  $$;

CREATE FUNCTION app.hl_win_cards(p_card integer, p_choice text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    select case p_choice when 'high' then 13 - p_card
                         when 'low'  then p_card - 1
                         else 1 end;
  $$;

CREATE FUNCTION app.keno_five_keep() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
    select least(1, app.keno_five_natural_one_in() / app.keno_five_one_in()
                    * app.keno_reroll_norm());
  $$;

CREATE FUNCTION app.keno_five_natural_one_in() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 2611.14 $$;

CREATE FUNCTION app.keno_five_one_in() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 9261 $$;

CREATE FUNCTION app.keno_four_keep() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
    select least(1, app.keno_four_natural_one_in() / app.keno_four_one_in()
                    * app.keno_reroll_norm());
  $$;

CREATE FUNCTION app.keno_four_natural_one_in() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 104.45 $$;

CREATE FUNCTION app.keno_four_one_in() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 4630 $$;

CREATE FUNCTION app.keno_reroll_norm() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
    select (1 - 1 / app.keno_three_natural_one_in() - 1 / app.keno_four_natural_one_in()
              - 1 / app.keno_five_natural_one_in())
         / (1 - 1 / app.keno_three_one_in()         - 1 / app.keno_four_one_in()
              - 1 / app.keno_five_one_in());
  $$;

CREATE FUNCTION app.keno_three_keep() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
    select least(1, app.keno_three_natural_one_in() / app.keno_three_one_in()
                    * app.keno_reroll_norm());
  $$;

CREATE FUNCTION app.keno_three_natural_one_in() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 12.6055 $$;

CREATE FUNCTION app.keno_three_one_in() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$ select 28.5 $$;

CREATE FUNCTION app.roll2() RETURNS jsonb
    LANGUAGE sql
    AS $$
    select jsonb_build_array(1 + floor(random() * 6)::int,
                             1 + floor(random() * 6)::int);
  $$;

CREATE FUNCTION public.highlow_begin(p_bet integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
  v_wage integer := 0;
  v_coins_after integer;
  v_outcome jsonb;
  v_bonus integer := 0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_bet is null or p_bet < 1 then raise exception 'INVALID_BET'; end if;

  v_p := app.accrue(v_uid);

  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;
  if v_p.hp < app.hp_per_play() then raise exception 'NO_HP'; end if;
  if v_p.plays_used >= app.daily_play_limit() + v_p.bonus_plays then
    raise exception 'DAILY_LIMIT';
  end if;
  if p_bet > v_p.coins then raise exception 'NOT_ENOUGH_COINS'; end if;
  if v_p.hl_bet > 0 then raise exception 'HIGHLOW_IN_PROGRESS'; end if;

  -- 네잎클로버 등 보너스(app.bonus_stake): 첫 판정의 기준액에만 얹힌다(highlow_continue).
  v_bonus := app.bonus_stake(v_uid);

  -- 판돈을 먼저 차감한 뒤에야 패를 뽑는다. profiles 는 로그인한 모두가 select
  -- 할 수 있는 테이블이라, 판을 걸기도 전에 hl_card 를 미리 훔쳐볼 수는 없다.
  v_wage        := least(app.play_wage(v_p.coins), p_bet / 2);
  v_coins_after := v_p.coins - p_bet + v_wage;

  update public.profiles
     set coins      = v_coins_after,
         plays_used = v_p.plays_used + 1,
         hl_card    = app.hl_draw(),
         hl_stage   = 0,
         hl_bet     = p_bet,
         hl_bonus   = v_bonus,
         hl_wage    = v_wage,
         hl_pot     = 0,
         hl_steps   = '[]'::jsonb
   where id = v_uid
  returning * into v_p;

  v_p := app.spend_hp(v_uid, app.hp_per_play());

  v_outcome := jsonb_build_object(
    'result', 'armed', 'stage', 0, 'pot', 0,
    'next', v_p.hl_card, 'steps', '[]'::jsonb);
  if v_bonus > 0 then
    v_outcome := v_outcome || jsonb_build_object('bonus_stake', v_bonus);
  end if;

  -- 판돈은 여기서 빠지고 참가 보상도 여기서 붙는다. 이 움직임을 적지 않으면 원장의
  -- coin_after 사슬이 이 지점에서 끊기고, 사다리를 열어 둔 채 돌아오지 않은
  -- 판은 어디에도 남지 않는다. 닫는 쪽(사다리/수령)은 그때의 움직임만 적는다.
  perform app.log(v_uid, 'game', '하이로우 개시',
    v_wage - p_bet, v_coins_after,
    jsonb_build_object('bet', p_bet, 'wage', v_wage, 'outcome', v_outcome));

  return app.state_json(v_p) || jsonb_build_object(
    'game', 'highlow', 'bet', p_bet, 'choice', null,
    'outcome', v_outcome, 'payout', v_wage, 'net', v_wage - p_bet);
end;
$$;

CREATE FUNCTION public.highlow_cashout() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_pot    integer;
  v_bet    integer;
  v_wage   integer := 0;
  v_steps  jsonb;
  v_coins_after integer;
  v_outcome jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select * into v_p from public.profiles where id = v_uid for update;
  if not found then raise exception 'NO_PROFILE'; end if;
  if v_p.hl_stage < 1 then raise exception 'NO_LADDER'; end if;

  v_pot := app.apply_win_double(v_uid, v_p.hl_pot);
  v_bet := v_p.hl_bet; v_steps := v_p.hl_steps;
  -- highlow_continue 와 같은 이유로, 지급이 아니라 표기용이다(begin 이 적어 둔 값).
  v_wage := v_p.hl_wage;
  v_coins_after := v_p.coins + v_pot;

  update public.profiles
     set coins = v_coins_after, hl_stage = 0, hl_pot = 0, hl_bet = 0, hl_bonus = 0, hl_wage = 0,
         hl_steps = '[]'::jsonb,
         -- 받고 멈추면 판이 끝나므로 새 카드로 리셋한다.
         hl_card = app.hl_draw()
   where id = v_uid
  returning * into v_p;

  v_outcome := jsonb_build_object('result', 'cashout', 'pot', v_pot,
                                  'steps', v_steps, 'stage', 0, 'next', v_p.hl_card);

  insert into public.game_rounds (user_id, username, game, bet, choice, outcome, payout, balance_after)
  values (v_uid, v_p.username, 'highlow', v_bet, 'cashout', v_outcome,
          v_pot + v_wage, v_coins_after);

  perform app.log(v_uid, 'game', '하이로우 수령', v_pot, v_coins_after,
    jsonb_build_object('bet', v_bet, 'outcome', v_outcome));

  return app.state_json(v_p) || jsonb_build_object(
    'game', 'highlow', 'bet', 0, 'choice', 'cashout',
    'outcome', v_outcome, 'payout', v_pot + v_wage, 'net', v_pot + v_wage - v_bet);
end;
$$;

CREATE FUNCTION public.highlow_continue(p_choice text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_next  integer;
  v_win   boolean;
  v_stage integer;
  v_pot   integer;
  v_steps jsonb;
  v_from  integer;
  v_bet   integer;
  v_mult  numeric;
  v_wage   integer := 0;
  v_payout integer := 0;
  v_coins_after integer;
  v_outcome jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  -- null 은 not in 을 빠져나간다. 그대로 두면 hl_win_cards 가 1(×8)을 주고 v_win 이
  -- null 이라 "not v_win" 도 거짓이 되어, 매 단계 무조건 적중으로 처리된다.
  if p_choice is null or p_choice not in ('high', 'low', 'same') then
    raise exception 'INVALID_CHOICE';
  end if;

  select * into v_p from public.profiles where id = v_uid for update;
  if not found then raise exception 'NO_PROFILE'; end if;
  if v_p.hl_bet <= 0 or v_p.hl_stage >= app.hl_max_stage() then raise exception 'NO_LADDER'; end if;
  if app.hl_win_cards(v_p.hl_card, p_choice) <= 0 then raise exception 'INVALID_CHOICE'; end if;

  v_from := v_p.hl_card;
  v_bet  := v_p.hl_bet;

  v_next := app.hl_draw();
  v_win  := coalesce((p_choice = 'high' and v_next > v_p.hl_card)
                  or (p_choice = 'low'  and v_next < v_p.hl_card)
                  or (p_choice = 'same' and v_next = v_p.hl_card), false);

  v_stage := v_p.hl_stage + 1;
  v_mult  := app.hl_mult(v_from, p_choice, v_stage);
  v_steps := v_p.hl_steps || jsonb_build_array(jsonb_build_object(
    'stage', v_stage, 'from', v_from, 'next', v_next, 'choice', p_choice,
    'win', v_win, 'mult', v_mult));

  if not v_win then
    v_pot := 0; v_stage := 0;
  else
    -- 0단계(첫 판정)의 기준액은 판돈(+ 보너스가 얹은 몫)이다. 그다음부터는 쌓인 적립금이 기준이다.
    v_pot := round((case when v_p.hl_stage = 0 then v_p.hl_bet + v_p.hl_bonus else v_p.hl_pot end)
                    * v_mult)::int;
    if v_stage >= app.hl_max_stage() then
      v_payout := v_pot;
      v_stage  := 0;
    end if;
  end if;

  v_payout := app.apply_win_double(v_uid, v_payout);
  -- 참가 보상은 highlow_begin() 이 이미 지급했다. 여기서 코인을 더 주는 게 아니라,
  -- 이 판의 순이익을 제대로 적으려고 같은 공식으로 다시 구하기만 한다.
  -- 참가 보상이 보유 코인에 따라 달라지므로 begin 이 적어 둔 hl_wage 를 그대로 쓴다.
  v_wage := v_p.hl_wage;
  v_coins_after := v_p.coins + v_payout;

  update public.profiles
     set coins    = v_coins_after,
         -- 사다리가 이어지면 방금 나온 카드로 계속하고,
         -- 지거나 완주해서 판이 끝나면 새 카드로 리셋한다.
         hl_card  = case when v_stage > 0 then v_next else app.hl_draw() end,
         hl_stage = v_stage,
         hl_pot   = case when v_stage > 0 then v_pot else 0 end,
         hl_bet   = case when v_stage > 0 then hl_bet else 0 end,
         hl_bonus = case when v_stage > 0 then hl_bonus else 0 end,
         hl_wage  = case when v_stage > 0 then hl_wage else 0 end,
         hl_steps = case when v_stage > 0 then v_steps else '[]'::jsonb end
   where id = v_uid
  returning * into v_p;

  v_outcome := jsonb_build_object(
    'from', v_from, 'next', v_next, 'choice', p_choice,
    'result', case when not v_win then 'lose' when v_stage = 0 then 'cleared' else 'win' end,
    'stage', v_stage, 'pot', v_pot, 'mult', v_mult, 'steps', v_steps);

  if v_stage = 0 then
    insert into public.game_rounds (user_id, username, game, bet, choice, outcome, payout, balance_after)
    values (v_uid, v_p.username, 'highlow', v_bet, p_choice, v_outcome,
            -- 참가 보상 포함. play_game 이 넣는 payout 과 같은 뜻의 값이라야
            -- 실시간 피드의 payout - bet 이 상단 배너와 어긋나지 않는다.
            v_payout + v_wage, v_coins_after);

    perform app.log(v_uid, 'game', '하이로우 사다리', v_payout, v_coins_after,
      jsonb_build_object('bet', v_bet, 'outcome', v_outcome));
  end if;

  return app.state_json(v_p) || jsonb_build_object(
    'game', 'highlow', 'bet', 0, 'choice', p_choice,
    'outcome', v_outcome,
    -- 판이 끝난 판정에만 참가 보상을 얹어 돌려준다. 사다리가 이어지는 중이면
    -- 상단 배너가 뜨지 않으므로(Casino.tsx 의 midLadder) 0 으로 둔다.
    'payout', case when v_stage = 0 then v_payout + v_wage else v_payout end,
    'net',    case when v_stage = 0 then v_payout + v_wage - v_bet else 0 end);
end;
$$;

CREATE FUNCTION public.play_game(p_game text, p_bet integer, p_choice text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $_$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_today  date := app.today_kst();

  v_payout  integer := 0;
  v_wage    integer := 0;
  v_outcome jsonb;

  v_slot  integer;
  v_color text;

  v_pool  text[] := app.slot_pool();
  v_r1 text; v_r2 text; v_r3 text;
  v_kind text;

  -- 키노: 1~40 에서 5개를 고르고 서버가 10개를 뽑는다.
  v_kn_picks int[];
  v_kn_draw  int[];
  v_kn_hits  int[];
  v_kn_n     integer;

  -- 네잎클로버 등이 얹어 주는 판돈(app.bonus_stake). 지급은 v_stake 기준, 코인은 p_bet 만 빠진다.
  v_bonus integer := 0;
  v_stake integer;

  v_coins_after integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_game is null or p_game not in ('roulette', 'slots', 'keno') then
    raise exception 'INVALID_GAME';
  end if;
  if p_bet is null or p_bet < 1 then raise exception 'INVALID_BET'; end if;

  v_p := app.accrue(v_uid);

  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;
  if v_p.hp < app.hp_per_play() then raise exception 'NO_HP'; end if;
  if v_p.plays_used >= app.daily_play_limit() + v_p.bonus_plays then
    raise exception 'DAILY_LIMIT';
  end if;
  if p_bet > v_p.coins then raise exception 'NOT_ENOUGH_COINS'; end if;

  -- 아래에서 선택이 잘못돼 예외가 나면 트랜잭션째 되돌아가 횟수도 안 깎인다.
  v_bonus := app.bonus_stake(v_uid);
  v_stake := p_bet + v_bonus;

  -- ---------------- 룰렛 ----------------
  if p_game = 'roulette' then
    if p_choice is null
       or (p_choice not in ('red', 'black', 'green')
           and p_choice !~ '^([0-9]|1[0-4])$') then
      raise exception 'INVALID_CHOICE';
    end if;

    v_slot  := floor(random() * app.roulette_slots())::int;
    v_color := case when v_slot = 0 then 'green'
                    when v_slot <= 7 then 'red' else 'black' end;

    if p_choice in ('red', 'black', 'green') then
      if v_color = p_choice then
        v_payout := floor(v_stake * case when v_color = 'green' then app.roulette_number_mult()
                                         else app.roulette_color_mult() end)::int;
      end if;
    elsif v_slot = p_choice::int then
      v_payout := floor(v_stake * app.roulette_number_mult())::int;
    end if;

    v_outcome := jsonb_build_object('slot', v_slot, 'color', v_color);

  -- ---------------- 슬롯머신 ----------------
  elsif p_game = 'slots' then
    v_r1 := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];
    v_r2 := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];
    v_r3 := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];

    if v_r1 = v_r2 and v_r2 = v_r3 then
      v_kind := 'triple';
      v_payout := v_stake * app.slot_triple_mult(v_r1);
    elsif v_r1 = v_r2 or v_r2 = v_r3 or v_r1 = v_r3 then
      v_kind := 'pair';
      v_payout := floor(v_stake * app.slot_pair_mult())::int;
    else
      v_kind := 'none';
    end if;

    v_outcome := jsonb_build_object('reels', jsonb_build_array(v_r1, v_r2, v_r3), 'kind', v_kind);

  -- ---------------- 키노 ----------------
  -- 고른 수는 "3,11,19,27,38" 꼴로 온다. 앞의 0 도 공백도 받지 않는다.
  else
    if p_choice is null
       or p_choice !~ '^([1-9]|[1-2][0-9]|3[0-9]|40)(,([1-9]|[1-2][0-9]|3[0-9]|40)){4}$' then
      raise exception 'INVALID_CHOICE';
    end if;

    v_kn_picks := string_to_array(p_choice, ',')::int[];
    -- 정규식은 개수만 잡는다. 같은 수를 다섯 번 적어 적중을 늘리는 건 여기서 막는다.
    select count(distinct x) into v_kn_n from unnest(v_kn_picks) x;
    if v_kn_n <> 5 then raise exception 'INVALID_CHOICE'; end if;

    -- 5개 적중은 자연적으로 2,611판에 한 번 나온다. 그대로 두면 최고 배당이
    -- 슬롯 다이아 트리플(9,261판에 한 번)보다 3.5배 흔해진다. 다 맞힌 판은
    -- app.keno_five_keep() 만큼만 남기고 나머지는 판 전체를 다시 뽑는다.
    -- 4개 적중(자연 104판에 한 번)도 같은 식으로 app.keno_four_keep() 만큼만
    -- 남겨 4,630판에 한 번(5개 확률의 2배)으로 낮춘다(2026-10-02).
    -- 3개 적중(자연 12.6판에 한 번)도 app.keno_three_keep() 만큼만 남겨
    -- 28.5판에 한 번으로 낮춘다 — RTP ≈ 0.98, 다른 게임과 같은 엣지(2026-10-07).
    -- 화면에 나가는 건 언제나 실제로 뽑힌 그 한 판이다 — 공을 바꿔치지 않는다.
    -- 재추첨이라 0~2개 적중은 서로의 비율이 그대로 유지된다(전부 1.0592배).
    loop
      -- 40개를 섞어 앞에서 10개. 10 <= 40 이라 pick_shuffled 가 다시 섞어 이어
      -- 붙이는(값이 겹치는) 구간에 들어가지 않는다. smallint[] 로 오므로 올린다.
      -- 뽑힌 순서를 그대로 지킨다 — 화면이 이 순서대로 하나씩 켠다.
      select array_agg(x::int order by ord) into v_kn_draw
        from unnest(app.pick_shuffled(1, 40, 10)) with ordinality as t(x, ord);

      select coalesce(array_agg(x order by x), '{}') into v_kn_hits
        from unnest(v_kn_picks) x where x = any(v_kn_draw);

      v_kn_n := coalesce(array_length(v_kn_hits, 1), 0);

      exit when v_kn_n < 3
             or (v_kn_n = 3 and random() < app.keno_three_keep())
             or (v_kn_n = 4 and random() < app.keno_four_keep())
             or (v_kn_n = 5 and random() < app.keno_five_keep());
    end loop;

    -- 위 재추첨을 거친 뒤의 적중 확률은
    --   0개 .2294 · 1개 .4411 · 2개 .2941 · 3개 .0351 · 4개 .000216 · 5개 .000108
    -- 이다(5개는 1/9,261 — 슬롯 다이아 트리플과 같은 급, 4개는 1/4,630, 3개는
    -- 1/28.5). 1개 적중(44.11%)에는 지금도 배당을 주지 않는다.
    -- 2026-09-28: 확률은 그대로 두고 배당만 올렸다(×1.5/×4/×15/×50 → ×3/×15/×30/×60).
    -- RTP 는 0.883(하우스 엣지 ≈11.7%)에서 약 2.32(하우스 엣지 ≈ −131.7%, 플레이어
    -- 유리)로 뛴다 — 다른 게임과 엣지를 맞추지 않은 의도적 결정이다.
    -- 같은 날 2개 적중만 ×3 → ×1.5 로 되돌렸다. RTP 약 1.90(하우스 엣지 ≈ −90.1%).
    -- 2026-10-02: 배당은 그대로 두고 4개 적중 빈도를 1/104 → 1/4,630 으로 낮췄다.
    -- RTP 약 1.635(하우스 엣지 ≈ −63.5%).
    -- 2026-10-06: 배당은 그대로 두고 3개 적중 빈도를 1/12.5 → 1/15 로 낮췄다.
    -- RTP 약 1.44(하우스 엣지 ≈ −44.0%).
    -- 2026-10-07: 배당은 그대로 두고 3개 적중 빈도를 1/15 → 1/28.5 로 낮췄다.
    -- RTP 약 0.980(하우스 엣지 ≈ 2.0% — 룰렛 2.00% · 슬롯 1.91% · 하이로우 2.04%).
    -- 배당표는 app.keno_mult() 하나가 정한다(화면은 get_rules() 로 같은 값을 받는다).
    v_payout := floor(v_stake * app.keno_mult(v_kn_n))::int;

    v_outcome := jsonb_build_object(
      'picks', to_jsonb((select array_agg(x order by x) from unnest(v_kn_picks) x)),
      'draw',  to_jsonb(v_kn_draw),
      'hits',  to_jsonb(v_kn_hits),
      'match', v_kn_n);
  end if;

  if v_bonus > 0 then
    v_outcome := v_outcome || jsonb_build_object('bonus_stake', v_bonus);
  end if;

  -- ---------------- 정산 ----------------
  v_payout := app.apply_win_double(v_uid, v_payout);
  -- 참가 보상은 "승리 판돈 2배" 대상이 아니다. 승패와 무관하게, 판돈의 절반까지만 붙는 값이다.
  v_wage    := least(app.play_wage(v_p.coins), p_bet / 2);
  v_payout  := v_payout + v_wage;
  v_coins_after := v_p.coins - p_bet + v_payout;

  update public.profiles
     set coins      = v_coins_after,
         plays_used = v_p.plays_used + 1,
         last_reset = v_p.last_reset
   where id = v_uid
  returning * into v_p;

  -- 에너지 소모 (0이 되면 휴식으로 간다)
  v_p := app.spend_hp(v_uid, app.hp_per_play());

  insert into public.game_rounds (user_id, username, game, bet, choice, outcome, payout, balance_after)
  values (v_uid, v_p.username, p_game, p_bet, p_choice, v_outcome, v_payout, v_coins_after);

  perform app.log(v_uid, 'game',
    case p_game when 'roulette' then '룰렛' when 'slots' then '슬롯머신' else '키노' end,
    v_payout - p_bet, v_coins_after,
    jsonb_build_object('game', p_game, 'bet', p_bet, 'choice', p_choice, 'outcome', v_outcome));

  return app.state_json(v_p) || jsonb_build_object(
    'game', p_game, 'bet', p_bet, 'choice', p_choice,
    'outcome', v_outcome, 'payout', v_payout, 'net', v_payout - p_bet);
end;
$_$;

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.apply_win_double(p_uid uuid, p_payout integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.bonus_stake(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.finish_round(p_id bigint, p_winner text, p_host jsonb, p_guest jsonb, p_reason text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.highlow_begin(p_bet integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.highlow_begin(p_bet integer) TO anon;
GRANT ALL ON FUNCTION public.highlow_begin(p_bet integer) TO authenticated;
GRANT ALL ON FUNCTION public.highlow_begin(p_bet integer) TO service_role;

REVOKE ALL ON FUNCTION public.highlow_cashout() FROM PUBLIC;
GRANT ALL ON FUNCTION public.highlow_cashout() TO anon;
GRANT ALL ON FUNCTION public.highlow_cashout() TO authenticated;
GRANT ALL ON FUNCTION public.highlow_cashout() TO service_role;

REVOKE ALL ON FUNCTION public.highlow_continue(p_choice text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.highlow_continue(p_choice text) TO anon;
GRANT ALL ON FUNCTION public.highlow_continue(p_choice text) TO authenticated;
GRANT ALL ON FUNCTION public.highlow_continue(p_choice text) TO service_role;

REVOKE ALL ON FUNCTION public.play_game(p_game text, p_bet integer, p_choice text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.play_game(p_game text, p_bet integer, p_choice text) TO anon;
GRANT ALL ON FUNCTION public.play_game(p_game text, p_bet integer, p_choice text) TO authenticated;
GRANT ALL ON FUNCTION public.play_game(p_game text, p_bet integer, p_choice text) TO service_role;
