-- 병동에 있는 동안 남은 시간이 48시간(app.ward_hours())을 넘겨 표시되던 버그를
-- 고치는 패치. 원인은 app.accrue() 의 병동 이송 분기다.
--
--   먹을 것이 있으면 체력이 0이 되어도 곧바로 병동에 보내지 않고 15시간까지
--   유예를 준다. 그런데 실제로 병동에 보낼 때에는 그 15시간을 조건 없이 더해
--   ward_until = (체력 0 시점) + 15시간 + 48시간 = 63시간 이 되었다.
--   식량이 없어 유예를 받지 못한 사람도 63시간짜리 타이머를 받았고, 체력이
--   0이 된 지 5시간 뒤에 접속하면 화면에 "58시간 남음"이 떴다.
--
--   유예는 먹을 것이 있을 때만 주어지므로 15시간도 그때만 더한다. 덤으로
--   남은 시간이 48시간을 넘지 못하도록 least() 로 한 번 더 잠갔다.
--
-- 이미 63시간짜리로 걸려 있는 사람들은 아래 update 로 48시간 이내로 깎는다.
-- (48시간을 깎는 '퇴원서'가 63시간짜리에는 통하지 않던 문제도 함께 풀린다)
--
-- 라이브 DB 에는 02_schema.sql 전체를 다시 돌리지 말고 이 파일만 실행한다.
-- (내용은 02_schema.sql 에 이미 반영되어 있다. 적용 후 이 파일은 지워도 된다.)
--
-- 배포 순서: 서버(이 패치)와 클라이언트 어느 쪽이 먼저여도 무관하다.
--   내려주는 필드가 바뀌지 않고 ward_left 값만 줄어든다.
--
-- 롤백: v_ward 계산을 예전처럼
--   v_ward := v_zero_at + interval '15 hours' + make_interval(hours => app.ward_hours());
--   한 줄로 되돌려 app.accrue 를 다시 create or replace 하면 된다.
--   이미 깎인 ward_until 은 되돌릴 수 없다(그만큼 일찍 퇴원할 뿐이다).

begin;

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

-- 잘못 계산돼 48시간을 넘겨 걸려 있는 병동 타이머를 48시간으로 깎는다.
update public.profiles
   set ward_until = now() + make_interval(hours => app.ward_hours())
 where ward_until is not null
   and ward_until > now() + make_interval(hours => app.ward_hours());

commit;
