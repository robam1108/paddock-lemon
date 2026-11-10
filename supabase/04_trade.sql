-- =============================================================
--  MINI CASINO - 개인 거래 (거래소)
--
--  실행 순서: 02_schema.sql -> 03_pvp.sql -> 04_trade.sql -> 08_admin.sql
--
--  흐름
--    1) A 가 "내가 줄 것"을 정해 거래를 건다        -> offered
--    2) B 는 거절하거나, "내가 줄 것"을 정해 되보낸다 -> countered
--    3) A 가 최종 수락하면 그때 교환이 일어난다       -> done
--
--    선물이면 2단계가 없다. B 는 수락 또는 거절만 한다.
--
--  설계상 주의한 점
--    - 물건을 미리 묶어두지 않는다(에스크로 없음). 대신 확정하는 순간
--      양쪽 잔액과 수량을 다시 확인하고, 한 트랜잭션 안에서 옮긴다.
--      => 제안해 놓고 그 코인을 다른 데 써버려도 남의 자산이 사라지지 않는다.
--    - 확정 시점에 조건이 깨져 있으면 거래는 실패하고 사유를 알려준다.
--    - 24시간이 지나면 자동으로 만료된다. 한쪽이 뭉개도 영원히 남지 않는다.
--    - 아무 때나 양쪽 다 취소할 수 있다. 되보낸 쪽도 마음을 바꿀 수 있다.
--    - 같은 상대에게 동시에 여러 건을 걸 수 없다.
-- =============================================================

create table if not exists public.trades (
  id          bigint generated always as identity primary key,
  -- 플레이어를 지워도 거래 기록은 남긴다(null = 삭제된 사람). 이름은 *_name 에 있다.
  from_id     uuid references auth.users(id) on delete set null,
  from_name   text not null,
  to_id       uuid references auth.users(id) on delete set null,
  to_name     text not null,
  -- 선물이면 되보내기 단계가 없다
  is_gift     boolean not null default false,
  -- 제안자가 내놓는 것
  from_coins  integer not null default 0 check (from_coins >= 0),
  from_items  jsonb   not null default '[]'::jsonb,
  -- 상대가 내놓는 것 (되보내기 후 채워진다)
  to_coins    integer not null default 0 check (to_coins >= 0),
  to_items    jsonb   not null default '[]'::jsonb,
  -- offered   : 상대가 답할 차례
  -- countered : 제안자가 최종 결정할 차례
  status      text not null default 'offered'
  -- reverted  : 성립 뒤 관리자가 취소(panel_revert_trade) — 받은 것을 압수했다
              check (status in ('offered', 'countered', 'done', 'declined', 'cancelled', 'expired', 'reverted')),
  note        text,
  expires_at  timestamptz not null default now() + interval '24 hours',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint trade_not_self check (from_id <> to_id)
);

-- 이미 만들어진 표에는 위 check 가 다시 적용되지 않으므로 여기서 갈아 끼운다.
alter table public.trades drop constraint if exists trades_status_check;
alter table public.trades add constraint trades_status_check
  check (status in ('offered', 'countered', 'done', 'declined', 'cancelled', 'expired', 'reverted'));

-- 관리자 취소(panel_revert_trade) 기록. reverted_detail 은 실제로 거둔 양이다:
--   {from_side:{coins, items}, to_side:{coins, items}}
--   from_side = 제안자에게서 거둔 것(제안자가 받았던 to_*), to_side 는 그 반대.
alter table public.trades add column if not exists reverted_at     timestamptz;
alter table public.trades add column if not exists reverted_detail jsonb;

