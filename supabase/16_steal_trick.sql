-- =============================================================
--  MINI CASINO - 훔치기 확률·벌칙 조정 + 훔친 문구 + 절도비법
--
--  이 파일은 15_steal.sql(배급소·밀거래 훔치기) 위에 얹는다. 아직 그
--  패치를 안 돌렸다면 이 파일보다 먼저 15_steal.sql 을 실행한다.
--
--  바뀌는 것 네 가지
--    1) 밀거래 훔치기 확률 상향. 배급소는 그대로 둔다(이미 넉넉하다).
--       기본 3%/0.5% -> 8%/2%, 가액 상한 100/10/5% -> 100/12/8%(밀거래 전용
--       app.smuggle_value_cap 을 새로 둔다 — 기존 app.steal_value_cap 은
--       배급소 것이라 손대지 않는다).
--    2) 밀거래 실패 벌칙 하향. 물건값을 치를 수 있었던 경우 전액 -> 50%,
--       절반만 있던 경우 50% -> 25%. 판정 기준선(가액/그 절반)은 그대로다.
--    3) 훔친 착용형(wear) 물건을 장착하면 "훔친 …" 문구가 뜬다. 문구는
--       item_defs.flex_text_stolen(16종) — 값은 17_items.sql 이 채운다.
--       인벤토리에 stolen_qty 를 새로 두어 "훔친 채 아직 안 쓴 몫"을 센다.
--    4) 절도비법(steal_trick) 신설 — 밀거래 특별 상품(app.roll_special 전용
--       분기, 12%)과 탐색 수용동의 전설 등급(19_search.sql, 0.6%)에서 나온다.
--       250코인, 되팔기 불가. 라이터·반지처럼 장착형(flex_kind='wear')이라
--       소지품에서 장착해 두면(flex_equip)
--       profiles.steal_sure 가 켜진다 — 물건 자체는 소모되지 않고 인벤에
--       그대로 남는다. 다음 shop_steal/smuggle_steal 한 번이 확정
--       성공으로 실제로 터지는 그 순간에야 app.consume_steal_trick() 이
--       인벤에서 1개를 빼고 장착도 함께 푼다. 터지기 전에 해제
--       (flex_unequip)하면 steal_sure 도 그 자리에서 같이 꺼진다 — 장착
--       중일 때만 효과가 유지된다는 뜻이고, 해제로 잠금을 풀어 물건을
--       넘기고도 확정 성공만 챙기는 구멍을 막는다. 이 패치 이전에
--       use_item 으로 이미 읽어 두어 profiles.steal_sure 만 켜져 있는
--       구버전 유저는 그대로 존중한다 — app.consume_steal_trick() 은
--       "수량"이 아니라 "장착분"을 보고 깎으므로, 장착한 적 없는 유저에게서는
--       아무것도 가져가지 않는다(그 사람이 새로 사 둔 종이까지 빼앗기던
--       버그를 2026-09-20 에 고쳤다).
--
--  안전성
--    · alter table ... add column if not exists / create or replace 뿐이라
--      몇 번을 다시 돌려도 안전하다(멱등).
--    · stolen_qty 컬럼은 기존 gifted_qty 와 완전히 같은 모양(0 이상, qty
--      이하)이고, qty 를 줄이는 기존 경로(app.take_one_item, sell_item,
--      app.move_items)에 전부 같이 잘라 주는 코드를 넣었다 — 안 그러면
--      "훔친 식량을 먹었더니 체크 제약 위반" 같은 게 난다.
--    · public.smuggle_state() / public.shop_steal() / public.use_item() /
--      public.flex_equip() / public.sell_item() / app.take_one_item() /
--      app.state_json() / app.move_items() / public.inmate_roster() 를 본문
--      그대로 다시 만든다 — 각각 05_smuggle.sql / 02_schema.sql / 04_trade.sql /
--      06_relations.sql 의 정본과 글자까지 같다(APPLY.md "남은 중복" 표).
--    · public.smuggle_steal() 과 app.consume_steal_trick() 은 이 파일에만 있다.
--      그래서 smuggle_steal 의 권한도 이 파일 끝에서 건다.
--
--  배포 순서: 이 SQL 먼저 -> 17_items.sql 다시 실행(절도비법 아이템 자체와
--  훔친 문구 16종의 실제 문장이 17_items.sql 쪽에 있다 — 이 파일이 먼저
--  컬럼과 kind='trick' 을 다룰 기반을 만들어 둬야 17_items.sql 이 값을
--  채울 수 있다) -> 클라이언트.
--
--  롤백: 이 파일이 새로 만든 컬럼(steal_sure ×2, flex_text_stolen,
--  stolen_qty, player_flex.stolen)을 남겨 둬도 무해하다. 확률·벌칙을 되돌리려면
--  이 파일의 app.smuggle_steal_base / app.smuggle_value_cap 값을 고쳐 다시
--  돌린다 — 15_steal.sql 에 있던 옛 본문은 2026-09-20 에 지웠다.
--
--  ★ app.state_json() · public.use_item() · public.flex_equip() ·
--    public.shop_steal() · public.smuggle_steal() 의 최신판은 이 파일이다.
--
--    예전에는 05_smuggle.sql · 10_extra_plays.sql · 11_item_uses.sql ·
--    15_steal.sql 이 같은 함수들의 옛 본문을 함께 들고 있었다. 번호 순서대로
--    전부 돌리면 이 파일이 마지막이라 결과는 맞았지만, APPLY.md 가 권하는
--    "바뀐 파일만 떼어 다시 돌린다" 를 그 파일들에 하는 순간
--    steal_sure·훔친 문구·stolen_qty·절도비법 장착형 전환이 조용히 되감겼다.
--    2026-09-20 에 그 낡은 사본 여덟을 지우고 자리마다 "정본은 어느 파일"
--    이라는 주석만 남겼다 — 이제는 어느 파일을 단독으로 돌려도 되감기지 않는다.
--
--    다만 02_schema.sql 은 여전히 같은 본문의 사본을 들고 있다(10~16 의
--    최종본을 함께 담은 합본이라 그렇다). 02 는 맨 앞에서 돌아 되감기지
--    않지만, 이 함수들을 고칠 때는 02 쪽도 반드시 같이 맞춘다
--    (APPLY.md "남은 중복" 표가 지도다). 앞으로 이 함수들을 또 고칠 패치가
--    생기면, 그 패치가 이 파일 다음의 새 "최신판"이 되고 이 문단과 같은
--    안내를 그쪽에 옮겨 적어야 한다.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. 컬럼
-- -------------------------------------------------------------

