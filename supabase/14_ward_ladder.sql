-- 병동 수용 시간을 고정 48시간에서 "다녀온 횟수만큼 늘어나는" 사다리로 바꾸는 패치.
--
--   지금까지는 코인이 넉넉해 체력이 붙은 비싼 식량만 사 먹는 사람은 애초에
--   병동에 갈 일이 없고, 가난해서 싼 것만 사 먹는 사람만 체력이 0에 닿아
--   48시간을 통째로 날렸다. 병동이 사실상 가난에 대한 벌칙으로 작동했다.
--
--   이 패치 이후:
--     · 첫 입원 14시간 -> 18 -> 24 -> 36 -> 48시간으로 늘어나고, 5회째부터 48시간 고정
--     · 퇴원 체력 30 -> 80 (나오자마자 다시 쓰러지는 굴레를 끊는다)
--     · 그 외 조건(15시간 유예, 사흘 이상 부재 시 유예, 병동 중 식사 미지급,
--       진료권류로 시간 단축, 병동 중 행동 차단, 상점 특급 가중)은 전부 그대로
--
--   방문 횟수(ward_visits)는 자정에도, 해독제에도 지워지지 않는다. 기존 유저는
--   전원 0회부터 시작하고, 지금 병동에 갇혀 있는 사람은 이번 수용을 1회차로 쳐서 백필한다.
--
--   (2026-09-29 추가) 퇴원 후 app.ward_reset_hours()(72시간) 동안 다시 입원하지
--   않으면 다음 입원은 첫 칸(14시간)부터 다시 센다. 퇴원 시각은 profiles.ward_left_at
--   에 남는다 — 컬럼과 그걸 찍는 트리거(app.stamp_ward_left)는 02_schema.sql 에 있다.
--
-- 라이브 DB 에는 02_schema.sql 전체를 다시 돌리지 말고 이 파일만 실행한다.
-- (내용은 02_schema.sql 에 이미 반영되어 있다. 적용 후 이 파일은 지워도 된다.)
--
-- 배포 순서: 서버(이 패치)와 클라이언트 어느 쪽이 먼저여도 무관하다.
--   ward_left 값과 화면 문구(체력 30 -> 80)만 바뀐다.
--
-- 롤백: app.ward_hours(integer) 오버로드를 지우고 app.discharge_hp() 를
--   `select 30`으로, app.accrue/app.spend_hp 의 app.ward_hours(v_visits) 호출을
--   app.ward_hours() 로 되돌리면 된다. 이미 배정된 짧은 병동 시간은 되돌릴 수
--   없다(그만큼 일찍 퇴원했을 뿐이다). ward_visits 컬럼은 남겨 두어도 무해하다.

begin;

-- 이번 입원의 수용 시간. p_visits 는 "지금까지 다녀온 횟수"(첫 입원이면 0).
-- 입원할수록 14 -> 18 -> 24 -> 36 -> 48시간으로 늘어나고 48시간에서 멈춘다.
-- 무인자 app.ward_hours() 는 그대로 48을 반환한다(오버로드) — 12_ward_grace.sql
-- 의 백필과 game.ts 의 "ward_cut >= 48 -> 병동 즉시 퇴원" 판정이 계속 유효해야 한다.
create or replace function app.ward_hours(p_visits integer) returns integer
  language sql immutable as $$
    select (array[14, 18, 24, 36, 48])[least(greatest(coalesce(p_visits, 0), 0), 4) + 1]
  $$;

-- 퇴원할 때 회복되는 체력
create or replace function app.discharge_hp() returns integer
  language sql immutable as $$ select 80 $$;

-- 지금까지 병동에 다녀온 횟수. 자정에도 해독제에도 지워지지 않는다.
alter table public.profiles add column if not exists ward_visits integer not null default 0;
alter table public.profiles drop constraint if exists profiles_ward_visits_check;
alter table public.profiles add constraint profiles_ward_visits_check check (ward_visits >= 0);