-- 예전 표는 from_id/to_id 가 not null · on delete cascade 라 플레이어를 지우면
-- 그 사람의 거래가 통째로 사라졌다. 이미 있는 표도 set null 로 갈아 끼운다
-- (라이브 제약 이름이 달라도 되도록 이름을 찾아서 지운다).
alter table public.trades alter column from_id drop not null;
alter table public.trades alter column to_id   drop not null;

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.trades'::regclass
       and c.contype = 'f'
       and a.attname in ('from_id', 'to_id')
  loop
    execute format('alter table public.trades drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.trades add constraint trades_from_id_fkey
  foreign key (from_id) references auth.users(id) on delete set null;
alter table public.trades add constraint trades_to_id_fkey
  foreign key (to_id) references auth.users(id) on delete set null;

-- 한쪽이 지워지면(set null 은 UPDATE 로 실행된다) 진행 중인 거래는 취소한다.
-- 남겨 두면 "t.to_id <> v_uid" 같은 검사가 null 에서 통과해 버리고,
-- trades_one_open_pair(least/greatest 는 null 을 무시)가 남은 사람의 다음
-- 거래를 막는다.
create or replace function app.trades_party_gone()
returns trigger
language plpgsql
as $$
begin
  if (new.from_id is null or new.to_id is null)
     and new.status in ('offered', 'countered') then
    new.status     := 'cancelled';
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trades_party_gone on public.trades;
create trigger trades_party_gone
  before update of from_id, to_id on public.trades
  for each row execute function app.trades_party_gone();

create index if not exists trades_from_idx on public.trades (from_id, created_at desc);
create index if not exists trades_to_idx   on public.trades (to_id, created_at desc);

-- 같은 두 사람 사이에 진행 중인 거래는 한 건만.
-- '관리자'(app.hidden_name())가 보낸 거래는 빼서, 같은 상대에게 연달아 보낼 수 있다.
drop index if exists public.trades_one_open_pair;
create unique index trades_one_open_pair
  on public.trades (least(from_id, to_id), greatest(from_id, to_id))
  where status in ('offered', 'countered') and from_name <> '관리자';

alter table public.trades enable row level security;
-- 정책 없음: trade_* 함수로만 접근한다.


-- -------------------------------------------------------------
-- 1. 아이템 목록 도우미
--    형식: [{"code":"lunchbox","qty":2}, ...]
-- -------------------------------------------------------------

-- 형식을 검사하고 중복 코드를 합쳐서 돌려준다.
create or replace function app.clean_items(p_items jsonb)
returns jsonb
language plpgsql
immutable
as $$
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

-- 실제로 그만큼 갖고 있는지, 그리고 거래 가능한 아이템인지 확인.
-- 장착 중인 몫(player_flex.stack, expires_at is null)은 잠긴 것으로 치고 뺀다.
create or replace function app.can_give(p_uid uuid, p_items jsonb)
returns boolean
language sql
stable
as $$
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

-- p_gift 가 true 면 p_to 가 대가 없이 받는 것이다 — 그만큼 gifted_qty 를 올려
-- "누군가에게 받은 …" 문장의 근거로 쓴다. p_from 은 자신이 갖고 있던 몫 중
-- 선물분부터 덜어낸다(직접 산 것이 남보다 먼저 나가지 않도록).
create or replace function app.move_items(
  p_from uuid, p_to uuid, p_items jsonb, p_gift boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e     jsonb;
  v_qty integer;
begin
  for e in select * from jsonb_array_elements(p_items) loop
    v_qty := (e->>'qty')::int;

    update public.inventories
       set qty = qty - v_qty,
           gifted_qty = greatest(0, least(gifted_qty, qty - v_qty)),
           stolen_qty = greatest(0, least(stolen_qty, qty - v_qty))
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

-- 화면에 보여줄 이름을 붙여 준다
create or replace function app.describe_items(p_items jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', d.code, 'name', d.name, 'emoji', d.emoji,
           'grade', d.grade, 'qty', (e->>'qty')::int) order by d.sort_order), '[]'::jsonb)
    from jsonb_array_elements(p_items) e
    join public.item_defs d on d.code = e->>'code';
$$;