-- 절도비법을 장착해 두었는지. true 면 다음 shop_steal/smuggle_steal 한 번이
-- 확정 성공하고, 그 자리에서 다시 false 로 꺼진다(해제하면 터지기 전에도
-- 곧장 false 로 꺼진다 — flex_unequip 참고).
alter table public.profiles add column if not exists steal_sure boolean not null default false;

-- 절도비법(steal_trick) 표식. flex_equip 으로 장착해 두면 profiles.steal_sure
-- 가 켜진다. 값은 17_items.sql 이 steal_trick 한 종에만 true 로 채운다.
alter table public.item_defs add column if not exists steal_sure boolean not null default false;

-- 훔친 물건일 때 쓰는 문장. wear(착용형) 16종에만 값이 있고(17_items.sql
-- 이 채운다), 나머지는 null — 읽는 쪽이 coalesce(flex_text_stolen, flex_text)
-- 로 비어 있으면 평소 문장으로 되돌린다.
alter table public.item_defs add column if not exists flex_text_stolen text;

-- 훔쳐서 얻어 아직 쓰지 않은 수량. gifted_qty 와 같은 방식으로, 장착
-- (flex_equip)할 때 이 몫이 있으면 "훔친 …" 문구를 고른다 — 선물(gifted_qty)
-- 보다도 우선한다. 훔친 걸 남에게 넘겨도 받는 쪽은 gifted_qty 만 올라간다.
alter table public.inventories add column if not exists stolen_qty integer not null default 0;
alter table public.inventories drop constraint if exists inventories_stolen_check;
alter table public.inventories add constraint inventories_stolen_check
  check (stolen_qty >= 0 and stolen_qty <= qty);

-- 훔친 개체를 장착했는지. gifted 보다 우선한다 — flex_equip 이 함께 정한다.
alter table public.player_flex add column if not exists stolen boolean not null default false;

-- 절도비법이 특별 상품 칸에 뜰 수 있게 special_kind 제약을 넓힌다.
alter table public.smuggle_offers drop constraint if exists smuggle_offers_special_kind_check;
alter table public.smuggle_offers add constraint smuggle_offers_special_kind_check
  check (special_kind in ('grade', 'sale', 'trick'));


-- -------------------------------------------------------------
-- 2. 확률·상한·벌칙
-- -------------------------------------------------------------

-- 밀거래 기본 성공률 상향(3%/0.5% -> 8%/2%). 배급소(app.shop_steal_base)는
-- 그대로 둔다.
create or replace function app.smuggle_steal_base(p_coins integer) returns numeric
  language sql immutable as $$
    select case when coalesce(p_coins, 0) < 10 then 0.08 else 0.02 end
  $$;

-- 밀거래 전용 가액 상한. 02_schema.sql 의 app.steal_value_cap 은 배급소 것이라
-- 그대로 둔다 — 같이 올리면 퇴원서·해독제의 배급소 성공률까지 덩달아 오른다.
create or replace function app.smuggle_value_cap(p_price integer) returns numeric
  language sql immutable as $$
    select case
             when coalesce(p_price, 0) <= 100 then 1.00
             when coalesce(p_price, 0) <= 200 then 0.12
             else 0.08
           end
  $$;