-- app.accrue 의 본문은 02_schema.sql 이 정본이다. 이 파일은 02 보다 뒤에
-- 실행되므로, 여기에 옛 본문을 그대로 두면 02 가 들고 있는 최신 로직(특선
-- 도시락 슬롯 배급 등)을 덮어써 조용히 되감긴다. 그래서 같은 본문을 둔다.
-- 고칠 때는 02 를 고치고 이 사본을 다시 맞춘다.
create or replace function app.accrue(p_uid uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public, app
as $$
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
  v_drug_plays integer;
  v_decay     integer;
  v_reset     date;
  v_visits    integer;
  v_left      timestamptz;
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
  v_drug_plays := p.drug_plays;
  v_reset     := p.last_reset;
  v_visits    := p.ward_visits;
  v_left      := p.ward_left_at;

  -- 중독(drug_load 는 자정에도 지워지지 않는다)이면 체력이 더 빨리 깎인다.
  -- 미약한 디버프지만 하루 종일 붙어 있다.
  v_decay := app.hp_decay_per_block()
    + case when p.drug_load >= app.drug_addict_threshold()
           then app.addict_hp_penalty() else 0 end;

  -- 날짜가 넘어갔으면 플레이 횟수와 아이템 보너스를 초기화한다.
  -- 코인은 보충하지 않는다. drug_load/drug_bought 는 여기서 건드리지 않는다.
  if v_reset < v_today then
    v_plays      := 0;
    v_bonus      := 0;
    v_drug_plays := 0;
    v_reset      := v_today;
    v_changed    := true;
  end if;

  -- 정지 중에는 체력·식사 시계가 멈춘다 — 두 시계를 지금으로 당겨 둬서 그동안
  -- 체력도 깎이지 않고 도시락도 쌓이지 않는다. 정지가 끝났는데 아직 칸이
  -- 비워지기 전이면(app.require_active 가 지우기 전) 끝난 시각부터 센다.
  -- 병동 시계(ward_until)는 그대로 흐른다.
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

  -- 운영자 페르소나 계정('관리자')은 체력이 소모되지 않고 항상 만땅으로 유지된다.
  if p.username = app.hidden_name() then
    if v_hp <> app.hp_max() or v_ward is not null then
      v_hp      := app.hp_max();
      v_cursor  := v_now;
      v_ward    := null;
      v_changed := true;
    end if;
  else

  -- 병동 <-> 체력 감소가 여러 번 반복될 수 있어(오래 비운 경우) 루프로 처리한다.
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 30;

    if v_ward is not null then
      exit when v_now < v_ward;              -- 아직 병동에 있다
      v_hp        := app.discharge_hp();     -- 퇴원
      v_cursor    := greatest(v_ward, coalesce(v_frozen, v_ward));  -- 정지 중 퇴원이면 정지 끝부터
      v_meal_from := greatest(v_ward, coalesce(v_frozen, v_ward));  -- 병동에 있던 동안의 식사는 없던 일로
      v_left      := v_ward;                 -- 퇴원 시각(사다리 초기화 판정용)
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

    -- 시간이 흘러 체력이 0이 된 경우. 그 시점을 먼저 계산한다.
    v_to_zero   := ceil(v_hp::numeric / v_decay)::int;
    v_zero_at   := greatest(
      v_cursor + make_interval(hours => v_to_zero * app.hp_decay_block_hours()),
      v_cursor
    );

    -- 먹을 것이 있으면 곧바로 병동에 보내지 않고 쓰러지기 직전 상태로 둔다.
    -- (접속하면 화면에서 바로 먹을 기회를 준다)
    --   · 체력 0 도달 후 15시간까지만 이 유예를 준다
    --   · 단, 사흘 넘게 비운 뒤 복귀한 경우는 시간에 관계없이 유예한다
    --     (오랜만에 켠 판을 곧바로 병동으로 시작하게 두지 않는다)
    -- 게임을 해서 0이 된 경우는 app.spend_hp 에서 즉시 병동으로 보낸다.
    if app.has_food(p_uid)
       and (v_now < v_zero_at + interval '15 hours'
            or v_now - p.hp_at >= interval '72 hours') then
      v_hp      := 0;
      v_cursor  := v_now;     -- 더 깎을 것이 없다
      v_changed := true;
      exit;
    end if;

    -- 병동은 유예가 끝난 시점부터 이번 수용 시간을 센다. 유예는 바로 위 분기대로
    -- "먹을 것이 있을 때만" 주어지므로, 식량이 없으면 체력이 0이 된 그 시점부터
    -- 바로 센다. (오래 비웠다고 지금부터 시작하면 부당하게 길어지므로
    -- now() 를 기준으로 삼지는 않는다)
    -- 수용 시간은 지금까지 다녀온 횟수(v_visits)에 따라 14 -> 48시간으로 늘어난다.
    -- 단, 지난 퇴원 뒤 app.ward_reset_hours() 이상 지나서 들어가는 것이면 첫 칸부터.
    v_hp        := 0;
    v_ward      := v_zero_at                 -- 이번 수용이 시작되는 시각
                   + case when app.has_food(p_uid)
                          then interval '15 hours' else interval '0' end;
    if v_left is not null
       and v_ward - v_left >= make_interval(hours => app.ward_reset_hours()) then
      v_visits  := 0;
    end if;
    v_ward      := v_ward + make_interval(hours => app.ward_hours(v_visits));
    -- 남은 시간이 이번 수용 시간을 넘어 보이는 일이 없도록 한 번 더 잠근다.
    v_ward      := least(v_ward, v_now + make_interval(hours => app.ward_hours(v_visits)));
    v_visits    := v_visits + 1;
    v_cursor    := v_zero_at;
    v_meal_from := v_zero_at;
    v_changed   := true;
  end loop;

  end if;

  -- 식사 지급 (병동에 있거나 체력이 0이면 지급하지 않는다)
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

  -- 만료된 소모형 과시 상태를 청소한다. 장착(expires_at is null)은 건드리지 않는다.
  delete from public.player_flex
   where user_id = p_uid and expires_at is not null and expires_at <= v_now;

  if v_changed then
    update public.profiles
       set hp         = v_hp,
           hp_at      = v_cursor,
           ward_until = v_ward,
           ward_visits = v_visits,
           ward_left_at = v_left,
           meals_at   = case when v_ward is null then v_now else v_meal_from end,
           plays_used = v_plays,
           bonus_plays = v_bonus,
           drug_plays  = v_drug_plays,
           last_reset = v_reset
     where id = p_uid
    returning * into p;
  end if;

  -- 추석 송편 쿠폰. 저녁 배급 시각이 지나면 한 장 — 식사와 달리 병동·체력 0 이어도 준다.
  -- item_defs 로 거르므로 17_items.sql 이 품목을 넣기 전이면 조용히 넘어간다.
  if not p.chuseok_coupon
     and v_now >= app.chuseok_coupon_at() and v_now < app.chuseok_end() then
    insert into public.inventories (user_id, item_code, qty)
    select p_uid, d.code, 1 from public.item_defs d where d.code = 'songpyeon_coupon'
    on conflict (user_id, item_code) do update set qty = inventories.qty + 1;
    if found then
      update public.profiles set chuseok_coupon = true where id = p_uid
      returning * into p;
    end if;
  end if;

  return p;
end;
$$;

create or replace function app.spend_hp(p_uid uuid, p_amount integer)
returns public.profiles
language plpgsql
security definer
set search_path = public, app
as $$
declare
  p        public.profiles;
  v_hp     integer;
  v_visits integer;
begin
  select * into p from public.profiles where id = p_uid for update;

  -- 운영자 페르소나 계정('관리자')은 체력을 소모하지 않는다.
  if p.username = app.hidden_name() then
    return p;
  end if;

  v_hp := greatest(0, p.hp - p_amount);

  -- 지난 퇴원 뒤 app.ward_reset_hours() 이상 지났으면 사다리 첫 칸부터 센다.
  v_visits := case when p.ward_left_at is not null
                    and now() - p.ward_left_at >= make_interval(hours => app.ward_reset_hours())
                   then 0 else p.ward_visits end;

  update public.profiles
     set hp = v_hp,
         ward_until = case when v_hp = 0 and p.ward_until is null
                           then now() + make_interval(hours => app.ward_hours(v_visits))
                           else ward_until end,
         ward_visits = case when v_hp = 0 and p.ward_until is null
                            then v_visits + 1 else ward_visits end,
         hp_at = case when v_hp = 0 then now() else hp_at end,
         meals_at = case when v_hp = 0 then now() else meals_at end
   where id = p_uid
  returning * into p;

  return p;
end;
$$;

-- 사다리를 처음 켤 때 "지금 병동에 갇혀 있는 사람"을 1회차로 맞춰 주던 일회성
-- 마이그레이션이 여기 top-level 에 있었다. 이미 라이브에 적용됐는데도 이 파일을
-- 다시 돌릴 때마다 또 돌아서, 그때 병동에 있던 사람의 남은 시간을 매번 14시간
-- 이하로 깎았다(5회차 48시간짜리가 갓 들어갔어도 34시간이 공짜로 사라졌다).
-- 마이그레이션은 스키마가 아니므로 repair/2026-09-20_ward_ladder_backfill.sql 로
-- 옮겼다 — 새로 설치할 때는 병동에 있는 사람 자체가 없으니 돌릴 일이 없다.

commit;
