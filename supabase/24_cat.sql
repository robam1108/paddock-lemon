-- =============================================================
--  24. 탐색 고양이 · 츄르 · 고양이의 보은
--
--  왜
--    탐색에 물건 말고 마주칠 것이 하나 있으면 좋겠다. 시설에 사는 고양이 한
--    마리 — 다만 부르는 이름은 사람마다 다르다. 원래 제 부르고 싶은 대로 부른다.
--
--  규칙
--    · 고양이 자리는 유저마다·날마다 다섯 곳 중 하나로 정해진다(app.cat_place).
--      그곳을 탐색하면 추첨 없이 고양이를 만난다(19_search.sql 의 search_look).
--      체력과 오늘 몫은 그대로 나가고, 물건은 못 찾는다.
--    · 만남 한 번에 행동 한 번 — 간식주기 또는 쓰다듬기(public.cat_act). 누르면
--      고양이는 떠난다.
--        간식주기: 츄르(app.cat_churu_item)나 날생선(app.cat_fish_items — 고등어·전갱이)
--                  중 하나를 준다. 여러 종류를 가졌으면 고른다(p_snack). 친밀도는
--                  츄르 +app.cat_churu_bond(), 생선 +app.cat_fish_bond(). 간식이
--                  하나도 없으면 고양이가 도망간다.
--        쓰다듬기: 친밀도가 app.cat_friend_need() 미만이면 도망간다. 넘으면 성공.
--    · 쓰다듬기에 처음 성공하면 내가 부를 이름을 한 번 짓는다(public.cat_set_name).
--      이름은 사람마다 따로다(cat_bonds.name) — 화면의 "고양이" 자리는 전부 내가 지은
--      이름이 된다.
--    · 이름을 지은 뒤 츄르를 주면 app.cat_gift_rate(), 생선을 주면
--      app.cat_fish_gift_rate() 확률로 app.cat_gift_delay() 뒤에 보은
--      (app.cat_gift_items 중 하나)이 도착한다.
--    · 소지품에 생선이 있으면 고양이 자리가 아닌 곳에서도 app.cat_fish_lure_chance()
--      확률로 고양이를 만난다(19_search.sql 의 search_look).
--    · 이름을 지은 뒤에는 탐색 화면의 고양이 자리 칸 오른쪽 아래에 발자국이 찍혀
--      직접 찾아갈 수 있다(search_board 의 cat_spot). 그때부터는 발자국을 피해 다른
--      곳을 고르면 만나고 싶지 않은 것으로 보고, 생선을 가져도 고양이가 안 나온다.
--    · 보은이 도착하면 소지품 탭에 들어갈 때
--      cat_gifts_pending 으로 띄우고, cat_gift_resolve 로 받거나 버린다.
--    · 보은(죽은 새·쥐·벌레)은 거래가 안 되고, 소지품에서 몰래 치울 수 있다
--      (cat_gift_toss). 쓰면(cat_gift_use) 품목마다 효과가 하나씩 켜진다 — 같은
--      효과가 남아 있는 동안 같은 품목은 다시 못 쓴다(CAT_GIFT_ACTIVE).
--        죽은 새:   다음 app.cat_bird_plays() 판의 판돈에 app.cat_bird_stake()
--                   (02 의 app.bonus_stake 가 app.cat_bless_charge 를 부른다)
--        죽은 쥐:   다음 훔치기 한 번의 성공률 +app.cat_mouse_steal()
--                   (16 의 shop_steal/smuggle_steal 이 app.cat_steal_bonus 를 부른다)
--        죽은 벌레: 다음 작업 한 번을 후하게(band high) 받는다
--                   (18 의 labor_work/labor_night_work 가 app.cat_labor_good_take 를 부른다)
--      효과 설명은 화면의 사용 팝업에만 있다 — 품목 설명에는 적지 않는다.
--    · 보은을 가장 많이 가진 사람(죽은 것 하나 = 1)의 특이사항
--      맨 아래에 "떠돌이 고양이에게 가장 사랑받는다." 가 붙는다(public.cat_favorite —
--      문장은 클라이언트가 붙인다). 동점이면 먼저 그 수에 오른 사람이 계속 갖는다.
--
--  공개 스위치: 00_rules.sql 의 app.cat_public(). false 인 동안은 시험 계정만 고양이를
--  만나고(탐색 탭의 테스트 패널 = public.cat_test), 츄르는 밀거래에 안 뜬다(17 의
--  buy_price = null). 공개할 때: ① 테스트 패널 "초기화" ② app.cat_public() → true
--  ③ 17 의 츄르 buy_price → 50. — 2026-11-04 공개(repair/2026-11-04_cat_open.sql).
--
--  손잡이는 전부 00_rules.sql 의 app.cat_* 다. 품목 행(츄르 · 죽은 새/쥐/벌레)은
--  17_items.sql 이 정본이다. 예전의 "고양이의 보은"(같은 것 셋을 합친 품목)은
--  2026-11-05 에 없앴다(repair/2026-11-05_cat_gift_effects.sql).
--
--  적용 순서: 00_rules.sql(app.cat_*) · 16_steal_trick.sql(app.take_one_item) ·
--  17_items.sql(품목 행 — cat_gifts 의 FK) 뒤. 새 테이블·새 함수뿐이라 라이브에도
--  통째로 돌린다(다시 돌려도 안전). 19_search.sql 의 search_look/search_board 와
--  02 의 app.bonus_stake 가 여기 것을 부르므로, 라이브에서는 17 → 이 파일 →
--  repair/2026-11-04_search_cat.sql(00 · 02 · 16 · 19 수정분) 순서로 돌린다.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. 표
-- -------------------------------------------------------------

