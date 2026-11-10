-- arena — 1:1 대전(주사위 · 인디언포커 · 블랙잭)
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.matches (
    id bigint NOT NULL,
    game text NOT NULL,
    host_id uuid NOT NULL,
    host_name text NOT NULL,
    guest_id uuid NOT NULL,
    guest_name text NOT NULL,
    bet integer NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    turn text,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    winner_id uuid,
    expires_at timestamp with time zone DEFAULT (now() + '00:01:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    host_wins integer DEFAULT 0 NOT NULL,
    guest_wins integer DEFAULT 0 NOT NULL,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT matches_bet_check CHECK ((bet >= 1)),
    CONSTRAINT matches_game_check CHECK ((game = ANY (ARRAY['dice'::text, 'indian'::text, 'blackjack'::text]))),
    CONSTRAINT matches_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'done'::text, 'declined'::text, 'expired'::text]))),
    CONSTRAINT matches_turn_check CHECK ((turn = ANY (ARRAY['host'::text, 'guest'::text])))
);

ALTER TABLE public.matches ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.matches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);

CREATE INDEX matches_guest_idx ON public.matches USING btree (guest_id, created_at DESC);

CREATE INDEX matches_host_idx ON public.matches USING btree (host_id, created_at DESC);

CREATE INDEX matches_open_idx ON public.matches USING btree (status) WHERE (status = ANY (ARRAY['invited'::text, 'active'::text]));

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_host_id_fkey FOREIGN KEY (host_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.bj_advance(p_id bigint, p_role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  m             public.matches;
  hs            int;
  gs            int;
  host_natural  boolean;
  guest_natural boolean;
  host_stand    boolean;
  guest_stand   boolean;
  other         text := case when p_role = 'host' then 'guest' else 'host' end;
  other_stand   boolean;
begin
  select * into m from public.matches where id = p_id for update;
  if m.status <> 'active' then return; end if;

  if app.bj_has_pending(m.state->'host_aces') or app.bj_has_pending(m.state->'guest_aces') then
    return;
  end if;

  hs := app.bj_score(m.state->'host_hand',  m.state->'host_aces');
  gs := app.bj_score(m.state->'guest_hand', m.state->'guest_aces');

  -- 21 초과 = 즉시 그 판 패배
  if hs > 21 or gs > 21 then
    perform app.finish_round(p_id,
      case when hs > 21 then 'guest' else 'host' end,
      to_jsonb(hs), to_jsonb(gs), 'bust');
    return;
  end if;

  -- 첫 두 장의 합이 21 = 블랙잭. 그 자리에서 그 판 승리(둘 다면 무승부).
  host_natural  := jsonb_array_length(m.state->'host_hand')  = 2 and hs = 21;
  guest_natural := jsonb_array_length(m.state->'guest_hand') = 2 and gs = 21;
  if host_natural or guest_natural then
    perform app.finish_round(p_id,
      case when host_natural and guest_natural then 'tie'
           when host_natural then 'host' else 'guest' end,
      to_jsonb(hs), to_jsonb(gs), 'blackjack');
    return;
  end if;

  -- 21 을 만들었으면(히트로) 더 못 받으므로 자동 스탠드.
  host_stand  := (m.state->>'host_stand')::boolean  or hs = 21;
  guest_stand := (m.state->>'guest_stand')::boolean or gs = 21;
  if host_stand <> (m.state->>'host_stand')::boolean
     or guest_stand <> (m.state->>'guest_stand')::boolean then
    update public.matches
       set state = state || jsonb_build_object('host_stand', host_stand, 'guest_stand', guest_stand)
     where id = p_id;
  end if;

  -- 둘 다 스탠드 → 점수 비교로 그 판을 정리
  if host_stand and guest_stand then
    perform app.finish_round(p_id,
      case when hs > gs then 'host' when gs > hs then 'guest' else 'tie' end,
      to_jsonb(hs), to_jsonb(gs), null);
    return;
  end if;

  if m.turn is null then
    -- 딜 직후 첫 턴 배정: 스탠드 안 한 쪽부터, 둘 다 안 했으면 호스트부터.
    update public.matches
       set turn = case when host_stand then 'guest' else 'host' end,
           expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
           updated_at = now()
     where id = p_id;
  else
    -- 진행 중 → 스탠드 안 한 상대에게 턴을 넘긴다.
    other_stand := case when other = 'host' then host_stand else guest_stand end;
    update public.matches
       set turn = case when other_stand then p_role else other end,
           expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
           updated_at = now()
     where id = p_id;
  end if;
end;
$$;

CREATE FUNCTION app.bj_card() RETURNS integer
    LANGUAGE sql
    AS $$ select 1 + floor(random() * 13)::int $$;

CREATE FUNCTION app.bj_deal(p_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  hh jsonb;
  gh jsonb;
begin
  hh := jsonb_build_array(app.bj_card(), app.bj_card());
  gh := jsonb_build_array(app.bj_card(), app.bj_card());

  update public.matches
     set turn = null,
         state = jsonb_build_object(
                   'host_hand',  hh,
                   'guest_hand', gh,
                   'host_aces',  app.bj_init_aces(hh),
                   'guest_aces', app.bj_init_aces(gh),
                   'host_stand', false, 'guest_stand', false),
         expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
         updated_at = now()
   where id = p_id;

  -- 에이스가 없으면 곧장 진행되고, 있으면 결정이 날 때까지 여기서 멈춘다.
  perform app.bj_advance(p_id, 'host');
end;
$$;

CREATE FUNCTION app.bj_has_pending(p_aces jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_aces, '[]'::jsonb)) v
     where v = 'null'::jsonb
  );
$$;

CREATE FUNCTION app.bj_init_aces(p_hand jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(jsonb_agg('null'::jsonb order by ord), '[]'::jsonb)
    from jsonb_array_elements_text(coalesce(p_hand, '[]'::jsonb)) with ordinality as t(c, ord)
   where c::int = 1;
$$;

CREATE FUNCTION app.bj_resolve_pending(p_aces jsonb, p_default integer) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(jsonb_agg(
           case when v = 'null'::jsonb then to_jsonb(p_default) else v end
           order by ord),
         '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_aces, '[]'::jsonb)) with ordinality as t(v, ord);
$$;

CREATE FUNCTION app.bj_score(p_hand jsonb, p_aces jsonb DEFAULT '[]'::jsonb) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  c      int;
  v      int;
  total  int := 0;
  ace_i  int := 0;
  aces   jsonb := coalesce(p_aces, '[]'::jsonb);
  elem   jsonb;
begin
  for c in select (e)::int from jsonb_array_elements_text(coalesce(p_hand, '[]'::jsonb)) e loop
    if c = 1 then
      elem := aces -> ace_i;
      v := case when elem is null or elem = 'null'::jsonb
                then 0
                else (elem #>> '{}')::int end;
      ace_i := ace_i + 1;
    elsif c >= 11 then v := 10;
    else v := c;
    end if;
    total := total + v;
  end loop;
  return total;
end;
$$;

CREATE FUNCTION app.dice_total(j jsonb) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    select ((j->>0)::int + (j->>1)::int);
  $$;

CREATE FUNCTION app.expire_matches(p_uid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  m       public.matches;
  v_loser text;
begin
  for m in
    select * from public.matches
     where (host_id = p_uid or guest_id = p_uid)
       and status in ('invited', 'active')
       and expires_at < now()
     for update
  loop
    if m.status = 'invited' then
      update public.matches
         set status = 'expired', updated_at = now()
       where id = m.id;
      continue;
    end if;

    -- 블랙잭은 기권이 아니라 자동 처리. 안 고른 에이스는 1(안전한 값)로,
    -- 지금 턴인 사람은 스탠드로 세워 두고 진행한다.
    if m.game = 'blackjack' then
      if app.bj_has_pending(m.state->'host_aces') then
        update public.matches
           set state = jsonb_set(state, '{host_aces}', app.bj_resolve_pending(state->'host_aces', 1))
         where id = m.id;
      end if;
      if app.bj_has_pending(m.state->'guest_aces') then
        update public.matches
           set state = jsonb_set(state, '{guest_aces}', app.bj_resolve_pending(state->'guest_aces', 1))
         where id = m.id;
      end if;
      if m.turn is not null then
        update public.matches
           set state = jsonb_set(state, array[m.turn || '_stand'], 'true'::jsonb),
               updated_at = now()
         where id = m.id;
      end if;
      perform app.bj_advance(m.id, coalesce(m.turn, 'host'));
      continue;
    end if;

    if m.game = 'dice' then
      -- 안 굴린 쪽이 포기한 것으로 본다. 둘 다 안 굴렸으면 그냥 무승부 처리.
      if (m.state ? 'host_roll') and not (m.state ? 'guest_roll') then
        v_loser := 'guest';
      elsif (m.state ? 'guest_roll') and not (m.state ? 'host_roll') then
        v_loser := 'host';
      else
        v_loser := null;
      end if;
    else
      v_loser := m.turn;
    end if;

    if v_loser is null then
      perform app.settle_match(m.id, 'tie',
        jsonb_build_object('reason', 'timeout', 'history', m.history,
                           'host_wins', m.host_wins, 'guest_wins', m.guest_wins));
    else
      perform app.settle_match(
        m.id,
        case when v_loser = 'host' then 'guest' else 'host' end,
        jsonb_build_object('reason', 'timeout', 'forfeited', v_loser,
                           'history', m.history,
                           'host_wins', m.host_wins, 'guest_wins', m.guest_wins));
    end if;
  end loop;
end;
$$;

CREATE FUNCTION app.finish_dice_round(p_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  m  public.matches;
  vh jsonb;
  vg jsonb;
begin
  select * into m from public.matches where id = p_id for update;
  if m.status <> 'active' then return; end if;

  vh := coalesce(m.state->'host_roll',  app.roll2());
  vg := coalesce(m.state->'guest_roll', app.roll2());

  perform app.finish_round(
    p_id,
    case when app.dice_total(vh) > app.dice_total(vg) then 'host'
         when app.dice_total(vg) > app.dice_total(vh) then 'guest'
         else 'tie' end,
    vh, vg, null);
end;
$$;

CREATE FUNCTION app.pair_matches_today(p_a uuid, p_b uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select count(*)::int
    from public.matches m
   where m.status in ('active', 'done')
     and ((m.host_id = p_a and m.guest_id = p_b)
       or (m.host_id = p_b and m.guest_id = p_a))
     and (timezone('Asia/Seoul', m.created_at))::date = app.today_kst();
$$;

CREATE FUNCTION app.pvp_game_name(p_game text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select case p_game when 'dice' then '배틀주사위'
                       when 'indian' then '인디언포커'
                       when 'blackjack' then '블랙잭'
                       else p_game end;
  $$;

CREATE FUNCTION app.pvp_min_bet() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 50 $$;

CREATE FUNCTION app.pvp_pair_daily_limit() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 3 $$;

CREATE FUNCTION app.pvp_turn_seconds() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 45 $$;

CREATE FUNCTION app.pvp_wins_needed() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 2 $$;

CREATE FUNCTION app.settle_match(p_id bigint, p_winner text, p_result jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  m              public.matches;
  v_pot          integer;
  v_host_payout  integer := 0;
  v_guest_payout integer := 0;
  v_host_coins   integer;
  v_guest_coins  integer;
  v_winner_id    uuid;
begin
  select * into m from public.matches where id = p_id for update;
  v_pot := m.bet * 2;

  if p_winner = 'host' then
    v_host_payout := app.apply_win_double(m.host_id, v_pot);
    v_winner_id   := m.host_id;
  elsif p_winner = 'guest' then
    v_guest_payout := app.apply_win_double(m.guest_id, v_pot);
    v_winner_id    := m.guest_id;
  else
    v_host_payout  := m.bet;
    v_guest_payout := m.bet;
  end if;

  update public.profiles set coins = coins + v_host_payout
   where id = m.host_id returning coins into v_host_coins;
  update public.profiles set coins = coins + v_guest_payout
   where id = m.guest_id returning coins into v_guest_coins;

  update public.matches
     set status = 'done', winner_id = v_winner_id, result = p_result,
         turn = null, updated_at = now()
   where id = p_id;

  insert into public.game_rounds
    (user_id, username, game, bet, choice, outcome, payout, balance_after)
  values
    (m.host_id, m.host_name, m.game, m.bet, 'host',
     p_result || jsonb_build_object('side', 'host', 'vs', m.guest_name),
     v_host_payout, v_host_coins),
    (m.guest_id, m.guest_name, m.game, m.bet, 'guest',
     p_result || jsonb_build_object('side', 'guest', 'vs', m.host_name),
     v_guest_payout, v_guest_coins);

  perform app.log(m.host_id, 'game',
    format('%s · %s 와의 대전', app.pvp_game_name(m.game), m.guest_name),
    v_host_payout - m.bet, v_host_coins, p_result);
  perform app.log(m.guest_id, 'game',
    format('%s · %s 와의 대전', app.pvp_game_name(m.game), m.host_name),
    v_guest_payout - m.bet, v_guest_coins, p_result);
end;
$$;

CREATE FUNCTION app.start_match(p_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  m   public.matches;
  v_h public.profiles;
  v_g public.profiles;
begin
  select * into m from public.matches where id = p_id for update;

  v_h := app.accrue(m.host_id);
  v_g := app.accrue(m.guest_id);

  if v_h.coins < m.bet or v_g.coins < m.bet then
    raise exception 'NOT_ENOUGH_COINS';
  end if;
  if v_h.hp < app.hp_per_play() or v_g.hp < app.hp_per_play() then
    raise exception 'NO_HP';
  end if;
  if v_h.ward_until is not null or v_g.ward_until is not null then
    raise exception 'IN_WARD';
  end if;
  if app.pair_matches_today(m.host_id, m.guest_id) >= app.pvp_pair_daily_limit() then
    raise exception 'PAIR_LIMIT';
  end if;

  -- 플레이 횟수(plays_used)는 건드리지 않는다. Arena 는 Casual 과 몫을
  -- 나눠 쓰지 않는다 — 여기서 드는 값은 판돈과 에너지뿐이다.
  update public.profiles
     set coins = coins - m.bet
   where id in (m.host_id, m.guest_id);

  perform app.spend_hp(m.host_id,  app.hp_per_play());
  perform app.spend_hp(m.guest_id, app.hp_per_play());

  -- 두 사람이 걸려 있는 다른 초대는 모두 정리한다.
  update public.matches
     set status = 'declined', updated_at = now()
   where id <> m.id
     and status = 'invited'
     and (host_id  in (m.host_id, m.guest_id)
       or guest_id in (m.host_id, m.guest_id));

  if m.game = 'dice' then
    -- 여기서 굴리지 않는다. 각자 버튼을 눌러야 그 순간에 굴러간다.
    update public.matches
       set status = 'active', state = '{}'::jsonb, turn = null,
           expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
           updated_at = now()
     where id = m.id;
  elsif m.game = 'blackjack' then
    update public.matches
       set status = 'active', updated_at = now()
     where id = m.id;
    perform app.bj_deal(m.id);
  else
    update public.matches
       set status = 'active',
           turn   = 'host',
           state  = jsonb_build_object(
                      'host_card',  1 + floor(random() * 13)::int,
                      'guest_card', 1 + floor(random() * 13)::int),
           expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
           updated_at = now()
     where id = m.id;
  end if;
end;
$$;

CREATE FUNCTION public.pvp_act(p_match_id bigint, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid  uuid := auth.uid();
  m      public.matches;
  v_role text;
  v_h    int; v_g int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  v_role := case when m.host_id = v_uid then 'host'
                 when m.guest_id = v_uid then 'guest' else null end;
  if v_role is null then raise exception 'NOT_A_PLAYER'; end if;
  if m.turn is distinct from v_role then raise exception 'NOT_YOUR_TURN'; end if;

  -- ── 인디언포커 ──
  if m.game = 'indian' then
    if p_action not in ('call', 'fold') then raise exception 'INVALID_ACTION'; end if;

    v_h := (m.state->>'host_card')::int;
    v_g := (m.state->>'guest_card')::int;

    if p_action = 'fold' then
      perform app.finish_round(
        m.id,
        case when v_role = 'host' then 'guest' else 'host' end,
        to_jsonb(v_h), to_jsonb(v_g), 'fold');
    elsif v_role = 'host' then
      update public.matches
         set turn = 'guest',
             expires_at = now() + make_interval(secs => app.pvp_turn_seconds()),
             updated_at = now()
       where id = m.id;
    else
      perform app.finish_round(
        m.id,
        case when v_h > v_g then 'host' when v_g > v_h then 'guest' else 'tie' end,
        to_jsonb(v_h), to_jsonb(v_g), 'showdown');
    end if;

  -- ── 블랙잭 ──
  elsif m.game = 'blackjack' then
    if p_action not in ('hit', 'stand') then raise exception 'INVALID_ACTION'; end if;
    if app.bj_has_pending(m.state->(v_role || '_aces')) then
      raise exception 'ACE_PENDING';
    end if;

    if p_action = 'hit' then
      declare
        v_card int := app.bj_card();
      begin
        -- 카드 한 장을 내 손패에 더한다. 에이스면 값을 고를 자리도 하나 늘린다.
        update public.matches
           set state = m.state
                        || jsonb_build_object(v_role || '_hand',
                             (m.state->(v_role || '_hand')) || to_jsonb(v_card))
                        || jsonb_build_object(v_role || '_aces',
                             case when v_card = 1
                                  then coalesce(m.state->(v_role || '_aces'), '[]'::jsonb) || 'null'::jsonb
                                  else coalesce(m.state->(v_role || '_aces'), '[]'::jsonb) end),
               updated_at = now()
         where id = m.id;
      end;
    else
      update public.matches
         set state = jsonb_set(m.state, array[v_role || '_stand'], 'true'::jsonb),
             updated_at = now()
       where id = m.id;
    end if;

    perform app.bj_advance(m.id, v_role);

  else
    raise exception 'NOT_ACTIVE';
  end if;

  return public.pvp_state();
end;
$$;

CREATE FUNCTION public.pvp_bj_ace(p_match_id bigint, p_value integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid  uuid := auth.uid();
  m      public.matches;
  v_role text;
  v_key  text;
  v_idx  int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_value not in (1, 11) then raise exception 'INVALID_CHOICE'; end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.status <> 'active' or m.game <> 'blackjack' then raise exception 'NOT_ACTIVE'; end if;

  v_role := case when m.host_id = v_uid then 'host'
                 when m.guest_id = v_uid then 'guest' else null end;
  if v_role is null then raise exception 'NOT_A_PLAYER'; end if;

  v_key := v_role || '_aces';

  -- 아직 안 고른 자리 중 가장 먼저 나온 것을 고른다(에이스가 여러 장이면 하나씩).
  select min(ord) - 1 into v_idx
    from jsonb_array_elements(coalesce(m.state->v_key, '[]'::jsonb)) with ordinality as t(v, ord)
   where v = 'null'::jsonb;
  if v_idx is null then raise exception 'NO_PENDING_ACE'; end if;

  update public.matches
     set state = jsonb_set(m.state, array[v_key, v_idx::text], to_jsonb(p_value)),
         updated_at = now()
   where id = m.id;

  perform app.bj_advance(m.id, v_role);

  return public.pvp_state();
end;
$$;

CREATE FUNCTION public.pvp_cancel(p_match_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  m     public.matches;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.host_id <> v_uid then raise exception 'NOT_YOUR_INVITE'; end if;
  if m.status <> 'invited' then raise exception 'INVITE_CLOSED'; end if;

  update public.matches set status = 'declined', updated_at = now() where id = m.id;
  return public.pvp_state();
end;
$$;

CREATE FUNCTION public.pvp_invite(p_game text, p_opponent text, p_bet integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_me     public.profiles;
  v_op     public.profiles;
  v_mutual public.matches;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_game not in ('dice', 'indian', 'blackjack') then raise exception 'INVALID_GAME'; end if;
  if p_bet is null or p_bet < app.pvp_min_bet() then raise exception 'BET_TOO_LOW'; end if;

  select * into v_op from public.profiles where username = btrim(p_opponent);
  if not found then raise exception 'NO_SUCH_PLAYER'; end if;
  if v_op.hidden then raise exception 'NO_SUCH_PLAYER'; end if;
  if v_op.id = v_uid then raise exception 'CANNOT_INVITE_SELF'; end if;
  if app.is_suspended(v_op.id) then raise exception 'OPPONENT_SUSPENDED'; end if;

  -- 두 사람의 프로필 행을 항상 같은 순서로 잠근다.
  -- 서로 동시에 신청해도 한쪽씩 차례로 처리되어 양쪽 모두 대기에 갇히지 않는다.
  perform 1 from public.profiles where id in (v_uid, v_op.id) order by id for update;

  perform app.expire_matches(v_uid);
  perform app.expire_matches(v_op.id);

  v_me := app.accrue(v_uid);
  v_op := app.accrue(v_op.id);

  if v_me.ward_until is not null then raise exception 'IN_WARD'; end if;
  if v_me.coins < p_bet then raise exception 'NOT_ENOUGH_COINS'; end if;
  if v_me.hp < app.hp_per_play() then raise exception 'NO_HP'; end if;

  if v_op.ward_until is not null then raise exception 'OPPONENT_IN_WARD'; end if;
  if v_op.hp < app.hp_per_play() then raise exception 'OPPONENT_NO_HP'; end if;

  if app.pair_matches_today(v_uid, v_op.id) >= app.pvp_pair_daily_limit() then
    raise exception 'PAIR_LIMIT';
  end if;

  -- 상대가 이미 나에게 같은 게임을 신청해 뒀다면 = 서로 지목한 것이므로 바로 시작한다.
  -- 판돈은 둘 중 적은 쪽으로 맞춘다.
  select * into v_mutual
    from public.matches
   where status = 'invited' and host_id = v_op.id and guest_id = v_uid
     and game = p_game and expires_at > now()
   order by created_at
   limit 1;

  if found then
    update public.matches
       set bet = greatest(app.pvp_min_bet(), least(v_mutual.bet, p_bet)),
           updated_at = now()
     where id = v_mutual.id;

    perform app.start_match(v_mutual.id);
    return public.pvp_state();
  end if;

  if v_op.coins < p_bet then raise exception 'OPPONENT_POOR'; end if;

  if exists (select 1 from public.matches
              where status in ('invited', 'active')
                and (host_id = v_uid or guest_id = v_uid)) then
    raise exception 'ALREADY_IN_MATCH';
  end if;
  if exists (select 1 from public.matches
              where status in ('invited', 'active')
                and (host_id = v_op.id or guest_id = v_op.id)) then
    raise exception 'OPPONENT_BUSY';
  end if;

  insert into public.matches (game, host_id, host_name, guest_id, guest_name, bet, expires_at)
  values (p_game, v_uid, v_me.username, v_op.id, v_op.username, p_bet,
          now() + interval '60 seconds');

  return public.pvp_state();
end;
$$;

CREATE FUNCTION public.pvp_respond(p_match_id bigint, p_accept boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  m     public.matches;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.guest_id <> v_uid then raise exception 'NOT_YOUR_INVITE'; end if;
  if m.status <> 'invited' then raise exception 'INVITE_CLOSED'; end if;
  if m.expires_at < now() then
    update public.matches set status = 'expired', updated_at = now() where id = m.id;
    raise exception 'INVITE_EXPIRED';
  end if;

  if not p_accept then
    update public.matches set status = 'declined', updated_at = now() where id = m.id;
    return public.pvp_state();
  end if;

  perform app.start_match(m.id);
  return public.pvp_state();
end;
$$;

CREATE FUNCTION public.pvp_roll(p_match_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid  uuid := auth.uid();
  m      public.matches;
  v_role text;
  v_key  text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.status <> 'active' or m.game <> 'dice' then raise exception 'NOT_ACTIVE'; end if;

  v_role := case when m.host_id = v_uid then 'host'
                 when m.guest_id = v_uid then 'guest' else null end;
  if v_role is null then raise exception 'NOT_A_PLAYER'; end if;

  v_key := v_role || '_roll';
  if m.state ? v_key then raise exception 'ALREADY_ROLLED'; end if;

  update public.matches
     set state = m.state || jsonb_build_object(v_key, app.roll2()),
         updated_at = now()
   where id = m.id
  returning * into m;

  if (m.state ? 'host_roll') and (m.state ? 'guest_roll') then
    perform app.finish_dice_round(m.id);
  end if;

  return public.pvp_state();
end;
$$;

CREATE FUNCTION public.pvp_state() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_p       public.profiles;
  m         public.matches;
  v_role    text;
  v_match   jsonb := null;
  v_invites jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  perform app.expire_matches(v_uid);
  v_p := app.accrue(v_uid);

  select * into m
    from public.matches
   where (host_id = v_uid or guest_id = v_uid)
     and (status in ('invited', 'active')
          or (status = 'done' and updated_at > now() - interval '2 minutes'))
   order by case status when 'active' then 0 when 'invited' then 1 else 2 end,
            created_at desc
   limit 1;

  if found then
    v_role := case when m.host_id = v_uid then 'host' else 'guest' end;

    v_match := jsonb_build_object(
      'id',        m.id,
      'game',      m.game,
      'status',    m.status,
      'bet',       m.bet,
      'role',      v_role,
      'me',        case when v_role = 'host' then m.host_name else m.guest_name end,
      'opponent',  case when v_role = 'host' then m.guest_name else m.host_name end,
      'turn',      m.turn,
      'my_turn',   coalesce(m.turn = v_role, false),
      'expires_in', greatest(0, extract(epoch from (m.expires_at - now()))::int),
      'result',    m.result,
      'wins_needed', app.pvp_wins_needed(),
      'my_wins',    case when v_role = 'host' then m.host_wins else m.guest_wins end,
      'their_wins', case when v_role = 'host' then m.guest_wins else m.host_wins end,
      'round',      jsonb_array_length(m.history) + 1,
      -- 끝난 판은 이미 공개된 정보이므로 그대로 보여준다
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'round',  h->'round',
                 'mine',   case when v_role = 'host' then h->'host'  else h->'guest' end,
                 'theirs', case when v_role = 'host' then h->'guest' else h->'host'  end,
                 'won',    case when h->>'winner' is null then null
                                else (h->>'winner' = v_role) end
               ) order by (h->>'round')::int)
          from jsonb_array_elements(m.history) h), '[]'::jsonb),
      'won',       case when m.status <> 'done' then null
                        when m.winner_id is null then null
                        else (m.winner_id = v_uid) end,
      'tie',       (m.status = 'done' and m.winner_id is null),
      -- 배틀주사위: 내 주사위는 굴린 순간부터, 상대 것은 그 판이 끝나야 보인다
      'my_roll',
        case when m.game = 'dice'
             then (case when v_role = 'host' then m.state->'host_roll'
                                             else m.state->'guest_roll' end)
             else null end,
      'opponent_rolled',
        case when m.game = 'dice'
             then ((case when v_role = 'host' then m.state->'guest_roll'
                                              else m.state->'host_roll' end) is not null)
             else null end,
      -- 인디언포커: 상대 카드는 처음부터, 내 카드는 그 판이 끝나야 보인다
      'opponent_card',
        case when m.game = 'indian'
             then (case when v_role = 'host' then m.state->'guest_card'
                                             else m.state->'host_card' end)
             else null end,
      'my_card', null,
      -- 블랙잭: 숨기는 정보가 없다. 양쪽 손패·점수·스탠드 여부를 모두 보여준다.
      'my_hand',
        case when m.game = 'blackjack'
             then coalesce(case when v_role = 'host' then m.state->'host_hand'
                                                     else m.state->'guest_hand' end,
                           '[]'::jsonb)
             else null end,
      'their_hand',
        case when m.game = 'blackjack'
             then coalesce(case when v_role = 'host' then m.state->'guest_hand'
                                                     else m.state->'host_hand' end,
                           '[]'::jsonb)
             else null end,
      'my_score',
        case when m.game = 'blackjack'
             then app.bj_score(case when v_role = 'host' then m.state->'host_hand'
                                                         else m.state->'guest_hand' end,
                               case when v_role = 'host' then m.state->'host_aces'
                                                         else m.state->'guest_aces' end)
             else null end,
      'their_score',
        case when m.game = 'blackjack'
             then app.bj_score(case when v_role = 'host' then m.state->'guest_hand'
                                                         else m.state->'host_hand' end,
                               case when v_role = 'host' then m.state->'guest_aces'
                                                         else m.state->'host_aces' end)
             else null end,
      'my_stand',
        case when m.game = 'blackjack'
             then coalesce((m.state->>(v_role || '_stand'))::boolean, false)
             else null end,
      'their_stand',
        case when m.game = 'blackjack'
             then coalesce((m.state->>((case when v_role = 'host' then 'guest' else 'host' end) || '_stand'))::boolean, false)
             else null end,
      -- 아직 값을 안 고른 에이스가 있으면 팝업으로 골라야 한다.
      'my_pending_ace',
        case when m.game = 'blackjack'
             then app.bj_has_pending(case when v_role = 'host' then m.state->'host_aces'
                                                                else m.state->'guest_aces' end)
             else null end,
      'their_pending_ace',
        case when m.game = 'blackjack'
             then app.bj_has_pending(case when v_role = 'host' then m.state->'guest_aces'
                                                                else m.state->'host_aces' end)
             else null end
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'game', i.game, 'bet', i.bet, 'from', i.host_name,
           'expires_in', greatest(0, extract(epoch from (i.expires_at - now()))::int)
         ) order by i.created_at), '[]'::jsonb)
    into v_invites
    from public.matches i
   where i.guest_id = v_uid and i.status = 'invited' and i.expires_at > now();

  return jsonb_build_object(
    'match',   v_match,
    'invites', v_invites,
    'player',  app.state_json(v_p)
  );
end;
$$;

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.bj_advance(p_id bigint, p_role text) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.bj_deal(p_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.expire_matches(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.finish_dice_round(p_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.pair_matches_today(p_a uuid, p_b uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.settle_match(p_id bigint, p_winner text, p_result jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.start_match(p_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.pvp_act(p_match_id bigint, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pvp_act(p_match_id bigint, p_action text) TO anon;
GRANT ALL ON FUNCTION public.pvp_act(p_match_id bigint, p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.pvp_act(p_match_id bigint, p_action text) TO service_role;

REVOKE ALL ON FUNCTION public.pvp_bj_ace(p_match_id bigint, p_value integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pvp_bj_ace(p_match_id bigint, p_value integer) TO anon;
GRANT ALL ON FUNCTION public.pvp_bj_ace(p_match_id bigint, p_value integer) TO authenticated;
GRANT ALL ON FUNCTION public.pvp_bj_ace(p_match_id bigint, p_value integer) TO service_role;

REVOKE ALL ON FUNCTION public.pvp_cancel(p_match_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pvp_cancel(p_match_id bigint) TO anon;
GRANT ALL ON FUNCTION public.pvp_cancel(p_match_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.pvp_cancel(p_match_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.pvp_invite(p_game text, p_opponent text, p_bet integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pvp_invite(p_game text, p_opponent text, p_bet integer) TO anon;
GRANT ALL ON FUNCTION public.pvp_invite(p_game text, p_opponent text, p_bet integer) TO authenticated;
GRANT ALL ON FUNCTION public.pvp_invite(p_game text, p_opponent text, p_bet integer) TO service_role;

REVOKE ALL ON FUNCTION public.pvp_respond(p_match_id bigint, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pvp_respond(p_match_id bigint, p_accept boolean) TO anon;
GRANT ALL ON FUNCTION public.pvp_respond(p_match_id bigint, p_accept boolean) TO authenticated;
GRANT ALL ON FUNCTION public.pvp_respond(p_match_id bigint, p_accept boolean) TO service_role;

REVOKE ALL ON FUNCTION public.pvp_roll(p_match_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pvp_roll(p_match_id bigint) TO anon;
GRANT ALL ON FUNCTION public.pvp_roll(p_match_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.pvp_roll(p_match_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.pvp_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.pvp_state() TO anon;
GRANT ALL ON FUNCTION public.pvp_state() TO authenticated;
GRANT ALL ON FUNCTION public.pvp_state() TO service_role;

GRANT ALL ON TABLE public.matches TO anon;
GRANT ALL ON TABLE public.matches TO authenticated;
GRANT ALL ON TABLE public.matches TO service_role;

GRANT ALL ON SEQUENCE public.matches_id_seq TO anon;
GRANT ALL ON SEQUENCE public.matches_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.matches_id_seq TO service_role;