-- -------------------------------------------------------------
-- 3. app.take_one_item — stolen_qty 도 qty 를 따라 잘린다
-- -------------------------------------------------------------
create or replace function app.take_one_item(p_uid uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_qty        integer;
  v_gifted_qty integer;
  v_gifted     boolean;
begin
  select qty, gifted_qty into v_qty, v_gifted_qty
    from public.inventories
   where user_id = p_uid and item_code = p_code for update;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  v_gifted := coalesce(v_gifted_qty, 0) > 0;

  -- stolen_qty 는 "훔친 채 아직 안 쓴 몫"일 뿐 — 여기서 훔친 걸 우선 소모하는
  -- 규칙은 없다(그건 gifted_qty 몫이다). qty 가 줄어드는 만큼만 잘라
  -- inventories_stolen_check(stolen_qty <= qty)가 깨지지 않게 한다.
  update public.inventories
     set qty = qty - 1,
         gifted_qty = gifted_qty - (case when v_gifted then 1 else 0 end),
         stolen_qty = least(stolen_qty, qty - 1)
   where user_id = p_uid and item_code = p_code;

  return v_gifted;
end;
$$;


-- -------------------------------------------------------------
-- 4. app.state_json — steal_sure, 인벤 항목의 steal_sure, 훔친 과시 문구
-- -------------------------------------------------------------
create or replace function app.state_json(p public.profiles)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'username',     p.username,
    'avatar_path',  p.avatar_path,
    'coins',        p.coins,
    'plays_used',   p.plays_used,
    'plays_left',   greatest(0, app.daily_play_limit() + p.bonus_plays + p.drug_plays
                                + app.chuseok_plays(p.chuseok_grade) - p.plays_used),
    'play_limit',   app.daily_play_limit() + p.bonus_plays + p.drug_plays
                    + app.chuseok_plays(p.chuseok_grade),
    'bonus_plays',  p.bonus_plays,
    'bonus_max',    app.max_bonus_plays(),
    'bonus_left',   least(greatest(0, app.max_bonus_plays() - p.bonus_plays),
                          greatest(0, app.max_extra_plays() - p.bonus_plays - p.drug_plays)),
    'drug_plays',   p.drug_plays,
    'drug_max',     app.max_drug_plays(),
    'drug_left',    least(greatest(0, app.max_drug_plays() - p.drug_plays),
                          greatest(0, app.max_extra_plays() - p.bonus_plays - p.drug_plays)),
    'extra_plays',  p.bonus_plays + p.drug_plays,
    'extra_max',    app.max_extra_plays(),
    'extra_left',   greatest(0, app.max_extra_plays() - p.bonus_plays - p.drug_plays),
    'addicted',     (p.drug_load >= app.drug_addict_threshold()),
    'addict_lines', app.addict_lines(p),
    'win_double',   p.win_double,
    'hl_card',      p.hl_card,
    'hl_stage',     p.hl_stage,
    'hl_bet',       p.hl_bet,
    'hl_pot',       p.hl_pot,
    'hl_steps',     p.hl_steps,
    'hl_max_stage', app.hl_max_stage(),
    'debt',         p.debt,
    'is_admin',     p.is_admin,
    'hidden',       p.hidden,
    'pvp_min_bet',  app.pvp_min_bet(),
    'play_wage',    app.play_wage(p.coins),
    'hp',           p.hp,
    'hp_max',       app.hp_max(),
    'hp_status',    app.hp_status(p.hp),
    'in_ward',      (p.ward_until is not null),
    'ward_left',    case when p.ward_until is null then 0
                         else greatest(0, extract(epoch from (p.ward_until - now()))::int) end,
    'suspended',        (p.suspended_until is not null and p.suspended_until > now()),
    'suspended_until',  p.suspended_until,
    'suspended_left',   case when p.suspended_until is null then 0
                              else greatest(0, extract(epoch from (p.suspended_until - now()))::int) end,
    'suspend_reason',   p.suspend_reason,
    'steal_sure',   p.steal_sure,
    'cell_id',      p.cell_id,
    'cell',         (select app.cell_label(c.block, c.room)
                       from public.cells c where c.id = p.cell_id),
    'crime',        p.crime,
    'age',          p.age,
    'height_cm',    p.height_cm,
    'weight_kg',    p.weight_kg,
    'bio',          p.bio,
    'livestock_consent', p.livestock_consent,
    'livestock_lock_left', case when p.livestock_used_at is null then 0
                                 else greatest(0, extract(epoch from
                                   (p.livestock_used_at + make_interval(days => app.livestock_consent_lock_days()) - now()))::int)
                            end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', d.code, 'name', d.name, 'kind', d.kind, 'grade', d.grade,
               'emoji', d.emoji, 'heal', d.heal, 'plays', d.plays,
               'ward_cut', d.ward_cut, 'win_double', d.win_double,
               'description', d.description,
               'buy_price', d.buy_price, 'sell_price', d.sell_price,
               'tradable', d.tradable, 'qty', i.qty,
               'flex_kind', d.flex_kind, 'flex_hours', d.flex_hours,
               'detox', d.detox, 'uses', d.uses, 'open_left', i.open_left,
               'steal_sure', d.steal_sure,
               'shareable', (d.flex_text_with is not null)
             ) order by d.sort_order, d.code)
        from public.inventories i
        join public.item_defs d on d.code = i.item_code
       -- qty=0 인데 개봉한 갑의 개비만 남은 경우(open_left > 0)도 계속 보여야
       -- 마지막 갑까지 다 피울 수 있다.
       where i.user_id = p.id and (i.qty > 0 or i.open_left > 0)), '[]'::jsonb),
    -- 본인에게만 보이는 과시 상태. 남은 시간(expires_at)은 여기서만 나간다 —
    -- inmate_roster() 는 같은 행에서 문장만 뽑아 남에게 보여준다.
    'flex', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', d.code, 'name', d.name, 'emoji', d.emoji,
               'kind', d.kind, 'grade', d.grade, 'flex_kind', d.flex_kind,
               -- {giver} 자리는 선물받아 장착했으면 준 사람, 아니면 본인 이름(app.flex_render).
               'text', app.flex_render(
                         case when f.together then coalesce(d.flex_text_with, d.flex_text)
                              when f.stolen then coalesce(d.flex_text_stolen, d.flex_text)
                              when f.gifted then d.flex_text_gift
                              else d.flex_text end,
                         case when f.gifted and not f.stolen and not f.together
                              then (select g.username from public.profiles g where g.id = f.gift_from)
                              else p.username end),
               'gifted', f.gifted, 'stolen', f.stolen, 'together', f.together, 'expires_at', f.expires_at
             ) order by f.started_at)
        from public.player_flex f
        join public.item_defs d on d.code = f.item_code
        -- 겹쳐 장착한 것은 그 수만큼 같은 줄을 낸다.
        cross join generate_series(1, f.stack)
       where f.user_id = p.id), '[]'::jsonb)
  )
  -- jsonb_build_object 는 인자를 100개까지만 받는다(위 객체가 이미 한도 가까이 찼다).
  -- 새 키는 여기 두 번째 객체에 붙인다.
  || jsonb_build_object(
    'hl_bonus',     p.hl_bonus,
    'wear_limit',   app.flex_wear_limit(),
    'withdrawal',   app.in_withdrawal(p),
    -- 추석 송편. 먹은 적이 없거나 이벤트가 끝났으면 null.
    'chuseok',      case when p.chuseok_grade is not null and now() < app.chuseok_end() then
                      jsonb_build_object(
                        'grade',   p.chuseok_grade,
                        'plays',   app.chuseok_plays(p.chuseok_grade),
                        'stake',   app.chuseok_stake(p.chuseok_grade),
                        'uses',    app.chuseok_uses(p.chuseok_grade),
                        'left',    app.chuseok_left(p.chuseok_grade, p.chuseok_day, p.chuseok_used),
                        'ends_at', app.chuseok_end())
                    end,
    -- 네잎클로버. 켜져 있지 않으면 null.
    'luck',         case when p.stake_boost_until > now() then
                      jsonb_build_object('stake', p.stake_boost, 'ends_at', p.stake_boost_until)
                    end
  );
$$;


