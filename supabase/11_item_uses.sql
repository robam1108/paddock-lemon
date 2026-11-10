-- 아이템(주로 담배)에 "한 개에 든 사용 횟수(개비 수)"를 도입하는 패치.
-- 지금까지는 flex_use() 가 무조건 인벤에서 1개를 통째로 지웠다 — "구겨진
-- 담배갑"·"수입 담배"처럼 이름부터 갑(pack)인 물건도 한 번 쓰면 사라졌다.
--
-- 방식: item_defs.uses(한 개에 든 사용 횟수, 기본 1)를 새로 두고, 갑을
-- 처음 뜯을 때만 기존과 같이 qty 를 1 줄인 뒤, 남은 횟수를
-- inventories.open_left 에 적어 둔다. 그 뒤로는 open_left 에서만 빠지고
-- qty 는 그대로다. 즉 qty 는 "봉인된 갑의 수"만을 뜻하게 된다.
--
-- 이 설계 덕분에 거래(04_trade.sql)·반납(sell_item)·라이터 판정(has_lighter)은
-- 전부 qty 만 보므로 한 줄도 고치지 않아도 "개봉한 갑은 거래·반납·라이터로
-- 못 넘긴다"가 그대로 성립한다. uses = 1 인 아이템(담배 외 전부)은 open_left
-- 가 항상 0 이라 예전과 완전히 같은 동작을 한다 — 회귀 위험이 없다.
--
-- 개비 수 자체(어느 담배가 몇 개비인가)는 여기서 정하지 않는다 —
-- supabase/17_items.sql 의 "개비 수(uses)" 표가 정본이다. 이 패치를 먼저
-- 돌리면 uses 컬럼이 전부 기본값 1로 시작하고, 17_items.sql 을 이어서
-- 돌리면 담배 몇 종만 실제 값으로 올라간다.
--
-- 라이브 DB 에는 02_schema.sql 전체를 다시 돌리지 말고 이 파일만 실행한다.
-- (내용은 02_schema.sql 에 이미 반영되어 있다. 적용 후 이 파일은 지워도 된다.)
--
-- 배포 순서: 클라이언트 먼저 → 이 패치 → 17_items.sql(개비 수 값 채우기).
--   클라이언트가 먼저 올라가야 uses/open_left 를 곧바로 화면에 반영한다.
--   거꾸로 이 패치를 먼저 돌려도 예전 클라이언트는 새 필드를 무시하므로
--   무해하다.
--
-- 이 패치는 app.state_json() 을 다시 정의한다. 이 함수를 마지막으로 갈아
-- 끼운 패치는 archive/patch_livestock_consent_cooldown.sql 이므로, 이 파일은 반드시
-- 그보다 나중에(즉 지금 이 순서대로) 실행해야 livestock_lock_left 등 그
-- 패치가 추가한 필드를 잃지 않는다.
--
-- 롤백: uses/open_left/open_gifted 를 참조하는 줄들을 뺀 이전 본문으로
-- 아래 네 함수를 다시 create or replace 하면 된다. 세 컬럼은 남겨 둬도
-- 무해하다(전부 기본값이면 예전과 동작이 같다).

begin;

-- 한 개(갑)에 든 사용 횟수(개비 수). 대부분 1이고, 담배 몇 종만 여러 번 쓴다
-- (17_items.sql 의 "개비 수(uses)" 표가 값을 쥔다).
alter table public.item_defs add column if not exists uses integer not null default 1;
alter table public.item_defs drop constraint if exists item_uses_check;
alter table public.item_defs add constraint item_uses_check check (uses >= 1);

-- 개봉한 갑에 남은 사용 횟수. 0 이면 개봉분이 없다는 뜻이다. qty 는 이 값과
-- 무관하게 항상 "봉인된 갑의 수"로 남는다.
alter table public.inventories add column if not exists open_left integer not null default 0;
alter table public.inventories drop constraint if exists inventories_open_left_check;
alter table public.inventories add constraint inventories_open_left_check
  check (open_left >= 0);
-- 개봉한 갑이 선물로 받은 몫이었는지 — 남은 개비를 마저 쓸 때도
-- "누군가에게 받은 …" 문구(flex_text_gift)를 이어서 쓰기 위함.
alter table public.inventories add column if not exists open_gifted boolean not null default false;