-- 예전에는 고양이 이름이 한 사람 몫(public.cat 한 행)이었다. 공개 전에 사람마다
-- 따로 짓게 바꿔서 지운다 — 아직 시험 계정밖에 쓰지 않았다.
drop table if exists public.cat;

-- 유저별 친밀도 · 쓰다듬기 성공 여부 · 내가 지은 이름.
-- churu_given 은 이름만 남은 친밀도 점수다 — 생선도 여기에 더한다.
create table if not exists public.cat_bonds (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  churu_given integer not null default 0
);
alter table public.cat_bonds add column if not exists petted   boolean not null default false;
alter table public.cat_bonds add column if not exists name     text;
alter table public.cat_bonds add column if not exists named_at timestamptz;

-- 보은. ready_at 이 지나야 보이고, 받거나 버리면 resolved_at 이 찍힌다.
create table if not exists public.cat_gifts (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_code   text not null references public.item_defs(code),
  ready_at    timestamptz not null,
  resolved_at timestamptz,
  kept        boolean
);

create index if not exists cat_gifts_user_open
  on public.cat_gifts (user_id, ready_at) where resolved_at is null;

-- 떠돌이 고양이에게 가장 사랑받는 사람 — 한 행. 동점일 때 먼저 오른 사람을
-- 지키려고 계산 결과를 저장해 둔다(app.cat_favorite_refresh).
create table if not exists public.cat_favorite (
  id      integer primary key default 1 check (id = 1),
  user_id uuid references auth.users(id) on delete set null,
  since   timestamptz
);

insert into public.cat_favorite (id) values (1) on conflict (id) do nothing;

-- 죽은 새가 켜 둔 판돈 추가 — 한 판에 cat_boost 만큼, cat_boost_left 판 동안.
alter table public.profiles add column if not exists cat_boost      integer not null default 0;
alter table public.profiles add column if not exists cat_boost_left integer not null default 0;
-- 죽은 쥐 — 다음 훔치기 한 번 / 죽은 벌레 — 다음 작업 한 번. 쓰이면 꺼진다.
alter table public.profiles add column if not exists cat_steal_boost boolean not null default false;
alter table public.profiles add column if not exists cat_labor_good  boolean not null default false;


-- -------------------------------------------------------------
-- 2. 고양이 자리 — 유저 · 날짜로 정해지고 그날은 바뀌지 않는다.
--    hashtext 는 음수도 내므로 % 를 두 번 해 0~4 로 맞춘다.
-- -------------------------------------------------------------
create or replace function app.cat_place(p_uid uuid, p_day date)
returns text
language sql
immutable
as $$
  select (array['cell', 'mess', 'shower', 'works', 'infirm'])
           [((hashtext(p_uid::text || ':' || p_day::text) % 5) + 5) % 5 + 1]
$$;


