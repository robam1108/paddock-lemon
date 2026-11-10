-- trade — 개인 거래 · 원장 조회
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.trades (
    id bigint NOT NULL,
    from_id uuid,
    from_name text NOT NULL,
    to_id uuid,
    to_name text NOT NULL,
    is_gift boolean DEFAULT false NOT NULL,
    from_coins integer DEFAULT 0 NOT NULL,
    from_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    to_coins integer DEFAULT 0 NOT NULL,
    to_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'offered'::text NOT NULL,
    note text,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reverted_at timestamp with time zone,
    reverted_detail jsonb,
    CONSTRAINT trade_not_self CHECK ((from_id <> to_id)),
    CONSTRAINT trades_from_coins_check CHECK ((from_coins >= 0)),
    CONSTRAINT trades_status_check CHECK ((status = ANY (ARRAY['offered'::text, 'countered'::text, 'done'::text, 'declined'::text, 'cancelled'::text, 'expired'::text, 'reverted'::text]))),
    CONSTRAINT trades_to_coins_check CHECK ((to_coins >= 0))
);

ALTER TABLE public.trades ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);

CREATE INDEX trades_from_idx ON public.trades USING btree (from_id, created_at DESC);

CREATE UNIQUE INDEX trades_one_open_pair ON public.trades USING btree (LEAST(from_id, to_id), GREATEST(from_id, to_id)) WHERE ((status = ANY (ARRAY['offered'::text, 'countered'::text])) AND (from_name <> 'admin'::text));