-- app.state_json 의 정본은 16_steal_trick.sql 이다(02_schema.sql 에 같은 본문의
-- 사본이 있고, 02 는 맨 앞에서 돌아 되감기지 않는다). 여기 있던 옛 사본에는
-- steal_sure·훔친 문구·stolen_qty 가 없어서, 이 파일만 단독으로 다시 돌리면
-- 그것들이 화면에서 조용히 사라졌다 — 그래서 지웠다.

-- 순수 과시 소모품(담배·술·향수). 게임 효과가 있는 아이템(식량·의약품·약물)은
-- use_item 으로만 쓴다 — 여기서 한번 더 막아, 효과 정산을 우회하지 못하게 한다.
create or replace function public.flex_use(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
     or v_def.win_double > 0 or v_def.detox then
    raise exception 'NOT_FLEX';
  end if;

  -- 담배는 라이터가 있어야 피운다. 라이터는 소모되지 않고 보유만 확인한다.
  if v_def.kind = 'tobacco' and not app.has_lighter(v_uid) then
    raise exception 'NEED_LIGHTER';
  end if;

  -- uses > 1 인 물건(담배갑 등)은 처음 한 번만 갑을 뜯어 qty 를 줄이고,
  -- 남은 개비는 open_left 에서 빠진다. uses = 1 이면 open_left 가 항상 0 이라
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

-- 아이템 회수 — 봉인된 갑을 전부 회수해도 개봉한 갑에 남은 개비(open_left)는
-- 살아 있어야 하므로, 그 값이 0 일 때만 행을 지운다.
--
-- 본문은 02_schema.sql 의 정본을 그대로 복사한 것이다. 예전에는 여기에 인자가
-- 넷(p_reason)인 옛 시그니처가 남아 있어서, 02 가 그것을 drop 하고 다섯 인자
-- (p_category · p_note)로 새로 만든 뒤 이 파일이 옛 것을 되살려 놓았다 — 오버로드
-- 둘이 공존해 3인자 호출이 모호해지고, 새로 만들어진 쪽은 기본 권한이 PUBLIC 으로
-- 돌아가고, 회수 사유가 원장에 안 남았다. APPLY.md 맨 아래 "인자를 늘리거나 줄일 때"
-- 문단이 경고하는 바로 그 경우다.
drop function if exists public.panel_take_item(text, text, integer, text);
create or replace function public.panel_take_item(
  p_name     text,
  p_code     text,
  p_qty      integer,
  p_category text default null,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id     uuid;
  v_name   text;
  v_emoji  text;
  v_had    integer;
  v_left   integer;
  v_coins  integer;
  v_reason jsonb;
begin
  perform app.require_admin();
  if p_qty is null or p_qty < 1 then raise exception 'INVALID_QTY'; end if;
  v_reason := app.admin_reason(p_category, p_note);

  select id, coins into v_id, v_coins from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  select name, emoji into v_name, v_emoji from public.item_defs where code = p_code;
  if v_name is null then raise exception 'NO_SUCH_ITEM'; end if;

  select qty into v_had from public.inventories
   where user_id = v_id and item_code = p_code for update;
  if v_had is null or v_had < p_qty then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 선물·훔친 몫도 남는 수량까지 함께 자른다(inventories_gifted_check ·
  -- stolen 제약). app.confiscate_trade_side 와 같은 규칙.
  v_left := v_had - p_qty;
  update public.inventories
     set qty        = v_left,
         gifted_qty = greatest(0, least(gifted_qty, v_left)),
         stolen_qty = greatest(0, least(stolen_qty, v_left))
   where user_id = v_id and item_code = p_code;

  -- 겹쳐 장착한 수가 남는 수량보다 많으면 남는 만큼으로 줄인다.
  update public.player_flex set stack = v_left
   where user_id = v_id and item_code = p_code and expires_at is null
     and v_left > 0 and stack > v_left;

  if v_left <= 0 then
    -- 장착분(잠금)까지 거둬 남는 게 없으면 장착을 푼다. 절도비법이면 확정
    -- 성공 예약도 함께 끈다(flex_unequip 과 같은 규칙).
    delete from public.player_flex
     where user_id = v_id and item_code = p_code and expires_at is null;
    if found and exists (select 1 from public.item_defs
                          where code = p_code and steal_sure) then
      update public.profiles set steal_sure = false where id = v_id;
    end if;

    -- 개봉한 갑에 남은 개비(open_left)가 있으면, 봉인된 갑을 전부 회수해도
    -- 그 개비는 살아 있어야 하므로 행을 지우지 않는다.
    delete from public.inventories
     where user_id = v_id and item_code = p_code and open_left = 0;
  end if;

  perform app.log(
    v_id, 'admin',
    format('%s %s %s개 회수', v_emoji, v_name, p_qty),
    0, v_coins,
    v_reason || jsonb_build_object('code', p_code, 'qty', -p_qty)
  );

  return jsonb_build_object('name', btrim(p_name), 'item', v_name, 'qty', coalesce(v_left, 0));
end;
$$;

revoke all on function public.panel_take_item(text, text, integer, text, text) from public;
grant execute on function public.panel_take_item(text, text, integer, text, text) to authenticated;

-- 관리자 목록/상세 — 개봉분만 남은(qty=0, open_left>0) 소지품도 계속 보이게 한다.
create or replace function public.panel_players()
returns table (
  username text, code text, coins integer,
  hp integer, hp_status text, in_ward boolean,
  plays_used integer, bonus_plays integer, plays_left integer,
  items jsonb,
  is_admin boolean, created_at timestamptz,
  suspended_until timestamptz, suspend_reason text
)
language plpgsql
security definer
set search_path = public, app
as $$
begin
  perform app.require_admin();
  return query
    select p.username, coalesce(c.code, '(기록 없음)'), p.coins,
           p.hp, app.hp_status(p.hp), (p.ward_until is not null),
           p.plays_used, p.bonus_plays,
           greatest(0, app.daily_play_limit() + p.bonus_plays - p.plays_used),
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'code', d.code, 'name', d.name, 'emoji', d.emoji,
                      'grade', d.grade, 'qty', i.qty, 'open_left', i.open_left)
                    order by d.sort_order, d.code)
               from public.inventories i
               join public.item_defs d on d.code = i.item_code
              where i.user_id = p.id and (i.qty > 0 or i.open_left > 0)), '[]'::jsonb),
           p.is_admin, p.created_at,
           case when p.suspended_until is not null and p.suspended_until > now()
                then p.suspended_until end,
           case when p.suspended_until is not null and p.suspended_until > now()
                then p.suspend_reason end
      from public.profiles p
      left join public.player_codes c on c.user_id = p.id
     order by p.created_at;