-- -------------------------------------------------------------
-- 2. 만료 처리
-- -------------------------------------------------------------
create or replace function app.expire_trades(p_uid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.trades
     set status = 'expired', updated_at = now()
   where status in ('offered', 'countered')
     and expires_at < now()
     and (from_id = p_uid or to_id = p_uid);
$$;


-- -------------------------------------------------------------
-- 3. 내 거래 목록
-- -------------------------------------------------------------
create or replace function public.trade_inbox()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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

-- 거래 상대 목록. profiles RLS(not hidden)는 명단에서 관리자 계정을 숨기지만
-- 거래 상대로는 보여야 하므로 여기서 따로 내보낸다. 관리자 계정이 맨 앞,
-- 이름만 돌려주고 hidden 여부는 내보내지 않는다.
create or replace function public.trade_partners()
returns text[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(array_agg(username order by hidden desc, username), '{}')
    from public.profiles
   where auth.uid() is not null;
$$;


-- -------------------------------------------------------------
-- 4. 거래 걸기
-- -------------------------------------------------------------
create or replace function public.trade_offer(
  p_to     text,
  p_coins  integer default 0,
  p_items  jsonb default '[]'::jsonb,
  p_gift   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 5. 받은 쪽의 응답
--    p_action : 'decline' | 'accept'(선물 전용) | 'counter'
-- -------------------------------------------------------------
create or replace function public.trade_respond(
  p_id     bigint,
  p_action text,
  p_coins  integer default 0,
  p_items  jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 6. 제안자의 최종 결정
-- -------------------------------------------------------------
create or replace function public.trade_finalize(p_id bigint, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 7. 취소 (양쪽 다, 진행 중이면 언제든)
-- -------------------------------------------------------------
create or replace function public.trade_cancel(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 8. 실제 교환
--    확정하는 이 순간에 양쪽 조건을 다시 확인한다.
--    한 트랜잭션이므로 도중에 실패하면 아무것도 옮겨지지 않는다.
-- -------------------------------------------------------------
create or replace function app.exec_trade(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 9. 최근 기록 (수감기록 > 기록)
-- -------------------------------------------------------------
create or replace function public.my_ledger(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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


-- -------------------------------------------------------------
-- 10. 관리자: 전체 거래 내역 (p_limit 이 null 이면 전부)
-- -------------------------------------------------------------
create or replace function public.panel_trades(p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
begin
  perform app.require_admin();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',         t.id,
             'from',       t.from_name,
             'to',         t.to_name,
             'from_deleted', t.from_id is null,
             'to_deleted',   t.to_id is null,
             'is_gift',    t.is_gift,
             'status',     t.status,
             'from_coins', t.from_coins,
             'from_items', app.describe_items(t.from_items),
             'to_coins',   t.to_coins,
             'to_items',   app.describe_items(t.to_items),
             'created_at', t.created_at,
             'updated_at', t.updated_at,
             'reverted_at', t.reverted_at,
             'reverted_detail', case when t.reverted_detail is not null then
               jsonb_build_object(
                 'from_coins', coalesce((t.reverted_detail->'from_side'->>'coins')::int, 0),
                 'from_items', app.describe_items(coalesce(t.reverted_detail->'from_side'->'items', '[]'::jsonb)),
                 'to_coins',   coalesce((t.reverted_detail->'to_side'->>'coins')::int, 0),
                 'to_items',   app.describe_items(coalesce(t.reverted_detail->'to_side'->'items', '[]'::jsonb)))
             end
           ) order by t.created_at desc)
      from (select * from public.trades
             order by created_at desc
             limit case when p_limit is null then null
                        else greatest(p_limit, 1) end) t), '[]'::jsonb);
end;
$$;


-- -------------------------------------------------------------
-- 10b. 관리자: 성립된 거래 취소(압수)
--      양쪽이 이 거래로 "받은" 것을 각자에게서 거둔다. 원래 주인에게 돌려주지
--      않는다 — 압수다. 이미 써 버렸거나 남에게 넘긴 몫은 무시하고, 지금 가진
--      만큼만 거둔다. 코인도 잔액까지만(음수로 내려가지 않는다).
-- -------------------------------------------------------------

-- 한쪽에게서 거둔다. 실제로 거둔 {coins, items} 를 돌려준다(items 는 code·qty 형식).
create or replace function app.confiscate_trade_side(p_uid uuid, p_coins integer, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
           gifted_qty = greatest(0, least(gifted_qty, v_left)),
           stolen_qty = greatest(0, least(stolen_qty, v_left))
     where user_id = p_uid and item_code = v_code;

    -- 겹쳐 장착한 수가 남는 수량보다 많으면 남는 만큼으로 줄인다.
    update public.player_flex set stack = v_left
     where user_id = p_uid and item_code = v_code and expires_at is null
       and v_left > 0 and stack > v_left;

    -- 장착분(잠금)까지 거둬 남는 게 없으면 장착을 푼다. 절도비법이면 확정
    -- 성공 예약도 함께 끈다(flex_unequip 과 같은 규칙).
    if v_left <= 0 then
      delete from public.player_flex
       where user_id = p_uid and item_code = v_code and expires_at is null;
      if found and exists (select 1 from public.item_defs
                            where code = v_code and steal_sure) then
        update public.profiles set steal_sure = false where id = p_uid;
      end if;

      -- 개봉한 갑에 남은 개비(open_left)는 살려 둔다(panel_take_item 과 같다).
      delete from public.inventories
       where user_id = p_uid and item_code = v_code and open_left = 0;
    end if;

    v_items := v_items || jsonb_build_object('code', v_code, 'qty', v_take);
  end loop;

  return jsonb_build_object('coins', coalesce(v_coins, 0), 'items', v_items);
end;
$$;

create or replace function public.panel_revert_trade(
  p_id       bigint,
  p_category text default null,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  t        public.trades;
  v_reason jsonb;
  v_from   jsonb;   -- 제안자에게서 거둔 것(제안자가 받았던 to_*)
  v_to     jsonb;   -- 상대에게서 거둔 것(상대가 받았던 from_*)
  v_coins  integer;
begin
  perform app.require_admin();
  v_reason := app.admin_reason(p_category, p_note);

  select * into t from public.trades where id = p_id for update;
  if not found then raise exception 'NO_TRADE'; end if;
  if t.status <> 'done' then raise exception 'TRADE_NOT_DONE'; end if;

  -- 두 사람의 잔액을 항상 같은 순서로 잠근다(exec_trade 와 같다)
  perform 1 from public.profiles
   where id in (t.from_id, t.to_id) order by id for update;

  -- 삭제된 사람(id 가 null)은 거둘 것도, 기록을 남길 곳도 없어 건너뛴다.
  v_from := case when t.from_id is null then '{"coins":0,"items":[]}'::jsonb
                 else app.confiscate_trade_side(t.from_id, t.to_coins, t.to_items) end;
  v_to   := case when t.to_id is null then '{"coins":0,"items":[]}'::jsonb
                 else app.confiscate_trade_side(t.to_id, t.from_coins, t.from_items) end;

  -- 성립 기록 두 줄에 거래 번호를 박아 둔다. 아래에서 updated_at 이 바뀌면
  -- app.ledger_trade_id 의 시각 대조로는 더 이상 이 거래를 찾지 못한다.
  update public.ledger
     set detail = detail || jsonb_build_object('trade_id', t.id)
   where kind = 'trade'
     and user_id in (t.from_id, t.to_id)
     and created_at = t.updated_at;

  update public.trades
     set status = 'reverted', reverted_at = now(), updated_at = now(),
         reverted_detail = jsonb_build_object('from_side', v_from, 'to_side', v_to)
   where id = t.id;

  if t.from_id is not null then
    select coins into v_coins from public.profiles where id = t.from_id;
    perform app.log(t.from_id, 'admin',
      format('%s 와의 거래 취소 — 회수', t.to_name),
      -(v_from->>'coins')::int, v_coins,
      v_reason || jsonb_build_object('trade_id', t.id,
                                     'coins', (v_from->>'coins')::int,
                                     'items', app.describe_items(v_from->'items')));
  end if;

  if t.to_id is not null then
    select coins into v_coins from public.profiles where id = t.to_id;
    perform app.log(t.to_id, 'admin',
      format('%s 와의 거래 취소 — 회수', t.from_name),
      -(v_to->>'coins')::int, v_coins,
      v_reason || jsonb_build_object('trade_id', t.id,
                                     'coins', (v_to->>'coins')::int,
                                     'items', app.describe_items(v_to->'items')));
  end if;

  return jsonb_build_object(
    'id',   t.id,
    'from', jsonb_build_object('name', t.from_name, 'deleted', t.from_id is null,
                               'coins', (v_from->>'coins')::int,
                               'items', app.describe_items(v_from->'items')),
    'to',   jsonb_build_object('name', t.to_name, 'deleted', t.to_id is null,
                               'coins', (v_to->>'coins')::int,
                               'items', app.describe_items(v_to->'items'))
  );
end;
$$;

-- -------------------------------------------------------------
-- 10c. 관리자: 기록(ledger)에서 거래 확인 · 회수
--      상대가 삭제돼 trades 행이 사라진 거래도 살아 있는 쪽 기록에는 남는다
--      (exec_trade 가 detail 에 gave_* · got_* 를 적었다). 거기서 이 사람이
--      받은 것(got_*)만 거둔다.
--
--      기록 ↔ 거래 연결: detail.trade_id 가 있으면 그것, 없으면(옛 기록)
--      exec_trade 가 한 트랜잭션에서 남긴 trades.updated_at = ledger.created_at
--      으로 찾는다. 연결된 거래가 있으면 이중 회수를 막기 위해 거래 취소
--      (panel_revert_trade)로만 처리한다.
-- -------------------------------------------------------------
create or replace function app.ledger_trade_id(p_uid uuid, p_created timestamptz, p_detail jsonb)
returns bigint
language sql
stable
security definer
set search_path = public, app
as $$
  select coalesce(
    (p_detail->>'trade_id')::bigint,
    (select t.id from public.trades t
      where t.status = 'done'
        and t.updated_at = p_created
        and (t.from_id = p_uid or t.to_id = p_uid)
      limit 1));
$$;

create or replace function public.panel_trade_ledger(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id uuid;
begin
  perform app.require_admin();

  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',          x.id,
             'created_at',  x.created_at,
             'title',       x.title,
             'coin_delta',  x.coin_delta,
             'partner',     x.detail->>'partner',
             'partner_deleted', not exists (select 1 from public.profiles p
                                             where p.username = x.detail->>'partner'),
             'gave_coins',  coalesce((x.detail->>'gave_coins')::int, 0),
             'gave_items',  coalesce(x.detail->'gave_items', '[]'::jsonb),
             'got_coins',   coalesce((x.detail->>'got_coins')::int, 0),
             'got_items',   coalesce(x.detail->'got_items', '[]'::jsonb),
             'confiscated', case when x.detail ? 'confiscated' then
                              jsonb_build_object(
                                'coins', (x.detail->'confiscated'->>'coins')::int,
                                'items', app.describe_items(x.detail->'confiscated'->'items'),
                                'at',    x.detail->'confiscated'->'at')
                            end,
             -- 연결이 끊긴 옛 기록인데 같은 상대와의 관리자 거래 취소가 뒤에 있으면
             -- 이미 처리된 거래일 수 있다 — 화면에서 경고만 한다.
             'maybe_reverted', x.tid is null and exists (
                                 select 1 from public.ledger a
                                  where a.user_id = v_id and a.kind = 'admin'
                                    and a.title = format('%s 와의 거래 취소 — 회수', x.detail->>'partner')
                                    and a.created_at > x.created_at),
             'trade', case when t.id is not null then jsonb_build_object(
                        'id', t.id, 'status', t.status,
                        'from', t.from_name, 'to', t.to_name,
                        'from_deleted', t.from_id is null,
                        'to_deleted',   t.to_id is null)
                      end
           ) order by x.created_at desc)
      from (select l.*, app.ledger_trade_id(l.user_id, l.created_at, l.detail) as tid
              from public.ledger l
             where l.user_id = v_id and l.kind = 'trade') x
      left join public.trades t on t.id = x.tid), '[]'::jsonb);
end;
$$;

create or replace function public.panel_confiscate_ledger_trade(
  p_ledger_id bigint,
  p_category  text default null,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  l        public.ledger;
  v_reason jsonb;
  v_got    jsonb;
  v_coins  integer;
  v_name   text;
begin
  perform app.require_admin();
  v_reason := app.admin_reason(p_category, p_note);

  select * into l from public.ledger where id = p_ledger_id for update;
  if not found or l.kind <> 'trade' then raise exception 'NO_TRADE'; end if;
  if l.detail ? 'confiscated' then raise exception 'ALREADY_CONFISCATED'; end if;
  if app.ledger_trade_id(l.user_id, l.created_at, l.detail) is not null then
    raise exception 'TRADE_LINKED';
  end if;

  select username into v_name from public.profiles where id = l.user_id for update;
  if v_name is null then raise exception 'NO_SUCH_PLAYER'; end if;

  -- got_items 는 describe_items 형식(code · qty 포함)이라 그대로 넘긴다.
  v_got := app.confiscate_trade_side(l.user_id,
             coalesce((l.detail->>'got_coins')::int, 0),
             coalesce(l.detail->'got_items', '[]'::jsonb));

  update public.ledger
     set detail = detail || jsonb_build_object('confiscated', v_got || jsonb_build_object('at', now()))
   where id = l.id;

  select coins into v_coins from public.profiles where id = l.user_id;
  perform app.log(l.user_id, 'admin',
    format('%s 와의 거래 회수', l.detail->>'partner'),
    -(v_got->>'coins')::int, v_coins,
    v_reason || jsonb_build_object('ledger_id', l.id,
                                   'coins', (v_got->>'coins')::int,
                                   'items', app.describe_items(v_got->'items')));

  return jsonb_build_object(
    'name',    v_name,
    'partner', l.detail->>'partner',
    'coins',   (v_got->>'coins')::int,
    'items',   app.describe_items(v_got->'items'));
end;
$$;

-- -------------------------------------------------------------
-- 11. 권한
-- -------------------------------------------------------------
revoke all on function public.panel_trades(integer)          from public;
grant execute on function public.panel_trades(integer)       to authenticated;
revoke all on function public.panel_revert_trade(bigint, text, text)    from public;
grant execute on function public.panel_revert_trade(bigint, text, text) to authenticated;

revoke all on function app.exec_trade(bigint)                        from public, anon, authenticated;
revoke all on function app.move_items(uuid, uuid, jsonb, boolean)     from public, anon, authenticated;
revoke all on function app.expire_trades(uuid)                       from public, anon, authenticated;
revoke all on function app.confiscate_trade_side(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function app.trades_party_gone()                        from public, anon, authenticated;
revoke all on function app.ledger_trade_id(uuid, timestamptz, jsonb)  from public, anon, authenticated;

revoke all on function public.panel_trade_ledger(text)                          from public;
grant execute on function public.panel_trade_ledger(text)                       to authenticated;
revoke all on function public.panel_confiscate_ledger_trade(bigint, text, text) from public;
grant execute on function public.panel_confiscate_ledger_trade(bigint, text, text) to authenticated;

revoke all on function public.trade_inbox()                              from public;
revoke all on function public.trade_partners()                           from public;
revoke all on function public.trade_offer(text, integer, jsonb, boolean) from public;
revoke all on function public.trade_respond(bigint, text, integer, jsonb) from public;
revoke all on function public.trade_finalize(bigint, boolean)            from public;
revoke all on function public.trade_cancel(bigint)                       from public;
revoke all on function public.my_ledger(integer)                         from public;

grant execute on function public.trade_inbox()                              to authenticated;
grant execute on function public.trade_partners()                           to authenticated;
grant execute on function public.trade_offer(text, integer, jsonb, boolean) to authenticated;
grant execute on function public.trade_respond(bigint, text, integer, jsonb) to authenticated;
grant execute on function public.trade_finalize(bigint, boolean)            to authenticated;
grant execute on function public.trade_cancel(bigint)                       to authenticated;
grant execute on function public.my_ledger(integer)                         to authenticated;