-- -------------------------------------------------------------
-- 5. public.use_item — 절도비법은 이제 여기서 다루지 않는다(flex_equip 로 이동)
-- -------------------------------------------------------------
create or replace function public.use_item(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_def    public.item_defs;
  v_gained integer;
  v_headroom integer;
  v_ward   timestamptz;
  v_gifted boolean;
  v_hp_before integer;
  v_hp_lost  integer := 0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  -- 절도비법(steal_sure)은 이제 use_item 이 아니라 flex_equip/flex_unequip
  -- 으로 장착·해제한다 — 다른 장착형(라이터·반지 등)과 같은 취급이라,
  -- use_item 으로 부르면 heal/plays/ward_cut/win_double/detox 가 전부
  -- 0/false 인 이 아이템은 아래 조건에 걸려 그대로 NOT_USABLE 이 난다.
  if v_def.heal <= 0 and v_def.plays <= 0 and v_def.ward_cut <= 0
     and v_def.win_double <= 0 and not v_def.detox and v_def.stake_bonus <= 0
     -- RP 전용 약물(헤로인 등)은 게임 효과가 없어도 쓴다 — drug_load 와 특이사항이 효과다.
     and not (v_def.kind = 'drug' and v_def.drug_dose > 0) then
    raise exception 'NOT_USABLE';
  end if;

  if v_def.detox and v_p.drug_load < app.drug_addict_threshold() then
    raise exception 'NOT_ADDICTED';
  end if;

  if v_def.ward_cut > 0 then
    -- 병동을 줄이는 물건은 병동에 있을 때만 쓸 수 있다.
    if v_p.ward_until is null then raise exception 'NOT_IN_WARD'; end if;
  else
    -- 나머지는 병동에서 쓸 수 없다. 수용 시간을 다 채워야 나온다.
    if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;
  end if;

  -- 네잎클로버는 한 번에 하나 — 켜진 동안 또 쓰면 막는다(겹쳐 얹히지 않는다).
  if v_def.stake_bonus > 0 and v_p.stake_boost_until > now() then
    raise exception 'LUCK_ACTIVE';
  end if;

  -- 사용 전 체력. 화면 팝업이 "체력 이전 → 이후" 를 그린다.
  v_hp_before := v_p.hp;
  v_gifted := app.take_one_item(v_uid, p_code);

  -- 게임 횟수는 갈래별 하루 상한과 하루 총량(max_extra_plays) 중 작은 쪽까지만
  -- 채워진다. 식량·의약품은 max_bonus_plays, 약물은 별개인 max_drug_plays 가
  -- 하위 상한이고, 총량은 둘이 공유한다. 남는 분은 버려진다.
  v_headroom := greatest(0, app.max_extra_plays() - v_p.bonus_plays - v_p.drug_plays);
  if v_def.kind = 'drug' then
    v_gained := least(v_def.plays,
                      greatest(0, app.max_drug_plays() - v_p.drug_plays),
                      v_headroom);
  else
    v_gained := least(v_def.plays,
                      greatest(0, app.max_bonus_plays() - v_p.bonus_plays),
                      v_headroom);
  end if;

  if v_def.ward_cut > 0 then
    v_ward := v_p.ward_until - make_interval(hours => v_def.ward_cut);

    if v_ward <= now() then
      -- 남은 시간을 다 깎았으면 그 자리에서 퇴원한다.
      update public.profiles
         set ward_until = null,
             hp = greatest(hp, app.discharge_hp()),
             hp_at = now(),
             meals_at = now()
       where id = v_uid
      returning * into v_p;
    else
      update public.profiles set ward_until = v_ward
       where id = v_uid
      returning * into v_p;
    end if;
  else
    update public.profiles
       set hp = least(app.hp_max(), hp + v_def.heal),
           bonus_plays = bonus_plays + (case when v_def.kind = 'drug' then 0 else v_gained end),
           drug_plays  = drug_plays  + (case when v_def.kind = 'drug' then v_gained else 0 end),
           win_double  = win_double + v_def.win_double,
           -- 네잎클로버: flex_hours 동안 판돈 추가(app.bonus_stake 가 시각으로 끈다).
           stake_boost       = case when v_def.stake_bonus > 0 then v_def.stake_bonus
                                    else stake_boost end,
           stake_boost_until = case when v_def.stake_bonus > 0
                                    then now() + make_interval(hours => v_def.flex_hours)
                                    else stake_boost_until end,
           -- 해독제는 drug_load 만 지운다. 가격 누진 장부(drug_purchases)는 그대로 남는다.
           drug_load   = case when v_def.detox then 0
                              else drug_load
                                   + (case when v_def.kind = 'drug' then v_def.drug_dose else 0 end)
                              end,
           -- 마지막 투약. 중독 문구(app.addict_lines)와 금단 판정(app.in_withdrawal)이 읽는다.
           drug_last    = case when v_def.kind = 'drug' then p_code else drug_last end,
           drug_used_at = case when v_def.kind = 'drug' then now() else drug_used_at end,
           -- 이번 사이클에 쓴 약물(중독 문구가 약물마다 한 줄). 해독제가 비운다.
           drug_used_codes = case when v_def.detox then '{}'::text[]
                                  when v_def.kind = 'drug' and not (p_code = any(drug_used_codes))
                                    then drug_used_codes || p_code
                                  else drug_used_codes end
     where id = v_uid
    returning * into v_p;
  end if;

  -- 약물은 게임 효과와 별개로 "남에게 보이는 상태"도 함께 켠다.
  if v_def.flex_kind = 'consume' then
    perform app.flex_apply(v_uid, p_code, v_gifted);
  end if;

  -- 네잎클로버의 특이사항 한 줄. flex_kind 가 null 이라 flex_apply 의 동시 칸
  -- 밀어내기에 끼지 않도록 직접 넣는다(use_songpyeon 과 같은 방식). 효과와 같은
  -- 시각에 만료되고, app.accrue 가 치운다.
  if v_def.stake_bonus > 0 then
    insert into public.player_flex (user_id, item_code, gifted, expires_at, started_at)
    values (v_uid, p_code, v_gifted, v_p.stake_boost_until, now())
    on conflict (user_id, item_code) do update
       set gifted = excluded.gifted, expires_at = excluded.expires_at,
           started_at = excluded.started_at;
  end if;

  -- 부작용. overdose_pct 확률로 체력 1~5 를 잃는다. 병동에는 보내지 않는다 —
  -- 체력 1 은 남긴다(그래서 1 인 채로 쓰면 잃을 것이 없다). 관리자는 건너뛴다.
  if v_def.overdose_pct > 0 and random() < v_def.overdose_pct
     and v_p.username <> app.hidden_name() then
    v_hp_lost := least(1 + floor(random() * 5)::int, greatest(0, v_p.hp - 1));
    if v_hp_lost > 0 then
      update public.profiles set hp = hp - v_hp_lost
       where id = v_uid
      returning * into v_p;
    end if;
  end if;

  return app.state_json(v_p) || jsonb_build_object('plays_gained', v_gained,
                                                   'hp_before', v_hp_before,
                                                   'hp_lost', v_hp_lost);
end;
$$;


-- -------------------------------------------------------------
-- 5b. app.consume_steal_trick — 확정 성공이 실제로 터질 때만 호출된다
-- -------------------------------------------------------------
create or replace function app.consume_steal_trick(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  -- 소모되는 것은 "이 확정 성공을 켠 바로 그 장착분" 하나뿐이다. 그래서 수량이
  -- 아니라 장착 여부로 판정한다 — 구버전(use_item 으로 미리 읽어 소모하던 시절)
  -- 에서 넘어온 유저는 그때 이미 종이가 없어졌는데 profiles.steal_sure 만 켜져
  -- 있다. 그 사람이 절도비법을 새로 하나 사 두면(ALREADY_ARMED 라 장착은 못 하고
  -- 인벤에만 남는다) 수량으로 판정할 경우 장착도 안 한 그 새 종이를 대신 빼앗긴다.
  -- 장착분이 없으면 아무것도 깎지 않고 조용히 넘어간다.
  delete from public.player_flex
   where user_id = p_uid and item_code = 'steal_trick' and expires_at is null;

  -- FOUND 는 바로 위 delete 가 한 행이라도 지웠는지를 말해 준다.
  if found then
    perform app.take_one_item(p_uid, 'steal_trick');
  end if;
end;
$$;

revoke all on function app.consume_steal_trick(uuid) from public, anon, authenticated;


-- -------------------------------------------------------------
-- 6. public.flex_equip — 훔친 몫 우선으로 문구를 고른다 + 절도비법 발동
-- -------------------------------------------------------------
create or replace function public.flex_equip(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid        uuid := auth.uid();
  v_p          public.profiles;
  v_def        public.item_defs;
  v_qty        integer;
  v_gifted_qty integer;
  v_stolen_qty integer;
  v_gift_from  uuid;
  v_count      integer;
  v_stack      integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.flex_kind is distinct from 'wear' then raise exception 'NOT_FLEX'; end if;

  select qty, gifted_qty, stolen_qty, gift_from
    into v_qty, v_gifted_qty, v_stolen_qty, v_gift_from
    from public.inventories
   where user_id = v_uid and item_code = p_code for update;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 같은 물건도 가진 수량까지 겹쳐 장착할 수 있다(player_flex.stack).
  -- 이미 가진 만큼 다 장착했으면 더 낄 것이 없다.
  select stack into v_stack from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at is null;
  if coalesce(v_stack, 0) >= v_qty then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 겹쳐 장착한 것도 그 수만큼 칸을 차지한다.
  select coalesce(sum(f.stack), 0) into v_count from public.player_flex f
    join public.item_defs d on d.code = f.item_code
   where f.user_id = v_uid and d.flex_kind = 'wear';
  if v_count >= app.flex_wear_limit() then raise exception 'FLEX_LIMIT'; end if;

  -- 절도비법은 이미 새겨 둔 요령이 있으면(구버전에서 넘어온 확정 성공이거나,
  -- 이 함수가 방금 켠 게 아직 안 터진 경우) 또 걸어 봐야 소용없다 — 겹쳐
  -- 장착해도 확정 성공은 한 번뿐이라 여기서 막는다.
  if v_def.steal_sure and v_p.steal_sure then raise exception 'ALREADY_ARMED'; end if;

  if v_stack is not null then
    -- 문구(훔친/받은)는 처음 장착할 때 정한 것을 그대로 쓴다.
    update public.player_flex set stack = stack + 1
     where user_id = v_uid and item_code = p_code and expires_at is null;
  else
    -- 훔친 몫이 있으면 "훔친 …" 문구를, 없고 선물 받은 몫만 있으면 "받은 …"
    -- 문구를 고른다 — 둘 다 있으면 훔친 쪽이 우선한다. "받은 …" 을 고르면
    -- 준 사람(gift_from)도 함께 옮겨 문구의 {giver} 자리에 쓴다.
    insert into public.player_flex (user_id, item_code, gifted, stolen, gift_from, expires_at, started_at)
    values (v_uid, p_code,
            coalesce(v_stolen_qty, 0) = 0 and coalesce(v_gifted_qty, 0) > 0,
            coalesce(v_stolen_qty, 0) > 0,
            case when coalesce(v_stolen_qty, 0) = 0 and coalesce(v_gifted_qty, 0) > 0
                 then v_gift_from end,
            null, now());
  end if;

  -- 절도비법은 장착하는 순간 다음 훔치기 한 번이 확정 성공으로 켜진다.
  -- 물건 자체는 소모되지 않는다 — 그 훔치기가 실제로 터질 때(shop_steal/
  -- smuggle_steal 안의 app.consume_steal_trick)가 되어서야 인벤에서 1개가
  -- 빠지고 이 장착도 함께 풀린다.
  if v_def.steal_sure then
    update public.profiles set steal_sure = true where id = v_uid;
  end if;

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;


-- -------------------------------------------------------------
-- 7. public.sell_item — stolen_qty 도 qty 를 따라 잘린다
-- -------------------------------------------------------------
create or replace function public.sell_item(p_code text, p_qty integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_def    public.item_defs;
  v_qty    integer;
  v_locked integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_qty is null or p_qty < 1 then raise exception 'INVALID_QTY'; end if;

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.sell_price is null then raise exception 'NOT_SELLABLE'; end if;

  select qty into v_qty from public.inventories
   where user_id = v_uid and item_code = p_code for update;
  if coalesce(v_qty, 0) < p_qty then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 장착 중인 몫(겹쳐 장착한 수 전부)은 팔 수 없다(해제 후 다시 시도).
  select coalesce(sum(stack), 0) into v_locked from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at is null;
  if v_qty - v_locked < p_qty then raise exception 'EQUIPPED_LOCKED'; end if;

  update public.inventories
     set qty = qty - p_qty,
         gifted_qty = least(gifted_qty, qty - p_qty),
         stolen_qty = least(stolen_qty, qty - p_qty)
   where user_id = v_uid and item_code = p_code;

  update public.profiles set coins = coins + v_def.sell_price * p_qty
   where id = v_uid
  returning * into v_p;

  perform app.log(v_uid, 'shop',
    format('%s %s개 판매', v_def.name, p_qty),
    v_def.sell_price * p_qty, v_p.coins,
    jsonb_build_object('code', p_code, 'qty', p_qty));

  return app.state_json(v_p);
end;
$$;


-- -------------------------------------------------------------
-- 8. public.shop_steal — 절도비법 확정 성공, stolen_qty 기록
-- -------------------------------------------------------------
create or replace function public.shop_steal(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_def   public.item_defs;
  v_offer public.shop_offers;
  v_had   integer;
  v_ok    boolean;
  v_pen   jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  -- 병동에서는 체력이 이미 0이라 벌칙의 절반이 공짜가 된다. 아예 막는다.
  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.buy_price is null then raise exception 'NOT_BUYABLE'; end if;

  -- 오퍼 행이 있는지 먼저 보장한 뒤 잠근다 — 동시 호출로 시도권이 겹쳐 쓰이지 않게.
  perform app.shop_today(v_uid);
  select * into v_offer from public.shop_offers
   where user_id = v_uid and day = app.today_kst() for update;

  if v_offer.steal_used then raise exception 'STEAL_USED'; end if;
  if not (p_code = any(v_offer.codes)) then raise exception 'NOT_IN_SHOP'; end if;

  -- 훔친 것도 오늘 산 것으로 센다. 품절이면 훔칠 것도 없다.
  v_had := coalesce((v_offer.bought->>p_code)::int, 0);
  if v_had >= app.shop_item_cap(p_code) then raise exception 'DAILY_ITEM_CAP'; end if;

  -- 여기서부터는 되돌릴 수 없다. 성공하든 실패하든 오늘 몫은 소모된다.
  -- 절도비법(steal_sure)을 미리 장착해 뒀으면 확률과 무관하게 성공하고,
  -- 그 자리에서 플래그가 꺼지며 장착해 둔 물건도 함께 소모된다(또는 구버전
  -- 유저처럼 인벤에 이미 없으면 조용히 넘어간다) — 오늘의 시도권은 평소대로
  -- 소모된다.
  if v_p.steal_sure then
    v_ok := true;
    update public.profiles set steal_sure = false where id = v_uid;
    perform app.consume_steal_trick(v_uid);
  else
    -- 죽은 쥐(24_cat.sql)를 써 뒀으면 코인 구간·가액 상한으로 정해진 값 위에 더한다.
    v_ok := random() < least(1, app.steal_rate(app.shop_steal_base(v_p.coins), v_def.buy_price)
                                + app.cat_steal_bonus(v_uid));
  end if;

  if v_ok then
    update public.shop_offers
       set steal_used = true,
           bought = bought || jsonb_build_object(p_code, v_had + 1)
     where user_id = v_uid and day = app.today_kst();

    insert into public.inventories (user_id, item_code, qty, stolen_qty)
    values (v_uid, p_code, 1, 1)
    on conflict (user_id, item_code)
      do update set qty        = inventories.qty + excluded.qty,
                    stolen_qty = inventories.stolen_qty + excluded.stolen_qty;

    select * into v_p from public.profiles where id = v_uid;

    perform app.log(v_uid, 'shop', format('%s 절도 성공', v_def.name),
      0, v_p.coins, jsonb_build_object('code', p_code, 'steal', true, 'ok', true));

    v_pen := jsonb_build_object('coin_cut', 0, 'hp_cut', 0, 'to_ward', false);
  else
    update public.shop_offers set steal_used = true
     where user_id = v_uid and day = app.today_kst();

    v_pen := app.steal_penalty(v_uid, 10, 20);
    select * into v_p from public.profiles where id = v_uid;

    perform app.log(v_uid, 'shop', format('%s 절도 실패', v_def.name),
      -(v_pen->>'coin_cut')::int, v_p.coins,
      jsonb_build_object('code', p_code, 'steal', true, 'ok', false,
                         'hp_cut', (v_pen->>'hp_cut')::int));
  end if;

  return app.state_json(v_p) || jsonb_build_object('steal',
    jsonb_build_object(
      'ok',        v_ok,
      'item_name', v_def.name,
      'coin_cut',  (v_pen->>'coin_cut')::int,
      'hp_cut',    (v_pen->>'hp_cut')::int,
      'to_ward',   (v_pen->>'to_ward')::boolean
    ));
end;
$$;


-- -------------------------------------------------------------
-- 9. app.roll_special — 절도비법 전용 분기(12%)
-- -------------------------------------------------------------
create or replace function app.roll_special(p_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_kind  text;
  v_code  text;
  v_price integer;
  v_try   integer := 0;
begin
  -- 절도비법은 여기서만 나온다 — 상시분에도, 배급소에도 오르지 않는다
  -- (17_items.sql 의 아이템 정의 주석 참고). 실패하면(후보가 다 떨어지는
  -- 경우는 사실상 없다) 기존 grade/sale 루프로 그대로 흘러간다.
  if random() < 0.12 then
    select code, buy_price into v_code, v_price
      from public.item_defs
     where kind = 'trick' and buy_price is not null
       and not (code = any(p_codes))
     order by random()
     limit 1;

    if v_code is not null then
      return jsonb_build_object('code', v_code, 'kind', 'trick', 'price', v_price);
    end if;
  end if;

  v_kind := case when random() < 0.5 then 'grade' else 'sale' end;
  while v_code is null and v_try < 50 loop
    v_try := v_try + 1;

    if v_kind = 'grade' then
      select code, buy_price into v_code, v_price
        from public.item_defs
       where grade = 'epic' and buy_price is not null
         and kind not in ('food', 'medicine', 'charm')
         and not (code = any(p_codes))
       order by random()
       limit 1;
    else
      select code, greatest(1, round(buy_price * 0.65)) into v_code, v_price
        from public.item_defs
       where grade in ('uncommon', 'rare') and buy_price is not null
         and kind not in ('food', 'medicine', 'charm')
         and not (code = any(p_codes))
       order by random()
       limit 1;
    end if;

    -- 그 성격의 후보가 다 오늘 상시분과 겹치면 반대 성격으로 한 번 더 시도한다
    if v_code is null then
      v_kind := case when v_kind = 'grade' then 'sale' else 'grade' end;
    end if;
  end loop;

  if v_code is null then return null; end if;
  return jsonb_build_object('code', v_code, 'kind', v_kind, 'price', v_price);
end;
$$;


-- -------------------------------------------------------------
-- 10. public.smuggle_state — 특별 상품 칸들(specials) · item 의 steal_sure 를 함께 내보낸다
-- -------------------------------------------------------------
create or replace function public.smuggle_state()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid            uuid := auth.uid();
  v_st             public.smuggle_state;
  v_offer          public.smuggle_offers;
  v_unlocked       boolean;
  v_cooldown       integer;
  v_items          jsonb := '[]'::jsonb;
  v_specials       jsonb := '[]'::jsonb;
  v_livestock      jsonb;
  v_title          jsonb;
  v_consent        boolean;
  v_ls_price       integer;
  v_game           jsonb;
  g                public.lastcard_games;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select livestock_consent,
         app.livestock_pass_price(livestock_bought, livestock_bought_at)
    into v_consent, v_ls_price
    from public.profiles where id = v_uid;
  select * into v_st from public.smuggle_state where user_id = v_uid;
  v_unlocked := v_st.unlocked_day is not null;

  if v_unlocked then
    v_offer := app.smuggle_today(v_uid);

    -- 약물은 표시가부터 그 약물을 살수록 오른 값이다("이 값은 오늘 당신에게 매겨진
    -- 값이다") — 누진 폭은 화면 어디에도 숫자로 알려주지 않는다.
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', code, 'name', name, 'kind', kind, 'grade', grade,
             'emoji', emoji, 'heal', heal, 'plays', plays,
             'ward_cut', ward_cut, 'win_double', win_double,
             'buy_price', case when kind = 'drug'
                               then app.drug_price(buy_price, app.drug_bought(v_uid, code))
                               else buy_price end,
             'sell_price', sell_price,
             'tradable', tradable, 'description', description
           ) order by sort_order, code), '[]'::jsonb)
      into v_items
      from public.item_defs
     where code = any(v_offer.codes);

    if v_offer.special_open then
      -- 특별 상품 칸들. 값 · 취소선 정가는 app.smuggle_special_price(05)가 구매 ·
      -- 훔치기와 같은 식으로 낸다.
      select coalesce(jsonb_agg(
               jsonb_build_object('kind', e ->> 'kind')
               || app.smuggle_special_price(v_uid, e)
               || jsonb_build_object('item', jsonb_build_object(
                    'code', d.code, 'name', d.name,
                    'kind', d.kind, 'grade', d.grade,
                    'emoji', d.emoji, 'heal', d.heal,
                    'plays', d.plays, 'ward_cut', d.ward_cut,
                    'win_double', d.win_double,
                    'buy_price', d.buy_price, 'sell_price', d.sell_price,
                    'tradable', d.tradable, 'description', d.description,
                    'steal_sure', d.steal_sure))
               order by n), '[]'::jsonb)
        into v_specials
        from jsonb_array_elements(v_offer.specials) with ordinality as x(e, n)
        join public.item_defs d on d.code = e ->> 'code';

      -- 특별 상품이 열린 날에만, 특별 상품 칸들과 나란히 하나(또는 둘) 더 놓는다.
      -- 본인이 가축권에 동의하지 않았다면(livestock_consent 가 true 가 아니면) 애초에 보여주지 않는다.
      if coalesce(v_consent, false) then
        select jsonb_build_object('price', v_ls_price, 'item',
                 jsonb_build_object(
                   'code', code, 'name', name, 'kind', kind, 'grade', grade,
                   'emoji', emoji, 'heal', heal, 'plays', plays,
                   'ward_cut', ward_cut, 'win_double', win_double,
                   'buy_price', buy_price, 'sell_price', sell_price,
                   'tradable', tradable, 'description', description
                 ))
          into v_livestock
          from public.item_defs
         where code = 'livestock_pass';

        select jsonb_build_object('price', app.title_pass_price(), 'item',
                 jsonb_build_object(
                   'code', code, 'name', name, 'kind', kind, 'grade', grade,
                   'emoji', emoji, 'heal', heal, 'plays', plays,
                   'ward_cut', ward_cut, 'win_double', win_double,
                   'buy_price', buy_price, 'sell_price', sell_price,
                   'tradable', tradable, 'description', description
                 ))
          into v_title
          from public.item_defs
         where code = 'title_pass';
      end if;
    end if;
  end if;

  -- 가장 최근 한 판. 진행 중일 수도, 이미 끝난 판일 수도 있다.
  -- 화면은 이 판의 purpose 와 status 로 상대의 대사를 고른다.
  select * into g from public.lastcard_games
   where user_id = v_uid
   order by created_at desc
   limit 1;
  if found then
    v_game := app.lc_view(g);
  end if;

  select coalesce(greatest(0, extract(epoch from
           (max(created_at) + app.lastcard_cooldown() - now())))::int, 0)
    into v_cooldown
    from public.lastcard_games
   where user_id = v_uid;

  return jsonb_build_object(
    'unlocked',        v_unlocked,
    'cooldown_left',   v_cooldown,
    'items',           v_items,
    'special_open',    coalesce(v_offer.special_open, false),
    'specials',        v_specials,
    -- 한 칸이던 시절의 키. 옛 클라이언트가 첫 칸이라도 보게 남겨 둔다.
    'special',         v_specials -> 0,
    'livestock',       v_livestock,
    'title',           v_title,
    'game',            v_game,
    'bought',          coalesce(v_offer.bought, '{}'),
    'steal_used',      coalesce(v_offer.steal_used, false),
    'rerolled',        coalesce(v_offer.rerolled, false),
    'reroll_price',    app.smuggle_reroll_price()
  );
end;
$$;


-- -------------------------------------------------------------
-- 11. public.smuggle_steal — 확정 성공, 벌칙 하향, stolen_qty, CANNOT_STEAL 확장
-- -------------------------------------------------------------
create or replace function public.smuggle_steal(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_def   public.item_defs;
  v_st    public.smuggle_state;
  v_offer public.smuggle_offers;
  v_price integer;
  v_half  integer;
  v_ok    boolean;
  v_pen   jsonb;
  v_cut   integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select * into v_st from public.smuggle_state where user_id = v_uid;
  if v_st.unlocked_day is null then raise exception 'NOT_UNLOCKED'; end if;

  v_p := app.accrue(v_uid);
  -- 병동에서는 체력이 이미 0이라 벌칙의 절반이 공짜가 된다. 아예 막는다.
  if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  -- 증서는 훔칠 수 없다. 값이 app.*_pass_price() 에만 있고 되팔 수도 없어서,
  -- "물건 가액" 이라는 벌칙 기준 자체가 서지 않는다.
  -- 절도비법(trick)도 훔칠 수 없다 — 훔치기 요령을 훔쳐서 배운다는 게 앞뒤가
  -- 안 맞고, steal_sure 를 훔쳐서 켤 수 있으면 확정 성공을 공짜로 얻는 셈이다.
  if v_def.kind in ('permit', 'trick') then raise exception 'CANNOT_STEAL'; end if;

  perform app.smuggle_today(v_uid);
  select * into v_offer from public.smuggle_offers
   where user_id = v_uid and day = app.today_kst() for update;

  if v_offer.steal_used then raise exception 'STEAL_USED'; end if;
  if p_code = any(v_offer.bought) then raise exception 'ALREADY_BOUGHT'; end if;

  -- 값은 smuggle_buy 와 완전히 같은 식으로 구한다 — 화면에 뜬 그 값이 그대로
  -- 벌칙과 확률 상한의 기준이 되어야 한다.
  if p_code = any(v_offer.codes) then
    v_price := case when v_def.kind = 'drug'
                     then app.drug_price(v_def.buy_price, app.drug_bought(v_uid, p_code))
                     else v_def.buy_price end;
  elsif app.smuggle_special_find(v_offer, p_code) is not null then
    v_price := (app.smuggle_special_price(v_uid, app.smuggle_special_find(v_offer, p_code)) ->> 'price')::int;
  else
    raise exception 'NOT_IN_SMUGGLE';
  end if;

  if v_price is null then raise exception 'NOT_BUYABLE'; end if;

  -- 여기서부터는 되돌릴 수 없다. 성공하든 실패하든 오늘 몫은 소모된다.
  -- 절도비법(steal_sure)을 미리 장착해 뒀으면 확률과 무관하게 성공하고,
  -- 그 자리에서 플래그가 꺼지며 장착해 둔 물건도 함께 소모된다(또는 구버전
  -- 유저처럼 인벤에 이미 없으면 조용히 넘어간다) — 오늘의 시도권은 평소대로
  -- 소모된다.
  if v_p.steal_sure then
    v_ok := true;
    update public.profiles set steal_sure = false where id = v_uid;
    perform app.consume_steal_trick(v_uid);
  else
    -- 죽은 쥐(24_cat.sql)를 써 뒀으면 코인 구간·가액 상한으로 정해진 값 위에 더한다.
    v_ok := random() < least(1, least(app.smuggle_steal_base(v_p.coins), app.smuggle_value_cap(v_price))
                                + app.cat_steal_bonus(v_uid));
  end if;

  if v_ok then
    update public.smuggle_offers
       set steal_used = true,
           bought = bought || p_code
     where user_id = v_uid and day = app.today_kst();

    insert into public.inventories (user_id, item_code, qty, stolen_qty)
    values (v_uid, p_code, 1, 1)
    on conflict (user_id, item_code)
      do update set qty        = inventories.qty + excluded.qty,
                    stolen_qty = inventories.stolen_qty + excluded.stolen_qty;

    -- 훔친 것도 장부에는 남는다. 안 그러면 절도로 가격 누진을 피해 간다.
    if v_def.kind = 'drug' then
      insert into public.drug_purchases (user_id, item_code, bought)
      values (v_uid, p_code, 1)
      on conflict (user_id, item_code)
        do update set bought = drug_purchases.bought + excluded.bought;
    end if;

    select * into v_p from public.profiles where id = v_uid;

    perform app.log(v_uid, 'smuggle', format('%s 절도 성공', v_def.name),
      0, v_p.coins,
      jsonb_build_object('code', p_code, 'price', v_price, 'steal', true, 'ok', true));

    v_pen := jsonb_build_object('coin_cut', 0, 'hp_cut', 0, 'to_ward', false);
  else
    update public.smuggle_offers set steal_used = true
     where user_id = v_uid and day = app.today_kst();

    -- 판정 기준선은 그대로(물건 가액 / 그 절반)지만, 빼앗는 액수는 각각
    -- 절반으로 낮춘다 — 전액 -> 50%, 50% -> 25%.
    v_half := greatest(1, round(v_price * 0.5)::int);

    if v_p.coins >= v_price then
      -- 값을 치를 수 있는 사람이었다. 값의 절반만 뜯긴다 — 물건 없이.
      v_cut := v_half;
      update public.profiles set coins = coins - v_cut where id = v_uid;
      v_pen := jsonb_build_object('coin_cut', v_cut, 'hp_cut', 0, 'to_ward', false);
    elsif v_p.coins >= v_half then
      v_cut := greatest(1, round(v_price * 0.25)::int);
      update public.profiles set coins = coins - v_cut where id = v_uid;
      v_pen := jsonb_build_object('coin_cut', v_cut, 'hp_cut', 0, 'to_ward', false);
    else
      -- 값의 절반도 못 내놓는 사람. 몸으로 갚는다.
      v_pen := app.steal_penalty(v_uid, 20, 40);
    end if;

    select * into v_p from public.profiles where id = v_uid;

    perform app.log(v_uid, 'smuggle', format('%s 절도 실패', v_def.name),
      -(v_pen->>'coin_cut')::int, v_p.coins,
      jsonb_build_object('code', p_code, 'price', v_price, 'steal', true, 'ok', false,
                         'hp_cut', (v_pen->>'hp_cut')::int));
  end if;

  return app.state_json(v_p) || jsonb_build_object('steal',
    jsonb_build_object(
      'ok',        v_ok,
      'item_name', v_def.name,
      'coin_cut',  (v_pen->>'coin_cut')::int,
      'hp_cut',    (v_pen->>'hp_cut')::int,
      'to_ward',   (v_pen->>'to_ward')::boolean
    ));
end;
$$;


-- -------------------------------------------------------------
-- 12. app.move_items(04_trade.sql) — stolen_qty 도 qty 를 따라 잘린다
--     받는 쪽은 건드리지 않는다 — 받은 건 훔친 게 아니라 "받은 것"이다.
-- -------------------------------------------------------------
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


-- -------------------------------------------------------------
-- 13. public.inmate_roster(06_relations.sql) — 훔친 문구를 우선해서 보여준다
-- -------------------------------------------------------------
create or replace function public.inmate_roster()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 'flex' 는 문장 배열만 담는다 — 만료 시각·품목 코드는 절대 내보내지 않는다
  -- (그건 본인 화면에서 state_json 의 'flex' 로만 나간다). 중독 낙인은 만료가
  -- 없는 별도 줄로 맨 앞에 오고, 병동에서도 가려지지 않는다. 나머지 과시
  -- 상태는 병동에 있는 동안 통째로 숨긴다.
  select coalesce(jsonb_agg(jsonb_build_object(
           'username',    p.username,
           'avatar_path', p.avatar_path,
           'hp',          p.hp,
           'hp_max',      app.hp_max(),
           'in_ward',     (p.ward_until is not null),
           'cell_id',     p.cell_id,
           'cell',        (select app.cell_label(c.block, c.room)
                              from public.cells c where c.id = p.cell_id),
           'crime',       p.crime,
           'age',         p.age,
           'height_cm',   p.height_cm,
           'weight_kg',   p.weight_kg,
           'bio',         p.bio,
           'livestock_consent', p.livestock_consent,
           'flex',
             -- 중독·금단 문장은 app.addict_lines(02_schema.sql) 하나가 정한다.
             app.addict_lines(p)
             ||
             (case when p.ward_until is not null then '[]'::jsonb else coalesce((
                 select jsonb_agg(
                          -- {giver} 자리는 선물받아 장착했으면 준 사람, 아니면 본인 이름.
                          app.flex_render(
                            case when f.together then coalesce(d.flex_text_with, d.flex_text)
                                 when f.stolen then coalesce(d.flex_text_stolen, d.flex_text)
                                 when f.gifted then d.flex_text_gift
                                 else d.flex_text end,
                            case when f.gifted and not f.stolen and not f.together
                                 then (select g.username from public.profiles g where g.id = f.gift_from)
                                 else p.username end)
                          order by f.started_at)
                   from public.player_flex f
                   join public.item_defs d on d.code = f.item_code
                   -- 겹쳐 장착한 것은 그 수만큼 같은 줄을 낸다.
                   cross join generate_series(1, f.stack)
                  where f.user_id = p.id), '[]'::jsonb) end)
         ) order by p.username), '[]'::jsonb)
    into v_out
    from public.profiles p
   where not p.hidden;

  return v_out;
end;
$$;


-- -------------------------------------------------------------
-- 14. 권한
-- -------------------------------------------------------------
revoke all on function app.smuggle_value_cap(integer) from public, anon, authenticated;

-- public.smuggle_steal 은 이제 이 파일에만 있다(05_smuggle.sql · 15_steal.sql 의
-- 옛 사본을 지웠다). 그래서 권한도 여기서 건다 — 정본과 같은 파일에 둬야
-- 새로 설치할 때 "함수가 없다" 로 멈추지 않는다.
revoke all on function public.smuggle_steal(text) from public;
grant execute on function public.smuggle_steal(text) to authenticated;

-- app.roll_special · public.smuggle_state 도 이 파일에만 있다(05 의 옛 사본을 지웠다).
revoke all on function app.roll_special(text[]) from public, anon, authenticated;
revoke all on function public.smuggle_state() from public;
grant execute on function public.smuggle_state() to authenticated;

commit;