-- 고양이를 쓸 수 있는가 — 공개됐거나(app.cat_public) 시험 계정(app.search_is_tester).
-- plpgsql 로 둔다 — sql 함수는 만들 때 본문을 검사해서, 라이브에서 이 파일을
-- repair(app.search_is_tester 를 만든다)보다 먼저 돌리면 여기서 멈춘다.
create or replace function app.cat_open(p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app
as $$
begin
  return app.cat_public() or app.search_is_tester(p_uid);
end;
$$;

-- 내가 지은 고양이 이름. 아직 안 지었으면 null.
create or replace function app.cat_name_of(p_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, app
as $$
begin
  return (select name from public.cat_bonds where user_id = p_uid);
end;
$$;


-- -------------------------------------------------------------
-- 3. 가장 사랑받는 사람
-- -------------------------------------------------------------

-- 사람마다 가진 보은 점수 — 죽은 새·쥐·벌레 하나 = 1.
-- plpgsql 로 둔다 — 00 의 새 손잡이가 아직 없는 라이브 DB 에서도 이 파일이 먼저 돈다.
create or replace function app.cat_scores()
returns table (user_id uuid, score integer)
language plpgsql
stable
security definer
set search_path = public, app
as $$
begin
  return query
  select i.user_id, sum(i.qty)::integer
    from public.inventories i
   where i.qty > 0
     and i.item_code = any(app.cat_gift_items())
   group by i.user_id;
end;
$$;

-- 가진 보은을 다시 세어 주인을 정한다. 지금 주인의 점수가 최댓값과 같으면 그대로
-- 두고(동점이면 먼저 오른 사람), 아니면 최댓값인 사람에게 넘긴다 — 여럿이면 방금
-- 바뀐 사람(p_actor)을 먼저. 최댓값이 0 이면 비운다.
create or replace function app.cat_favorite_refresh(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
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

-- 지금 가장 사랑받는 사람의 이름. 조회할 때 한 번 다시 세어 관리자 지급·회수로
-- 바뀐 것도 맞춘다. 공개 전에는 시험 계정에게만 알려 준다.
create or replace function public.cat_favorite()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 4. 간식주기 / 쓰다듬기
--    p_snack 은 간식주기에서 줄 품목(츄르 · 날생선). 가진 간식이 한 종류면
--    null 로 불러도 그것을 준다. 옛 한 인자짜리는 지운다(인자가 늘었다).
-- -------------------------------------------------------------
drop function if exists public.cat_act(text);

create or replace function public.cat_act(p_action text, p_snack text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 5. 이름 짓기 — 쓰다듬기에 성공한 뒤, 내 이름이 아직 없을 때 한 번.
-- -------------------------------------------------------------
create or replace function public.cat_set_name(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 6. 보은 — 도착한 것 보기 · 받기/버리기 · 몰래버리기
-- -------------------------------------------------------------

-- 소지품 탭이 들어올 때마다 부른다. 내가 지은 이름과, 보은 효과가 켜져 있는지
-- (죽은 새의 남은 판 · 죽은 쥐 · 죽은 벌레 — 사용 팝업이 다시 쓰기를 막는 데 쓴다)도 함께 준다.
create or replace function public.cat_gifts_pending()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid  uuid := auth.uid();
  v_p    public.profiles;
  v_fx   jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_p from public.profiles where id = v_uid;
  v_fx := jsonb_build_object(
    'bless_left',  coalesce(v_p.cat_boost_left, 0),
    'steal_ready', coalesce(v_p.cat_steal_boost, false),
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

-- 받기면 소지품에 넣고, 버리기면 기록만 남긴다.
create or replace function public.cat_gift_resolve(p_id bigint, p_keep boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
    case when v_keep then '고양이의 보은' else '보은 버림' end,
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

-- 몰래버리기 — 죽은 새·쥐·벌레 하나를 소지품에서 치운다.
create or replace function public.cat_gift_toss(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
  perform app.log(v_uid, 'cat', '보은 몰래버리기', 0, v_p.coins,
    jsonb_build_object('code', p_code));

  return app.state_json(v_p) || jsonb_build_object('cat_toss', jsonb_build_object(
    'code', v_def.code,
    'name', v_def.name,
    'cat_name', app.cat_name_of(v_uid)
  ));
end;
$$;


-- -------------------------------------------------------------
-- 7. 보은 쓰기 — 죽은 새 · 쥐 · 벌레마다 효과 하나. 판·훔치기·작업이 하나씩 쓴다.
-- -------------------------------------------------------------
-- 예전 고양이의 보은(같은 것 셋을 합친 품목) 쓰기. 품목과 함께 없앴다.
drop function if exists public.cat_blessing_use(text);

create or replace function public.cat_gift_use(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
  if (p_code = 'dead_bird'  and v_p.cat_boost_left > 0)
  or (p_code = 'dead_mouse' and v_p.cat_steal_boost)
  or (p_code = 'dead_bug'   and v_p.cat_labor_good) then
    raise exception 'CAT_GIFT_ACTIVE';
  end if;

  select * into v_def from public.item_defs where code = p_code;
  perform app.take_one_item(v_uid, p_code);

  update public.profiles
     set cat_boost       = case when p_code = 'dead_bird' then app.cat_bird_stake() else cat_boost end,
         cat_boost_left  = case when p_code = 'dead_bird' then app.cat_bird_plays() else cat_boost_left end,
         cat_steal_boost = cat_steal_boost or p_code = 'dead_mouse',
         cat_labor_good  = cat_labor_good  or p_code = 'dead_bug'
   where id = v_uid;

  perform app.cat_favorite_refresh(v_uid);

  v_p := app.accrue(v_uid);
  perform app.log(v_uid, 'cat', '보은 사용', 0, v_p.coins,
    jsonb_build_object('code', p_code));

  return app.state_json(v_p) || jsonb_build_object('cat_use', jsonb_build_object(
    'code', p_code,
    'name', v_def.name,
    'cat_name', app.cat_name_of(v_uid)
  ));
end;
$$;

-- 이 판에 죽은 새가 얹는 판돈. 남은 판이 있으면 하나 줄이고 액수를 돌려준다.
-- app.bonus_stake(02_schema.sql)가 한 판에 한 번 부른다. 이름은 예전 고양이의
-- 보은 때 것 그대로다 — 02 를 건드리지 않으려고.
create or replace function app.cat_bless_charge(p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
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

-- 이 훔치기에 죽은 쥐가 더하는 성공률. 켜져 있으면 끄고 app.cat_mouse_steal() 을,
-- 아니면 0 을 돌려준다. shop_steal / smuggle_steal(16)이 확률로 뽑을 때만 부른다
-- — 절도비법으로 확정 성공하는 판에서는 쓰지 않고 남겨 둔다.
create or replace function app.cat_steal_bonus(p_uid uuid)
returns numeric
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_on boolean;
begin
  update public.profiles set cat_steal_boost = false
   where id = p_uid and cat_steal_boost
  returning true into v_on;
  return case when v_on then app.cat_mouse_steal() else 0 end;
end;
$$;

-- 이 작업을 죽은 벌레 덕에 후하게 받는가. 켜져 있으면 끄고 true.
-- labor_work / labor_night_work(18)가 보수를 뽑기 직전에 부른다.
create or replace function app.cat_labor_good_take(p_uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_on boolean;
begin
  update public.profiles set cat_labor_good = false
   where id = p_uid and cat_labor_good
  returning true into v_on;
  return coalesce(v_on, false);
end;
$$;


-- -------------------------------------------------------------
-- 8. 테스트 패널 — 시험 계정(app.search_is_tester)만. 탐색 탭에 버튼으로 뜬다.
--      here      오늘 고양이를 곧장 만난 상태로(고양이 자리 + waiting)
--      churu     츄르 3개를 소지품에
--      fish      고등어 · 전갱이 하나씩을 소지품에
--      friend    내 친밀도를 app.cat_friend_need() 로
--      gifts_now 대기 중인 내 보은을 지금 도착으로
--      deads     죽은 새 · 쥐 · 벌레 하나씩을 소지품에(사용 팝업·효과 확인용)
--      reset     내 이름 · 친밀도 · 보은 대기 · 소지품의 보은 아이템 · 켜 둔 보은 효과를
--                지우고 사랑 순위를 다시 센다
-- -------------------------------------------------------------
create or replace function public.cat_test(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
         set cat_boost = 0, cat_boost_left = 0, cat_steal_boost = false, cat_labor_good = false
       where id = v_uid;
      perform app.cat_favorite_refresh(null);
    else
      raise exception 'INVALID_ACTION';
  end case;

  return public.search_board();
end;
$$;


-- -------------------------------------------------------------
-- 9. 권한 — 표에는 정책을 만들지 않는다. 위 RPC 로만 나간다.
-- -------------------------------------------------------------
alter table public.cat_bonds    enable row level security;
alter table public.cat_gifts    enable row level security;
alter table public.cat_favorite enable row level security;

revoke all on function app.cat_place(uuid, date)        from public, anon, authenticated;
revoke all on function app.cat_open(uuid)               from public, anon, authenticated;
revoke all on function app.cat_name_of(uuid)            from public, anon, authenticated;
revoke all on function app.cat_scores()                 from public, anon, authenticated;
revoke all on function app.cat_favorite_refresh(uuid)   from public, anon, authenticated;
revoke all on function app.cat_bless_charge(uuid)       from public, anon, authenticated;
revoke all on function app.cat_steal_bonus(uuid)        from public, anon, authenticated;
revoke all on function app.cat_labor_good_take(uuid)    from public, anon, authenticated;

revoke all on function public.cat_act(text, text)                     from public;
revoke all on function public.cat_set_name(text)                from public;
revoke all on function public.cat_gifts_pending()               from public;
revoke all on function public.cat_gift_resolve(bigint, boolean) from public;
revoke all on function public.cat_gift_toss(text)               from public;
revoke all on function public.cat_gift_use(text)                from public;
revoke all on function public.cat_favorite()                    from public;
revoke all on function public.cat_test(text)                    from public;

grant execute on function public.cat_act(text, text)                     to authenticated;
grant execute on function public.cat_set_name(text)                to authenticated;
grant execute on function public.cat_gifts_pending()               to authenticated;
grant execute on function public.cat_gift_resolve(bigint, boolean) to authenticated;
grant execute on function public.cat_gift_toss(text)               to authenticated;
grant execute on function public.cat_gift_use(text)                to authenticated;
grant execute on function public.cat_favorite()                    to authenticated;
grant execute on function public.cat_test(text)                    to authenticated;

commit;