CREATE INDEX trades_to_idx ON public.trades USING btree (to_id, created_at DESC);

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_from_id_fkey FOREIGN KEY (from_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_to_id_fkey FOREIGN KEY (to_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.confiscate_trade_side(p_uid uuid, p_coins integer, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  e       jsonb;
  v_code  text;
  v_have  integer;
  v_take  integer;
  v_left  integer;
  v_coins integer;
  v_items jsonb := '[]'::jsonb;
begin
  -- 프로필 잠금은 부르는 쪽(panel_revert_trade)이 이미 잡아 두었다.
  select coins into v_have from public.profiles where id = p_uid;
  v_coins := least(coalesce(p_coins, 0), greatest(coalesce(v_have, 0), 0));
  if v_coins > 0 then
    update public.profiles set coins = coins - v_coins where id = p_uid;
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_code := e->>'code';

    select qty into v_have from public.inventories
     where user_id = p_uid and item_code = v_code for update;
    v_take := least((e->>'qty')::int, coalesce(v_have, 0));
    continue when v_take <= 0;

    v_left := v_have - v_take;
    update public.inventories
       set qty        = v_left,
           gifted_qty = greatest(0, least(gifted_qty, v_left))
     where user_id = p_uid and item_code = v_code;

    -- 겹쳐 장착한 수가 남는 수량보다 많으면 남는 만큼으로 줄인다.
    update public.player_flex set stack = v_left
     where user_id = p_uid and item_code = v_code and expires_at is null
       and v_left > 0 and stack > v_left;

    -- 장착분(잠금)까지 거둬 남는 게 없으면 장착을 푼다(flex_unequip 과 같은 규칙).
    if v_left <= 0 then
      delete from public.player_flex
       where user_id = p_uid and item_code = v_code and expires_at is null;

      -- 개봉한 물건의 남은 횟수(open_left)는 살려 둔다(panel_take_item 과 같다).
      delete from public.inventories
       where user_id = p_uid and item_code = v_code and open_left = 0;
    end if;

    v_items := v_items || jsonb_build_object('code', v_code, 'qty', v_take);
  end loop;

  return jsonb_build_object('coins', coalesce(v_coins, 0), 'items', v_items);
end;
$$;

CREATE FUNCTION app.exec_trade(p_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  t        public.trades;
  v_a      public.profiles;
  v_b      public.profiles;
  v_a_after integer;
  v_b_after integer;
begin
  select * into t from public.trades where id = p_id for update;

  -- 두 사람의 잔액을 항상 같은 순서로 잠근다
  perform 1 from public.profiles
   where id in (t.from_id, t.to_id) order by id for update;

  select * into v_a from public.profiles where id = t.from_id;
  select * into v_b from public.profiles where id = t.to_id;

  if v_a.coins < t.from_coins then raise exception 'PARTNER_SHORT_COINS'; end if;
  if v_b.coins < t.to_coins   then raise exception 'NOT_ENOUGH_COINS';    end if;
  if not app.can_give(t.from_id, t.from_items) then raise exception 'PARTNER_SHORT_ITEMS'; end if;
  if not app.can_give(t.to_id,   t.to_items)   then raise exception 'NOT_ENOUGH_ITEMS';    end if;

  v_a_after := v_a.coins - t.from_coins + t.to_coins;
  v_b_after := v_b.coins - t.to_coins   + t.from_coins;

  update public.profiles set coins = v_a_after where id = t.from_id;
  update public.profiles set coins = v_b_after where id = t.to_id;

  -- 선물(is_gift)은 되보내기가 없어 to_items 가 항상 비므로, 이 플래그 자체가
  -- "대가 없이 받았다"는 뜻이다 — 받는 쪽 gifted_qty 가 여기서만 올라간다.
  perform app.move_items(t.from_id, t.to_id, t.from_items, t.is_gift);
  perform app.move_items(t.to_id, t.from_id, t.to_items, false);

  update public.trades set status = 'done', updated_at = now() where id = p_id;

  perform app.log(t.from_id, 'trade',
    case when t.is_gift then format('%s 에게 선물', t.to_name)
         else format('%s 와 거래', t.to_name) end,
    t.to_coins - t.from_coins, v_a_after,
    jsonb_build_object('trade_id', t.id,
                       'partner', t.to_name, 'gave_coins', t.from_coins,
                       'gave_items', app.describe_items(t.from_items),
                       'got_coins', t.to_coins,
                       'got_items', app.describe_items(t.to_items)));

  perform app.log(t.to_id, 'trade',
    case when t.is_gift then format('%s 의 선물', t.from_name)
         else format('%s 와 거래', t.from_name) end,
    t.from_coins - t.to_coins, v_b_after,
    jsonb_build_object('trade_id', t.id,
                       'partner', t.from_name, 'gave_coins', t.to_coins,
                       'gave_items', app.describe_items(t.to_items),
                       'got_coins', t.from_coins,
                       'got_items', app.describe_items(t.from_items)));
end;
$$;

CREATE FUNCTION app.expire_trades(p_uid uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.trades
     set status = 'expired', updated_at = now()
   where status in ('offered', 'countered')
     and expires_at < now()
     and (from_id = p_uid or to_id = p_uid);
$$;

CREATE FUNCTION app.ledger_trade_id(p_uid uuid, p_created timestamp with time zone, p_detail jsonb) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select coalesce(
    (p_detail->>'trade_id')::bigint,
    (select t.id from public.trades t
      where t.status = 'done'
        and t.updated_at = p_created
        and (t.from_id = p_uid or t.to_id = p_uid)
      limit 1));
$$;

CREATE FUNCTION app.trades_party_gone() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if (new.from_id is null or new.to_id is null)
     and new.status in ('offered', 'countered') then
    new.status     := 'cancelled';
    new.updated_at := now();
  end if;
  return new;
end;
$$;

CREATE FUNCTION public.my_ledger(p_limit integer DEFAULT 10) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'kind', kind, 'title', title,
           'coin_delta', coin_delta, 'coin_after', coin_after,
           'detail', detail, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
    into v_out
    from (
      select * from public.ledger
       where user_id = v_uid
       order by created_at desc
       limit least(greatest(coalesce(p_limit, 10), 1), 50)
    ) s;

  return v_out;
end;
$$;

CREATE FUNCTION public.trade_cancel(p_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  t     public.trades;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into t from public.trades where id = p_id for update;
  if not found then raise exception 'NO_TRADE'; end if;
  if t.from_id <> v_uid and t.to_id <> v_uid then raise exception 'NOT_YOUR_TRADE'; end if;
  if t.status not in ('offered', 'countered') then raise exception 'TRADE_CLOSED'; end if;

  update public.trades set status = 'cancelled', updated_at = now() where id = t.id;
  return public.trade_inbox();
end;
$$;

CREATE FUNCTION public.trade_finalize(p_id bigint, p_accept boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  t     public.trades;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select * into t from public.trades where id = p_id for update;
  if not found then raise exception 'NO_TRADE'; end if;
  if t.from_id <> v_uid then raise exception 'NOT_YOUR_TRADE'; end if;
  if t.status <> 'countered' then raise exception 'TRADE_CLOSED'; end if;
  if t.expires_at < now() then
    update public.trades set status = 'expired', updated_at = now() where id = t.id;
    raise exception 'TRADE_EXPIRED';
  end if;

  if not p_accept then
    update public.trades set status = 'declined', updated_at = now() where id = t.id;
    return public.trade_inbox();
  end if;

  perform app.exec_trade(t.id);
  return public.trade_inbox();
end;
$$;

CREATE FUNCTION public.trade_inbox() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.expire_trades(v_uid);

  -- 진행 중인 거래는 전부, 끝난 거래만 최근 20건. 진행 중인 건이 잘려 나가면
  -- 화면에서 취소할 수도 없는데 새 거래는 TRADE_ALREADY_OPEN 으로 막힌다.
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
    into v_out
    from (
      select t.created_at,
             jsonb_build_object(
               'id',         t.id,
               'status',     t.status,
               'is_gift',    t.is_gift,
               'role',       case when t.from_id = v_uid then 'from' else 'to' end,
               'partner',    case when t.from_id = v_uid then t.to_name else t.from_name end,
               -- 내가 내놓는 것 / 상대가 내놓는 것 으로 정리해서 준다
               'my_coins',   case when t.from_id = v_uid then t.from_coins else t.to_coins end,
               'my_items',   app.describe_items(
                               case when t.from_id = v_uid then t.from_items else t.to_items end),
               'their_coins', case when t.from_id = v_uid then t.to_coins else t.from_coins end,
               'their_items', app.describe_items(
                               case when t.from_id = v_uid then t.to_items else t.from_items end),
               -- 지금 내 차례인가
               'my_turn',
                 (t.status = 'offered'   and t.to_id   = v_uid) or
                 (t.status = 'countered' and t.from_id = v_uid),
               'expires_in', greatest(0, extract(epoch from (t.expires_at - now()))::int),
               'updated_at', t.updated_at
             ) as row
        from public.trades t
       where t.id in (
               select o.id from public.trades o
                where (o.from_id = v_uid or o.to_id = v_uid)
                  and o.status in ('offered', 'countered'))
          or t.id in (
               select c.id from public.trades c
                where (c.from_id = v_uid or c.to_id = v_uid)
                  and c.status not in ('offered', 'countered')
                  and c.updated_at > now() - interval '1 day'
                order by c.created_at desc
                limit 20)
    ) s;

  return v_out;
end;
$$;

CREATE FUNCTION public.trade_offer(p_to text, p_coins integer DEFAULT 0, p_items jsonb DEFAULT '[]'::jsonb, p_gift boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_me    public.profiles;
  v_op    public.profiles;
  v_items jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select * into v_op from public.profiles where username = btrim(p_to);
  if not found then raise exception 'NO_SUCH_PLAYER'; end if;
  if v_op.id = v_uid then raise exception 'CANNOT_TRADE_SELF'; end if;
  if app.is_suspended(v_op.id) then raise exception 'OPPONENT_SUSPENDED'; end if;

  perform 1 from public.profiles where id in (v_uid, v_op.id) order by id for update;
  perform app.expire_trades(v_uid);

  select * into v_me from public.profiles where id = v_uid;
  v_items := app.clean_items(p_items);

  if coalesce(p_coins, 0) < 0 then raise exception 'INVALID_QTY'; end if;
  if coalesce(p_coins, 0) = 0 and v_items = '[]'::jsonb then
    raise exception 'EMPTY_OFFER';
  end if;
  if v_me.coins < coalesce(p_coins, 0) then raise exception 'NOT_ENOUGH_COINS'; end if;
  if not app.can_give(v_uid, v_items) then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- '관리자'가 보낸 거래는 한 쌍당 한 건 제한에서 빠진다(trades_one_open_pair 와 같은 규칙).
  if v_me.username <> app.hidden_name()
     and exists (select 1 from public.trades
                  where status in ('offered', 'countered')
                    and from_name <> app.hidden_name()
                    and ((from_id = v_uid and to_id = v_op.id)
                      or (from_id = v_op.id and to_id = v_uid))) then
    raise exception 'TRADE_ALREADY_OPEN';
  end if;

  insert into public.trades
    (from_id, from_name, to_id, to_name, is_gift, from_coins, from_items)
  values (v_uid, v_me.username, v_op.id, v_op.username,
          coalesce(p_gift, false), coalesce(p_coins, 0), v_items);

  return public.trade_inbox();
end;
$$;

CREATE FUNCTION public.trade_partners() RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(array_agg(username order by hidden desc, username), '{}')
    from public.profiles
   where auth.uid() is not null;
$$;

CREATE FUNCTION public.trade_respond(p_id bigint, p_action text, p_coins integer DEFAULT 0, p_items jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_uid   uuid := auth.uid();
  t       public.trades;
  v_items jsonb;
  v_coins integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_action not in ('decline', 'accept', 'counter') then
    raise exception 'INVALID_ACTION';
  end if;

  select * into t from public.trades where id = p_id for update;
  if not found then raise exception 'NO_TRADE'; end if;
  if t.to_id <> v_uid then raise exception 'NOT_YOUR_TRADE'; end if;
  if t.status <> 'offered' then raise exception 'TRADE_CLOSED'; end if;
  if t.expires_at < now() then
    update public.trades set status = 'expired', updated_at = now() where id = t.id;
    raise exception 'TRADE_EXPIRED';
  end if;

  if p_action = 'decline' then
    update public.trades set status = 'declined', updated_at = now() where id = t.id;
    return public.trade_inbox();
  end if;

  if p_action = 'accept' then
    -- 선물만 이 자리에서 바로 성립한다
    if not t.is_gift then raise exception 'MUST_COUNTER'; end if;
    perform app.exec_trade(t.id);
    return public.trade_inbox();
  end if;

  -- counter
  if t.is_gift then raise exception 'GIFT_NO_COUNTER'; end if;

  v_coins := coalesce(p_coins, 0);
  v_items := app.clean_items(p_items);
  if v_coins < 0 then raise exception 'INVALID_QTY'; end if;
  if v_coins = 0 and v_items = '[]'::jsonb then raise exception 'EMPTY_OFFER'; end if;
  if not app.can_give(v_uid, v_items) then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  perform 1 from public.profiles where id = v_uid for update;
  if (select coins from public.profiles where id = v_uid) < v_coins then
    raise exception 'NOT_ENOUGH_COINS';
  end if;

  update public.trades
     set to_coins = v_coins, to_items = v_items,
         status = 'countered', updated_at = now()
   where id = t.id;

  return public.trade_inbox();
end;
$$;

-- ════════ 트리거 ════════

CREATE TRIGGER trades_party_gone BEFORE UPDATE OF from_id, to_id ON public.trades FOR EACH ROW EXECUTE FUNCTION app.trades_party_gone();

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.confiscate_trade_side(p_uid uuid, p_coins integer, p_items jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.exec_trade(p_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.expire_trades(p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.ledger_trade_id(p_uid uuid, p_created timestamp with time zone, p_detail jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION app.trades_party_gone() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.my_ledger(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_ledger(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.my_ledger(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.my_ledger(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.trade_cancel(p_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.trade_cancel(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.trade_cancel(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.trade_cancel(p_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.trade_finalize(p_id bigint, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.trade_finalize(p_id bigint, p_accept boolean) TO anon;
GRANT ALL ON FUNCTION public.trade_finalize(p_id bigint, p_accept boolean) TO authenticated;
GRANT ALL ON FUNCTION public.trade_finalize(p_id bigint, p_accept boolean) TO service_role;

REVOKE ALL ON FUNCTION public.trade_inbox() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trade_inbox() TO anon;
GRANT ALL ON FUNCTION public.trade_inbox() TO authenticated;
GRANT ALL ON FUNCTION public.trade_inbox() TO service_role;

REVOKE ALL ON FUNCTION public.trade_offer(p_to text, p_coins integer, p_items jsonb, p_gift boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.trade_offer(p_to text, p_coins integer, p_items jsonb, p_gift boolean) TO anon;
GRANT ALL ON FUNCTION public.trade_offer(p_to text, p_coins integer, p_items jsonb, p_gift boolean) TO authenticated;
GRANT ALL ON FUNCTION public.trade_offer(p_to text, p_coins integer, p_items jsonb, p_gift boolean) TO service_role;

REVOKE ALL ON FUNCTION public.trade_partners() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trade_partners() TO anon;
GRANT ALL ON FUNCTION public.trade_partners() TO authenticated;
GRANT ALL ON FUNCTION public.trade_partners() TO service_role;

REVOKE ALL ON FUNCTION public.trade_respond(p_id bigint, p_action text, p_coins integer, p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.trade_respond(p_id bigint, p_action text, p_coins integer, p_items jsonb) TO anon;
GRANT ALL ON FUNCTION public.trade_respond(p_id bigint, p_action text, p_coins integer, p_items jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.trade_respond(p_id bigint, p_action text, p_coins integer, p_items jsonb) TO service_role;

GRANT ALL ON TABLE public.trades TO anon;
GRANT ALL ON TABLE public.trades TO authenticated;
GRANT ALL ON TABLE public.trades TO service_role;

GRANT ALL ON SEQUENCE public.trades_id_seq TO anon;
GRANT ALL ON SEQUENCE public.trades_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.trades_id_seq TO service_role;