end;
$$;

create or replace function public.panel_player(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id uuid;
  v_p  public.profiles;
begin
  perform app.require_admin();

  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  -- 흐른 시간을 반영한 뒤의 값을 보여준다.
  v_p := app.accrue(v_id);

  return jsonb_build_object(
    'username',    v_p.username,
    'coins',       v_p.coins,
    'debt',        v_p.debt,
    'hp',          v_p.hp,
    'hp_max',      app.hp_max(),
    'hp_status',   app.hp_status(v_p.hp),
    'in_ward',     (v_p.ward_until is not null),
    'ward_left',   case when v_p.ward_until is null then 0
                        else greatest(0, extract(epoch from (v_p.ward_until - now()))::int) end,
    'plays_used',  v_p.plays_used,
    'bonus_plays', v_p.bonus_plays,
    'plays_left',  greatest(0, app.daily_play_limit() + v_p.bonus_plays - v_p.plays_used),
    'win_double',  v_p.win_double,
    'is_admin',    v_p.is_admin,
    'created_at',  v_p.created_at,
    'suspended_until', case when v_p.suspended_until is not null and v_p.suspended_until > now()
                             then v_p.suspended_until end,
    'suspend_reason',  case when v_p.suspended_until is not null and v_p.suspended_until > now()
                             then v_p.suspend_reason end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', d.code, 'name', d.name, 'emoji', d.emoji,
               'grade', d.grade, 'kind', d.kind, 'qty', i.qty,
               'open_left', i.open_left)
             order by d.sort_order, d.code)
        from public.inventories i
        join public.item_defs d on d.code = i.item_code
       where i.user_id = v_id and (i.qty > 0 or i.open_left > 0)), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'kind', l.kind, 'title', l.title,
               'coin_delta', l.coin_delta, 'coin_after', l.coin_after,
               'created_at', l.created_at) order by l.created_at desc)
        from (select * from public.ledger
               where user_id = v_id order by created_at desc limit 10) l), '[]'::jsonb)
  );
end;
$$;

commit;
