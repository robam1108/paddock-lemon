-- =============================================================
--  02. 테이블 · 게임 로직 · RLS
--
--  실행 순서는 supabase/APPLY.md 하나만 본다. 이 파일은 00_rules.sql 과
--  01_special_meal.sql 다음에 온다 — 아래 최상위 문장들이 app.hidden_name() ·
--  app.cell_week_kst() 같은 상수 함수를 직접 부르기 때문이다.
--
--  여러 번 실행해도 안전하게 짜여 있지만, ★ 라이브 DB 에는 이 파일 전체를
--  다시 돌리지 않는다. 바뀐 절만 떼어 repair/ 밑에 날짜를 붙인 스크립트로
--  만들어 돌린다(APPLY.md 의 규칙 1).
--
--  아이템 카탈로그(item_defs)의 내용은 여기 없다 — 17_items.sql 이 정본이다.
--  표(테이블)만 여기서 만들고 행은 그쪽에서 채운다.
-- =============================================================


-- -------------------------------------------------------------
-- 1. 프로필
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  coins       integer not null default 0,
  plays_used  integer not null default 0,
  last_reset  date    not null default app.today_kst(),
  hl_card     integer not null default 7,
  created_at  timestamptz not null default now(),
  constraint coins_non_negative check (coins >= 0),
  constraint hl_card_range check (hl_card between 1 and 13)
);

-- 신규 계정은 0 코인으로 시작한다. (이미 있는 계정의 잔액은 건드리지 않는다)
alter table public.profiles alter column coins set default 0;

-- 하이로우 사다리 진행 상태
alter table public.profiles add column if not exists hl_stage integer not null default 0;
alter table public.profiles add column if not exists hl_bet   integer not null default 0;
alter table public.profiles add column if not exists hl_pot   integer not null default 0;
alter table public.profiles add column if not exists hl_steps jsonb   not null default '[]'::jsonb;

-- 회원 등급은 폐지되었다. 흑색구역은 누구나 들어갈 수 있고,
-- 대신 1:1 대전의 최소 판돈이 app.pvp_min_bet() 으로 제한된다.
alter table public.profiles drop constraint if exists profiles_grade_check;
alter table public.profiles drop column if exists grade;

alter table public.profiles add column if not exists debt integer not null default 0;
alter table public.profiles drop constraint if exists profiles_debt_check;
alter table public.profiles add constraint profiles_debt_check check (debt >= 0);

alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 명단에서 숨기는 계정(운영자 페르소나). is_admin 과는 별개다 —
-- 관리자 권한을 가진 평범한 플레이어는 계속 명단에 보인다.
alter table public.profiles add column if not exists hidden boolean not null default false;

-- 이미 만들어 둔 '관리자' 계정을 소급 적용한다(여러 번 실행해도 안전).
-- cell_id 를 비우는 건 아래(1-1 수용실)에서 컬럼이 생긴 뒤에 한다.
update public.profiles
   set hidden = true
 where username = app.hidden_name() and not hidden;

-- 오늘 아이템으로 되살린 게임 횟수. 자정에 plays_used 와 함께 초기화된다.
alter table public.profiles add column if not exists bonus_plays integer not null default 0;

-- 남아 있는 "다음 승리 판돈 2배" 횟수 (나이트메어)
alter table public.profiles add column if not exists win_double integer not null default 0;
alter table public.profiles drop constraint if exists profiles_bonus_plays_check;
alter table public.profiles add constraint profiles_bonus_plays_check
  check (bonus_plays >= 0);

/* ---------------- 약물 관련 컬럼 ----------------
   drug_plays 는 bonus_plays 처럼 자정에 초기화된다.
   drug_load(중독 판정)는 해독제로만 0 이 된다.
   drug_bought 는 2026-10-12 이전의 옛 공용 가격 누진 장부다 — 이제 아무도 읽고
   쓰지 않는다. 누진은 약물별 public.drug_purchases(05_smuggle.sql)가 쥔다. */
alter table public.profiles add column if not exists drug_plays  integer not null default 0;
alter table public.profiles add column if not exists drug_load   integer not null default 0;
alter table public.profiles add column if not exists drug_bought integer not null default 0;
alter table public.profiles drop constraint if exists profiles_drug_check;
alter table public.profiles add constraint profiles_drug_check
  check (drug_plays >= 0 and drug_load >= 0 and drug_bought >= 0);
-- 마지막으로 쓴 약물 코드와 그 시각. 중독 문구(app.addict_lines)와 금단 판정
-- (app.in_withdrawal)이 읽는다. 해독제로도 지우지 않는다 — drug_load 가 0 이면
-- 어차피 둘 다 꺼진다.
alter table public.profiles add column if not exists drug_last    text;
alter table public.profiles add column if not exists drug_used_at timestamptz;
-- 마지막 해독 이후 쓴 약물 코드(처음 쓴 순서, 중복 없음). 중독 문구가 약물마다
-- 한 줄씩 뜬다(app.addict_lines). 해독제가 비운다.
alter table public.profiles add column if not exists drug_used_codes text[] not null default '{}';

/* ---------------- 체력 관련 컬럼 ----------------
   시간이 지날 때마다 배치로 깎는 게 아니라,
   "마지막으로 정산한 시각"만 들고 있다가 접속했을 때 한 번에 계산한다.
   덕분에 주기적으로 도는 작업이 전혀 필요 없다. */
alter table public.profiles add column if not exists hp integer not null default 100;
-- 체력을 어느 시점까지 깎아 두었는지 (1시간 미만 잔여분은 남겨 둔다)
alter table public.profiles add column if not exists hp_at timestamptz not null default now();
-- 어느 시점까지의 식사를 지급했는지
alter table public.profiles add column if not exists meals_at timestamptz not null default now();
-- 병동에서 나오는 시각. null 이면 병동이 아니다.
alter table public.profiles add column if not exists ward_until timestamptz;

-- 지금까지 병동에 다녀온 횟수. 자정에도 해독제에도 지워지지 않는다(drug_bought 와 같은 성격).
alter table public.profiles add column if not exists ward_visits integer not null default 0;
alter table public.profiles drop constraint if exists profiles_ward_visits_check;
alter table public.profiles add constraint profiles_ward_visits_check check (ward_visits >= 0);

-- 마지막으로 병동에서 나온 시각. 다음 입원이 이 시각에서 app.ward_reset_hours()
-- 이상 지난 뒤면 ward_visits 를 0 으로 되돌려 사다리 첫 칸부터 다시 센다.
-- null 이면 아직 퇴원 기록이 없다(초기화할 것도 없다).
alter table public.profiles add column if not exists ward_left_at timestamptz;

-- 퇴원 경로(자연 퇴원 · 퇴원서 · 관리자 퇴원/체력 지정)가 여럿이라 각 함수가
-- 아니라 트리거 하나가 퇴원 시각을 찍는다. 예정 시각 전에 풀려났으면 지금,
-- 예정 시각이 이미 지난 뒤 정산됐으면 예정 시각이 퇴원 시각이다.
-- app.accrue 처럼 호출한 쪽이 직접 값을 넣었으면 그 값을 존중한다.
create or replace function app.stamp_ward_left()
returns trigger
language plpgsql
as $$
begin
  if old.ward_until is not null and new.ward_until is null
     and new.ward_left_at is not distinct from old.ward_left_at then
    new.ward_left_at := least(old.ward_until, now());
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_stamp_ward_left on public.profiles;
create trigger profiles_stamp_ward_left
  before update of ward_until on public.profiles
  for each row execute function app.stamp_ward_left();

-- '관리자' 계정은 체력을 소모하지 않으므로 항상 만땅으로 되돌려 둔다(소급 적용).
update public.profiles
   set hp = 100, hp_at = now(), ward_until = null
 where username = app.hidden_name() and (hp <> 100 or ward_until is not null);

-- 관리자 정지가 풀리는 시각. null 이면 정지 상태가 아니다.
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists suspend_reason  text;

alter table public.profiles drop constraint if exists profiles_hp_check;
alter table public.profiles add constraint profiles_hp_check
  check (hp >= 0 and hp <= 100);

-- 신원표 사진. 원본은 avatars 버킷(09_avatar.sql)에 있고, 여기엔 경로 문자열만 남는다.
alter table public.profiles add column if not exists avatar_path text;

-- 본인이 직접 기재하는 신상 항목. 전부 미기재를 허용한다.
alter table public.profiles add column if not exists crime     text;
alter table public.profiles add column if not exists age       smallint;
alter table public.profiles add column if not exists height_cm numeric(4,1);
alter table public.profiles add column if not exists weight_kg numeric(4,1);
-- 처음엔 정수(smallint)였다. 소수점 한 자리까지 받도록 넓힌다(이미 numeric 이면 그대로).
alter table public.profiles alter column height_cm type numeric(4,1);
alter table public.profiles alter column weight_kg type numeric(4,1);
alter table public.profiles add column if not exists bio       text;

-- 가축권 동의 여부. 아직 기재 전이면 null("미기재"), 이후로는 신상 기재 때마다
-- 동의/비동의 둘 중 하나를 반드시 골라야 한다(app.set_profile_details 참고).
alter table public.profiles add column if not exists livestock_consent boolean;

-- 지목자가 가축 지목권을 쓴 시각(app.livestock_use 참고). 이 값 + 잠금 기간이
-- 지나기 전에는 지목자 본인이 동의를 비동의로 못 바꾼다(대상 쪽에는 영향 없음).
alter table public.profiles add column if not exists livestock_used_at timestamptz;

-- 가축 지목권 구매 장부(05_smuggle.sql 의 app.livestock_pass_price(횟수, 시각)).
-- 살 때마다 횟수 +1 · 시각 갱신. 값은 500 부터 100씩 올라 상한(app.livestock_pass_max(), 900)
-- 까지 가고, 그 값에 산 다음 구매는 다시 500 이다(5회 순환).
alter table public.profiles add column if not exists livestock_bought    integer not null default 0;
alter table public.profiles add column if not exists livestock_bought_at timestamptz;

-- 절도비법(steal_trick)을 미리 써 두었는지. true 면 다음 shop_steal/smuggle_steal
-- 한 번이 확정 성공하고, 그 자리에서 다시 false 로 꺼진다.
alter table public.profiles add column if not exists steal_sure boolean not null default false;

-- 추석 송편(20_chuseok.sql). 먹은 송편의 등급과, 판돈 추가를 오늘 몇 번 썼는지.
-- 효과가 끝나는 시각은 app.chuseok_end() 하나가 쥐고 있어 여기엔 없다.
alter table public.profiles add column if not exists chuseok_grade text;
alter table public.profiles add column if not exists chuseok_day  date;
alter table public.profiles add column if not exists chuseok_used integer not null default 0;
-- 송편 쿠폰을 이미 받았는지. 쓰고 나서 다시 들어오지 않게 app.accrue 가 본다.
alter table public.profiles add column if not exists chuseok_coupon boolean not null default false;
-- 하이로우 판을 열 때 송편이 얹어 준 판돈. 첫 판정의 기준액이 hl_bet + hl_bonus 다.
alter table public.profiles add column if not exists hl_bonus integer not null default 0;
-- 하이로우 판을 열 때 지급한 일당. 일당이 보유 코인에 따라 달라지므로(app.play_wage(코인))
-- 사다리·수령 쪽이 표기용으로 다시 구하지 않고 이 값을 그대로 쓴다.
alter table public.profiles add column if not exists hl_wage integer not null default 0;

-- 네잎클로버(item_defs.stake_bonus)가 켜 둔 판돈 추가. stake_boost_until 이 지나면
-- 저절로 꺼진다(app.bonus_stake 가 시각만 본다 — 따로 치우지 않는다).
alter table public.profiles add column if not exists stake_boost integer not null default 0;
alter table public.profiles add column if not exists stake_boost_until timestamptz;

-- 가축 지목권을 쓴 뒤 동의를 비동의로 못 바꾸는 기간.
create or replace function app.livestock_consent_lock_days() returns integer
  language sql immutable as $$ select 7 $$;

alter table public.profiles drop constraint if exists profiles_age_check;
alter table public.profiles add constraint profiles_age_check
  check (age is null or (age between 1 and 120));
alter table public.profiles drop constraint if exists profiles_height_check;
alter table public.profiles add constraint profiles_height_check
  check (height_cm is null or (height_cm between 50 and 250));
alter table public.profiles drop constraint if exists profiles_weight_check;
alter table public.profiles add constraint profiles_weight_check
  check (weight_kg is null or (weight_kg between 20 and 300));


-- -------------------------------------------------------------
-- 1-1. 수용실
--
--   방마다 정원 app.cell_capacity() 명. 플레이어를 발급할 때(panel_add_player)
--   인원이 가장 적은 방으로 자동 배정하고, 전부 차 있으면 그때만 새 방을 만든다.
--   동·호실 숫자 자체에는 의미가 없다 — 그냥 서로 다른 이름표일 뿐이다.
--
--   매주 월요일 06:00 KST 에 app.cell_rotate() 가 전원을 무작위로 다시 섞는다
--   (아래 1-2). 이름표는 동 1~9 · 실 01~11 안에서만 뽑고 서로 겹치지 않게
--   짝짓는다 — 실이 11개라 방 11개(33명)까지는 실이 유일하고, 방이 9개를
--   넘어가는 순간부터 동이 겹친다.
-- -------------------------------------------------------------
create table if not exists public.cells (
  id    bigint generated always as identity primary key,
  block smallint not null,
  room  smallint not null,
  unique (block, room)
);

create or replace function app.cell_capacity() returns integer
  language sql immutable as $$ select 3 $$;

-- "4동 08실"
create or replace function app.cell_label(p_block smallint, p_room smallint)
returns text language sql immutable as $$
  select format('%s동 %s실', p_block, lpad(p_room::text, 2, '0'))
$$;

-- 초기 4실.
insert into public.cells (block, room)
values (4, 8), (5, 2), (6, 11), (7, 5)
on conflict (block, room) do nothing;

alter table public.profiles
  add column if not exists cell_id bigint references public.cells(id) on delete set null;

-- 인원이 가장 적은 방을 고른다. 동률이면 동·호실이 앞선 쪽. 전부 차 있으면 방을
-- 새로 만들되, 이름표는 동 1~9 · 실 01~11 을 벗어나지 않는다 — 아직 안 쓴 실을
-- 먼저, 그 다음 안 쓴 동을 우선한다(어차피 다음 월요일에 전부 다시 뽑힌다).
create or replace function app.assign_cell()
returns bigint
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id    bigint;
  v_block smallint;
  v_room  smallint;
begin
  select c.id into v_id
    from public.cells c
    left join public.profiles p on p.cell_id = c.id
   group by c.id, c.block, c.room
  having count(p.id) < app.cell_capacity()
   order by count(p.id), c.block, c.room
   limit 1;

  if found then return v_id; end if;

  select b.n, r.n into v_block, v_room
    from generate_series(1, 9)  as b(n)
   cross join generate_series(1, 11) as r(n)
   where not exists (select 1 from public.cells c
                      where c.block = b.n and c.room = r.n)
   order by (exists (select 1 from public.cells c where c.room  = r.n)),
            (exists (select 1 from public.cells c where c.block = b.n)),
            random()
   limit 1;

  -- 99개(9×11) 조합이 전부 차 있으면 더 만들 수 없다.
  if not found then raise exception 'CELLS_FULL'; end if;

  insert into public.cells (block, room) values (v_block, v_room) returning id into v_id;
  return v_id;
end;
$$;

-- 이미 만들어 둔 '관리자' 계정이 수용실을 차지하고 있었다면 비운다
-- (hidden 표시 자체는 위(1. 프로필)에서 이미 했다).
update public.profiles set cell_id = null where hidden and cell_id is not null;

-- 수용실이 없는 사람만 채운다. 이미 배정된 사람은 건드리지 않는다
-- (여기서 전원을 재배정하면 실행할 때마다 방이 섞인다).
do $$
declare r record;
begin
  for r in
    select id from public.profiles
     where cell_id is null and not hidden
     order by created_at, username
  loop
    update public.profiles set cell_id = app.assign_cell() where id = r.id;
  end loop;
end
$$;


-- -------------------------------------------------------------
-- 1-2. 수용실 주간 재배치
--
--   매주 월요일 06:00 KST 마다 전원을 무작위로 줄 세워 3인 1실로 다시 배치한다.
--   대상은 not hidden 인 사람 전원 — 병동에 있어도 방은 그대로 배정받고,
--   관리자(hidden)는 예전처럼 수용실을 갖지 않는다.
--
--   이 저장소에서 주기적으로 도는 작업은 이것 하나뿐이다(pg_cron, 맨 아래).
--   다만 cell_rotations 표가 '어느 주차를 이미 돌았는지'를 들고 있어서,
--   cron 이 두 번 튀거나 손으로 select app.cell_rotate(); 를 한 번 더 돌려도
--   한 주에 한 번만 돈다.
-- -------------------------------------------------------------

-- 이번 '배치 주기'가 시작된 시각 = 가장 최근에 지나온 월요일 06:00 KST.
-- (지금이 월요일 06시 이전이면 지난주 월요일을 가리킨다)
--   date_trunc('week', ...) 는 월요일 00:00 으로 자른다. 6시간 당겼다가 되돌려
--   경계를 06:00 으로 옮겼다. app.today_kst() 와 같은 결의 함수다.
create or replace function app.cell_week_kst() returns timestamptz
language sql stable as $$
  select (date_trunc('week', timezone('Asia/Seoul', now()) - interval '6 hours')
          + interval '6 hours') at time zone 'Asia/Seoul'
$$;

create table if not exists public.cell_rotations (
  week_at timestamptz primary key,
  done_at timestamptz not null default now(),
  rooms   integer not null default 0,
  people  integer not null default 0
);

-- p_lo~p_hi 를 섞어 p_n 개 뽑는다. 범위보다 많이 달라고 하면 다시 섞어 이어
-- 붙이므로, 그 지점부터 값이 겹친다(동이 9개뿐이라 방 10개째부터 그렇다).
create or replace function app.pick_shuffled(p_lo integer, p_hi integer, p_n integer)
returns smallint[]
language plpgsql
as $$
declare
  v_out smallint[] := '{}';
begin
  while coalesce(array_length(v_out, 1), 0) < p_n loop
    v_out := v_out || (select array_agg(g::smallint order by random())
                         from generate_series(p_lo, p_hi) g);
  end loop;
  return v_out[1:p_n];
end;
$$;

-- 이번 주차를 아직 안 돌았으면 전원을 다시 배치하고 만든 방 수를 돌려준다.
-- 이미 돌았으면 아무것도 하지 않고 0.
create or replace function app.cell_rotate()
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_week   timestamptz := app.cell_week_kst();
  v_people integer;
  v_rooms  integer;
  v_blocks smallint[];
  v_slots  smallint[];
  v_ids    bigint[] := '{}';
  v_pairs  text[]   := '{}';
  v_block  smallint;
  v_room   smallint;
  v_id     bigint;
  i        integer;
  j        integer;
begin
  -- 이번 주차를 선점한다. 행이 안 들어갔으면 누군가 이미 돌린 것이므로 끝.
  -- (동시에 두 번 불려도 한쪽만 통과하는 원자적 잠금 역할을 겸한다)
  insert into public.cell_rotations (week_at) values (v_week)
  on conflict (week_at) do nothing;
  if not found then return 0; end if;

  select count(*) into v_people from public.profiles where not hidden;
  v_rooms := greatest(1, ceil(v_people::numeric / app.cell_capacity())::integer);

  -- 동과 실을 따로 섞어 같은 자리끼리 짝짓는다. 두 배열이 서로 독립이어야
  -- 배치도를 동 순으로 늘어놓아도 실이 흩어진 채로 남는다("1동 03실, 2동 11실").
  -- 한 번만 섞어 돌려 쓰거나 실을 동에서 파생시키면 이 성질이 조용히 깨진다.
  v_blocks := app.pick_shuffled(1, 9,  v_rooms);
  v_slots  := app.pick_shuffled(1, 11, v_rooms);

  for i in 1..v_rooms loop
    v_block := v_blocks[i];
    v_room  := v_slots[i];

    -- 같은 (동,실) 짝이 이번 주 목록에 이미 있으면 동을 한 칸씩 밀어 빈 짝을
    -- 찾는다. 방이 11개 이하면 실이 전부 유일해서 이 루프는 돌지 않는다.
    j := 0;
    while j < 9 and format('%s:%s', v_block, v_room) = any(v_pairs) loop
      v_block := (v_block % 9 + 1)::smallint;
      j := j + 1;
    end loop;
    v_pairs := v_pairs || format('%s:%s', v_block, v_room);

    -- 지난주에 쓰던 이름표를 다시 뽑았을 수도 있으므로 insert 후 다시 읽는다.
    insert into public.cells (block, room) values (v_block, v_room)
    on conflict (block, room) do nothing;

    select c.id into v_id
      from public.cells c where c.block = v_block and c.room = v_room;

    v_ids := v_ids || v_id;
  end loop;

  -- 사람을 무작위로 줄 세워 정원(3명)씩 끊어 넣는다.
  with ordered as (
    select pr.id,
           (((row_number() over (order by random())) - 1) / app.cell_capacity())::integer as idx
      from public.profiles pr
     where not pr.hidden
  )
  update public.profiles p
     set cell_id = v_ids[o.idx + 1]
    from ordered o
   where p.id = o.id;

  -- 아무도 없는 옛 이름표를 치운다. 이걸 빼면 cells 에 지난주 방이 계속 쌓여
  -- 동·실 조합이 금세 바닥난다.
  delete from public.cells c
   where not exists (select 1 from public.profiles p where p.cell_id = c.id);

  update public.cell_rotations
     set rooms = v_rooms, people = v_people
   where week_at = v_week;

  return v_rooms;
end;
$$;

-- 이번 주차는 이미 돈 것으로 찍어 둔다 — 이 파일을 다시 실행했다고 해서 방이
-- 그 자리에서 섞이면 곤란하다. 첫 재배치는 다음 월요일 06:05 KST 다.
insert into public.cell_rotations (week_at) values (app.cell_week_kst())
on conflict (week_at) do nothing;


-- -------------------------------------------------------------
-- 2. 아이템
--
--   item_defs 가 카탈로그, inventories 가 보유량이다.
--   음식 말고 다른 종류를 추가할 때는 item_defs 에 한 줄 넣으면 되고,
--   유저 간 거래는 inventories 의 수량을 옮기는 것으로 끝난다.
-- -------------------------------------------------------------
create table if not exists public.item_defs (
  code        text primary key,
  name        text not null,
  -- 'food' 외에 나중에 다른 종류가 붙는다
  kind        text not null default 'food',
  -- 등급: common / rare / epic / legendary
  grade       text not null default 'common',
  emoji       text not null default '📦',
  -- 사용 시 회복되는 체력 (음식이 아니면 0)
  heal        integer not null default 0,
  -- 사용 시 되살아나는 게임 횟수 (하루 app.max_bonus_plays() 까지만 반영된다)
  plays       integer not null default 0,
  -- 사용 시 줄어드는 병동 시간(시간 단위). app.ward_hours() 이상이면 즉시 퇴원
  ward_cut    integer not null default 0,
  -- 사용 시 얻는 "다음 승리 판돈 2배" 횟수
  win_double  integer not null default 0,
  -- 상점에서 살 때 내는 값. null 이면 판매하지 않는 아이템
  buy_price   integer,
  -- 상점에 팔 때 받는 값. null 이면 되팔 수 없는 아이템
  sell_price  integer,
  -- 유저 간 거래 가능 여부
  tradable    boolean not null default true,
  description text not null default '',
  sort_order  integer not null default 100,
  constraint item_grade_check
    check (grade in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  constraint item_price_check check (
    (buy_price is null or buy_price >= 0) and (sell_price is null or sell_price >= 0)
  )
);

create table if not exists public.inventories (
  user_id   uuid not null references auth.users(id) on delete cascade,
  item_code text not null references public.item_defs(code) on delete cascade,
  qty       integer not null default 0 check (qty >= 0),
  primary key (user_id, item_code)
);

create index if not exists inventories_user_idx on public.inventories (user_id);

-- 대가 없이 선물로 받아 아직 쓰지 않은 수량. 쓰거나 장착할 때 이 몫부터
-- 소모된다("누군가에게 받은 …" 문장은 준 사람을 밝히지 않고 이 값만 본다).
alter table public.inventories add column if not exists gifted_qty integer not null default 0;
alter table public.inventories drop constraint if exists inventories_gifted_check;
alter table public.inventories add constraint inventories_gifted_check
  check (gifted_qty >= 0 and gifted_qty <= qty);

-- 개봉한 갑(uses > 1인 아이템)에 남은 사용 횟수. 0 이면 개봉분이 없다는 뜻이다.
-- qty 는 이 값과 무관하게 항상 "봉인된 갑의 수"로 남으므로, 거래·반납·라이터
-- 판정 등 qty 만 보는 기존 로직이 전혀 손대지 않아도 "개봉한 갑은 못 넘긴다"가
-- 저절로 성립한다.
alter table public.inventories add column if not exists open_left integer not null default 0;
alter table public.inventories drop constraint if exists inventories_open_left_check;
alter table public.inventories add constraint inventories_open_left_check
  check (open_left >= 0);
-- 개봉한 갑이 선물로 받은 몫이었는지 — 남은 개비를 마저 쓸 때도
-- "누군가에게 받은 …" 문구(flex_text_gift)를 이어서 쓰기 위함.
alter table public.inventories add column if not exists open_gifted boolean not null default false;

-- 훔쳐서 얻어 아직 쓰지 않은 수량. gifted_qty 와 같은 방식으로, 장착(flex_equip)할 때
-- 이 몫이 있으면 "훔친 …" 문구(flex_text_stolen)를 고른다. 선물(gifted_qty)보다도
-- 우선한다 — 훔친 걸 남에게 넘겨도 받는 쪽은 gifted_qty 만 올라간다(app.move_items).
alter table public.inventories add column if not exists stolen_qty integer not null default 0;
alter table public.inventories drop constraint if exists inventories_stolen_check;
alter table public.inventories add constraint inventories_stolen_check
  check (stolen_qty >= 0 and stolen_qty <= qty);
-- 가장 최근에 이 물건을 선물해 준 사람(app.move_items 가 선물 거래 때만 덮어쓴다).
-- 장착할 때 "받은 것" 문구를 고르면 flex_equip 이 player_flex.gift_from 으로 옮기고,
-- 문구에 {giver} 가 있으면 그 이름이 들어간다(app.flex_render). 평소 "누군가에게
-- 받은 …" 문구는 여전히 준 사람을 밝히지 않는다.
alter table public.inventories add column if not exists gift_from uuid
  references public.profiles(id) on delete set null;

-- 아이템 카탈로그. 사는 값과 파는 값이 다르다.
-- 새 아이템은 여기 한 줄만 추가하면 상점·가방·거래에 모두 반영된다.
alter table public.item_defs add column if not exists plays integer not null default 0;
alter table public.item_defs add column if not exists ward_cut integer not null default 0;
alter table public.item_defs add column if not exists win_double integer not null default 0;

-- 과시(담배·술·사치품·약물) 관련 컬럼. flex_kind 가 null 이면 과시 아이템이 아니다.
--   'consume' : 사용 시 인벤에서 1개 소모, flex_hours 동안 남에게 보인다
--   'wear'    : 소모되지 않는다. 장착/해제가 자유롭다
alter table public.item_defs add column if not exists flex_kind text;
alter table public.item_defs add column if not exists flex_hours integer not null default 0;
alter table public.item_defs add column if not exists flex_text text;
-- 선물로 받은 물건일 때 쓰는 문장(한국어 어순이 달라 통짜로 따로 둔다)
alter table public.item_defs add column if not exists flex_text_gift text;
-- 훔친 물건일 때 쓰는 문장. wear(착용형) 16종에만 값이 있고, 나머지는 null —
-- 읽는 쪽이 coalesce(flex_text_stolen, flex_text) 로 비어 있으면 평소 문장으로 되돌린다.
alter table public.item_defs add column if not exists flex_text_stolen text;
-- 누군가와 함께 썼을 때 쓰는 문장(술·RP 약물 몇 종·젤). 값이 있는 품목만 소지품에서
-- "함께" 를 고를 수 있다(public.use_together). 17_items.sql 의 "함께 문구" 표가 채운다.
alter table public.item_defs add column if not exists flex_text_with text;
alter table public.item_defs drop constraint if exists item_flex_kind_check;
alter table public.item_defs add constraint item_flex_kind_check
  check (flex_kind is null or flex_kind in ('consume', 'wear'));

-- 약물 부하. 쓸 때마다 profiles.drug_load(중독 판정)에 이만큼씩 쌓인다.
-- 가격 누진과는 무관하다(누진은 약물별 구매 횟수, public.drug_purchases).
alter table public.item_defs add column if not exists drug_dose integer not null default 0;
-- 해독제 표식. 쓰면 profiles.drug_load 를 0 으로 되돌린다(가격 누진 장부는 그대로).
alter table public.item_defs add column if not exists detox boolean not null default false;
-- 쓸 때마다 이 확률(0~1)로 과다복용 — 체력 1~5 를 잃는다. 병동에는 보내지 않는다(public.use_item).
alter table public.item_defs add column if not exists overdose_pct numeric not null default 0;
-- 중독 상태일 때 특이사항 맨 앞에 붙는 문장. null 이면 '손이 늘 떨린다'(app.addict_lines).
alter table public.item_defs add column if not exists addict_text text;

-- 절도비법(steal_trick) 표식. use_item 으로 미리 읽어 두면 profiles.steal_sure 가
-- 켜지고, 다음 shop_steal/smuggle_steal 한 번이 확정 성공한다.
alter table public.item_defs add column if not exists steal_sure boolean not null default false;

-- 한 개(갑)에 든 사용 횟수(개비 수). 대부분 1이고, 담배 몇 종만 여러 번 쓴다
-- (17_items.sql 의 "개비 수(uses)" 표가 값을 쥔다). flex_use 가 갑을 뜯을 때만
-- 참조하고, 뜯은 뒤로는 inventories.open_left 로 넘어간다.
alter table public.item_defs add column if not exists uses integer not null default 1;
alter table public.item_defs drop constraint if exists item_uses_check;
alter table public.item_defs add constraint item_uses_check check (uses >= 1);

-- 쓰면 flex_hours 동안 모든 판의 판돈에 시설이 얹어 주는 코인(네잎클로버).
-- 17_items.sql 의 "판돈 추가(stake_bonus)" 표가 값을 쥔다. 0 이면 효과 없음.
alter table public.item_defs add column if not exists stake_bonus integer not null default 0;

-- create table if not exists 는 이미 있는 테이블의 제약조건을 갱신하지 않는다.
-- 등급이나 컬럼을 늘릴 때는 여기서 명시적으로 다시 걸어 줘야 한다.
alter table public.item_defs drop constraint if exists item_grade_check;
alter table public.item_defs add constraint item_grade_check
  check (grade in ('common', 'uncommon', 'rare', 'epic', 'legendary'));

alter table public.item_defs drop constraint if exists item_price_check;
alter table public.item_defs add constraint item_price_check
  check ((buy_price is null or buy_price >= 0)
     and (sell_price is null or sell_price >= 0));

-- 아이템 카탈로그의 내용(이름·설명·가격·개비 수)은 17_items.sql 이 정본이다.
-- 예전에는 부트스트랩용 사본이 여기에도 있었는데, 두 곳을 손으로 맞추다
-- 어긋나면 이 파일을 다시 돌리는 순간 카탈로그가 조용히 옛 값으로 되감겼다.
-- 그래서 사본을 지웠다. 표는 여기서 만들고 행은 17_items.sql 이 채운다.


-- -------------------------------------------------------------
-- 2-1. 과시 상태 — 담배·술·사치품·약물을 쓰거나 장착했을 때의 활성 상태.
--   consume 은 expires_at 이 차 있고 시간이 지나면 사라진다.
--   wear    은 expires_at 이 null 이고, 직접 해제할 때까지 유지된다.
--   gifted 는 대가 없이 선물로 받은 개체를 썼을 때만 true — 준 사람은
--   저장하지 않는다("누군가에게 받은" 문장으로만 드러난다).
-- -------------------------------------------------------------
create table if not exists public.player_flex (
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_code  text not null references public.item_defs(code) on delete cascade,
  gifted     boolean not null default false,
  expires_at timestamptz,
  started_at timestamptz not null default now(),
  primary key (user_id, item_code)
);

-- 훔친 개체를 장착했는지. gifted 보다 우선한다 — flex_equip 이 함께 정한다.
alter table public.player_flex add column if not exists stolen boolean not null default false;
-- 누군가와 함께 쓴 것인지(public.use_together). 쓴 사람과 고른 사람 양쪽 행이 켜지고,
-- 다른 모든 갈래보다 먼저 flex_text_with 를 고른다. 혼자 다시 쓰면 app.flex_apply 가 끈다.
alter table public.player_flex add column if not exists together boolean not null default false;
-- 착용형(wear)을 몇 개 겹쳐 장착했는지. 가진 수량까지 같은 물건을 여러 번 장착할 수
-- 있고(flex_equip 이 1 씩 올리고 flex_unequip 이 1 씩 내린다), 특이사항도 그 수만큼
-- 같은 줄이 뜬다. 소모형은 언제나 1 이다.
alter table public.player_flex add column if not exists stack integer not null default 1;
alter table public.player_flex drop constraint if exists player_flex_stack_check;
alter table public.player_flex add constraint player_flex_stack_check check (stack >= 1);
-- 선물받은 것을 장착했을 때 준 사람(flex_equip 이 inventories.gift_from 에서 옮긴다).
-- 문구의 {giver} 자리에 이 사람 이름이, 비어 있으면 본인 이름이 들어간다.
alter table public.player_flex add column if not exists gift_from uuid
  references public.profiles(id) on delete set null;

create index if not exists player_flex_user_idx on public.player_flex (user_id);
-- RLS·정책은 2207행 근처의 공용 블록에서 함께 켠다(select 뿐 — 쓰기는
-- flex_use/flex_equip/flex_unequip 로만 한다).


-- -------------------------------------------------------------
-- 3. 게임 기록 (실시간 피드 + 감사 로그)
-- -------------------------------------------------------------
create table if not exists public.game_rounds (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  username      text not null,
  game          text not null,
  bet           integer not null,
  choice        text,
  outcome       jsonb not null,
  payout        integer not null,
  balance_after integer not null,
  created_at    timestamptz not null default now()
);

-- 'dice' · 'indian' · 'blackjack' 는 흑색구역 1:1 대전(03_pvp.sql)이 기록한다.
-- 03_pvp.sql 이 이 제약을 다시 넓히므로 순서상으로는 없어도 되지만, 이미 대전
-- 기록이 쌓인 DB에서 02_schema.sql만 다시 실행해도 막히지 않도록 여기서도 맞춰 둔다.
alter table public.game_rounds drop constraint if exists game_rounds_game_check;
alter table public.game_rounds add constraint game_rounds_game_check
  check (game in ('roulette', 'slots', 'keno', 'highlow', 'dice', 'indian', 'blackjack', 'race'));

create index if not exists game_rounds_created_at_idx on public.game_rounds (created_at desc);
create index if not exists game_rounds_user_idx on public.game_rounds (user_id, created_at desc);


-- -------------------------------------------------------------
-- 3-2. 개인 원장
--      게임 · 배급소 · 거래를 가리지 않고 코인이 움직인 내역을 한곳에 쌓는다.
--      "수감기록 > 기록" 화면이 이 테이블 하나만 읽는다.
-- -------------------------------------------------------------
create table if not exists public.ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- 'game' | 'shop' | 'trade' | 'admin'
  kind       text not null,
  title      text not null,
  detail     jsonb not null default '{}'::jsonb,
  coin_delta integer not null default 0,
  coin_after integer not null,
  created_at timestamptz not null default now()
);

create index if not exists ledger_user_idx on public.ledger (user_id, created_at desc);

create or replace function app.log(
  p_uid   uuid,
  p_kind  text,
  p_title text,
  p_delta integer,
  p_after integer,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ledger (user_id, kind, title, detail, coin_delta, coin_after)
  values (p_uid, p_kind, p_title, coalesce(p_detail, '{}'::jsonb), p_delta, p_after);
$$;


-- -------------------------------------------------------------
-- 4. 대출 신청
-- -------------------------------------------------------------
create table if not exists public.loan_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  username   text not null,
  amount     integer not null check (amount > 0),
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'rejected')),
  note       text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists loan_requests_user_idx
  on public.loan_requests (user_id, created_at desc);
create unique index if not exists loan_requests_one_pending
  on public.loan_requests (user_id) where status = 'pending';


-- -------------------------------------------------------------
-- 5. 발급된 로그인 코드 보관 (관리자 페이지 전용)
-- -------------------------------------------------------------
create table if not exists public.player_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code       text not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists player_codes_code_key on public.player_codes (code);

-- src/lib/identity.ts 의 identityOf(name).no 와 반드시 같은 값을 내야 한다.
-- 한쪽만 고치면 로그인 코드 앞자리와 화면에 뜨는 수용번호가 어긋난다.
--   FNV-1a 32bit over 'no:' || 이름,  1000 + (h % 9000)
-- (한글은 BMP 라 PG 의 ascii() 가 JS 의 charCodeAt() 과 같은 값을 준다)
create or replace function app.name_no(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_s text := 'no:' || coalesce(nullif(btrim(p_name), ''), '미상');
  v_h bigint := 2166136261;          -- 0x811c9dc5
  i   integer;
begin
  for i in 1..length(v_s) loop
    v_h := ((v_h # ascii(substr(v_s, i, 1))) * 16777619) & 4294967295;
  end loop;
  return lpad((1000 + (v_h % 9000))::text, 4, '0');
end;
$$;

-- 앞 4자리는 죄수번호(app.name_no), 뒤 6자리는 A-Z·0-9 중 헷갈리는 글자를 뺀 31자.
--   뺀 글자: O I L 0 1  (종이에 적어 전달하거나 불러 줄 때 틀리는 조합)
--   대문자 1개 이상 + 숫자 1개 이상을 보장한다.
drop function if exists app.gen_code();

create or replace function app.gen_code(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ';   -- 23자 (O I L 제외)
  v_digit text := '23456789';                  --  8자 (0 1 제외)
  v_pool  text := v_alpha || v_digit;          -- 31자
  v_no    text := app.name_no(p_name);
  v_tail  text;
  v_code  text;
  v_try   integer := 0;
  i       integer;
begin
  loop
    v_tail := '';
    for i in 1..6 loop
      v_tail := v_tail || substr(v_pool, 1 + floor(random() * length(v_pool))::int, 1);
    end loop;

    v_code := v_no || '-' || v_tail;

    exit when v_tail ~ '[A-Z]' and v_tail ~ '[0-9]'
          and not exists (select 1 from public.player_codes where code = v_code);

    v_try := v_try + 1;
    if v_try > 100 then raise exception '코드를 생성하지 못했습니다.'; end if;
  end loop;
  return v_code;
end;
$$;

create or replace function app.require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'NOT_ADMIN';
  end if;
end;
$$;

-- 정지된 계정은 게임·거래·상점·대전을 쓸 수 없다. 진정함(petition_*)만 예외로
-- 열어 둔다. 만료된 정지는 여기서 그 자리에 지워 버린다 — 병동(ward_until)이
-- 배치 없이 접속 시점에 정산되는 것과 같은 방식이다.
create or replace function app.require_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select suspended_until into v_until from public.profiles where id = auth.uid();

  if v_until is not null and v_until <= now() then
    -- 지우기 전에 정산한다 — accrue 는 suspended_until 을 보고 정지 기간을
    -- 체력·식사 계산에서 빼므로, 먼저 지우면 그 기간이 한꺼번에 계산된다.
    perform app.accrue(auth.uid());
    update public.profiles
       set suspended_until = null, suspend_reason = null
     where id = auth.uid();
    v_until := null;
  end if;

  if v_until is not null then raise exception 'SUSPENDED'; end if;
end;
$$;

create or replace function app.is_suspended(p_uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
     where id = p_uid and suspended_until is not null and suspended_until > now()
  );
$$;

-- hidden 여부 확인용. RLS 정책(game_rounds) 안에서 authenticated role 로 직접
-- profiles 를 서브쿼리하면 profiles 자신의 정책("not hidden")에 또 걸려서
-- "hidden = true" 조건과 모순되어 결과가 항상 빈 집합이 된다 — 그래서 반드시
-- security definer(테이블 소유자 권한, RLS 미적용)로 우회해야 한다.
create or replace function app.is_hidden_uid(p_uid uuid)
returns boolean
language sql
security definer
set search_path = public, app
stable
as $$
  select coalesce((select hidden from public.profiles where id = p_uid), false);
$$;

create or replace function app.is_hidden_name(p_username text)
returns boolean
language sql
security definer
set search_path = public, app
stable
as $$
  select coalesce((select hidden from public.profiles where username = p_username), false);
$$;


-- -------------------------------------------------------------
-- 6. 계정 발급 시 프로필 자동 생성
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_name   text := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  v_hidden boolean := (v_name = app.hidden_name());
begin
  insert into public.profiles
    (id, username, coins, plays_used, last_reset, hl_card, hp, hp_at, meals_at, cell_id, hidden)
  values (
    new.id,
    v_name,
    app.initial_coins(),
    0,
    app.today_kst(),
    app.hl_draw(),
    app.hp_max(),
    now(),
    now(),
    case when v_hidden then null else app.assign_cell() end,
    v_hidden
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop function if exists public.username_taken(text);


-- -------------------------------------------------------------
-- 7. 식사 지급 시각 목록
--    (p_from, p_to] 사이에 지나간 08:00 / 12:00 / 19:00 을 돌려준다.
-- -------------------------------------------------------------
create or replace function app.meal_slots(p_from timestamptz, p_to timestamptz)
returns setof timestamptz
language sql
stable
as $$
  select slot
    from (
      select ((d::date + t) at time zone 'Asia/Seoul') as slot
        from generate_series(
               (timezone('Asia/Seoul', p_from))::date,
               (timezone('Asia/Seoul', p_to))::date,
               interval '1 day') d,
             unnest(app.meal_times()) t
    ) s
   where slot > p_from and slot <= p_to
   order by slot;
$$;


-- -------------------------------------------------------------
-- 8. 시간 경과 정산  ★ 이 시스템의 핵심
--
--   접속했을 때 "마지막 정산 시각부터 지금까지" 흐른 시간을 한 번에 계산한다.
--   주기적으로 도는 작업(cron)이 전혀 없고, 바뀐 게 있을 때만 UPDATE 한다.
--
--   처리 순서
--     1) 병동에 있으면 -> 퇴원 시각 전이면 그대로, 지났으면 체력 80으로 퇴원
--     2) 흐른 시간만큼 체력을 깎는다 (1시간당 2)
--     3) 깎다가 0에 닿으면 그 시점(먹을 것이 있었다면 유예 15시간 뒤)부터 병동
--        (수용 시간은 14 -> 18 -> 24 -> 36 -> 48시간으로 다녀온 횟수만큼 늘어난다)
--     4) 병동이 아니면 그 사이 지나간 식사 시각만큼 도시락 지급
-- -------------------------------------------------------------
-- 나이트메어를 써 두었으면 이번 승리 판돈을 두 배로 부풀리고 한 번 차감한다.
-- 진 판(지급액 0)에는 쓰이지 않는다.
create or replace function app.apply_win_double(p_uid uuid, p_payout integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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

-- 추석 송편(희귀·특급)의 판돈 추가를 한 번 쓴다. 남은 횟수가 있으면 오늘 쓴
-- 횟수를 올리고 얹어 줄 코인을 돌려준다. 없으면(또는 이벤트가 끝났으면) 0.
create or replace function app.chuseok_charge(p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_uid for update;
  if app.chuseok_left(v_p.chuseok_grade, v_p.chuseok_day, v_p.chuseok_used) <= 0 then
    return 0;
  end if;

  update public.profiles
     set chuseok_used = case when chuseok_day = app.today_kst() then chuseok_used + 1 else 1 end,
         chuseok_day  = app.today_kst()
   where id = p_uid;
  return app.chuseok_stake(v_p.chuseok_grade);
end;
$$;

revoke all on function app.chuseok_charge(uuid) from public, anon, authenticated;

-- 이 판 판돈에 시설이 얹어 주는 코인의 합. 추석 송편(횟수제) + 네잎클로버(시간제)
-- + 죽은 새(횟수제, 24_cat.sql 의 app.cat_bless_charge — 이름은 옛 고양이의 보은 때 것).
-- play_game / highlow_begin 이 한 판에 한 번 부른다. 지급은 (판돈 + 이 값) 기준,
-- 코인은 판돈만 빠진다.
create or replace function app.bonus_stake(p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_uid;
  return app.chuseok_charge(p_uid)
       + case when v_p.stake_boost_until > now() then v_p.stake_boost else 0 end
       + app.cat_bless_charge(p_uid);
end;
$$;

revoke all on function app.bonus_stake(uuid) from public, anon, authenticated;

create or replace function app.has_food(p_uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.inventories i
      join public.item_defs d on d.code = i.item_code
     where i.user_id = p_uid and i.qty > 0 and d.heal > 0
  );
$$;

-- 담배는 불을 붙일 것이 있어야 쓴다. 라이터는 장착해도 인벤에 남으므로
-- 보유 수량만 본다 — 장착 여부는 묻지 않는다.
create or replace function app.has_lighter(p_uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.inventories i
     where i.user_id = p_uid and i.qty > 0
       and i.item_code in ('lighter_old', 'lighter_ag', 'lighter_au')
  );
$$;

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


-- -------------------------------------------------------------
-- 9. 체력을 깎고, 0이 되면 병동으로 보낸다. 수용 시간은 지금까지 다녀온
--    횟수에 따라 14 -> 48시간으로 늘어난다(app.ward_hours(p_visits) 참고).
-- -------------------------------------------------------------
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


-- -------------------------------------------------------------
-- 9-1. 중독 · 금단 — 판정과 특이사항 문장은 여기 하나에서만 정한다
--      (app.state_json 과 public.inmate_roster 가 같이 쓴다)
-- -------------------------------------------------------------

-- 중독인 채로 마지막 투약에서 app.withdrawal_hours() 가 지났으면 금단이다.
-- 투약 기록이 없는 중독자(drug_used_at 이 생기기 전에 중독된 사람)는 금단으로
-- 치지 않는다 — 라이브에는 repair 에서 now() 로 채워 넣는다.
create or replace function app.in_withdrawal(p public.profiles)
returns boolean
language sql
stable
as $$
  select p.drug_load >= app.drug_addict_threshold()
     and p.drug_used_at is not null
     and p.drug_used_at + make_interval(hours => app.withdrawal_hours()) <= now()
$$;

-- 특이사항 맨 앞에 붙는 만료 없는 줄들. 중독이면 마지막 해독 이후 쓴 약물마다
-- 중독 문구(item_defs.addict_text) 한 줄씩 — 고유 문구가 없는 약물(블러드·러시 등)은
-- '손이 늘 떨린다' 한 줄로 묶인다. 처음 쓴 순서대로, 금단이면 맨 끝에 한 줄 더.
create or replace function app.addict_lines(p public.profiles)
returns jsonb
language sql
stable
as $$
  select case
           when p.drug_load < app.drug_addict_threshold() then '[]'::jsonb
           else coalesce((
                  select jsonb_agg(t.line order by t.first_at)
                    from (select coalesce(d.addict_text, '손이 늘 떨린다') as line,
                                 min(u.ord) as first_at
                            from unnest(p.drug_used_codes) with ordinality as u(code, ord)
                            left join public.item_defs d on d.code = u.code
                           group by 1) t),
                  -- 기록이 없는 옛 중독자
                  jsonb_build_array('손이 늘 떨린다'))
                || case when app.in_withdrawal(p)
                        then jsonb_build_array('식은땀을 흘리며 몸을 떤다')
                        else '[]'::jsonb end
         end
$$;

-- 과시 문구의 자리표시를 채운다. {giver} → 이름, {이/가} → 그 이름의 조사
-- (마지막 글자에 받침이 있으면 '이', 없거나 한글이 아니면 '가').
-- 이름은 부르는 쪽(app.state_json / public.inmate_roster)이 고른다 — 선물받아
-- 장착했으면 준 사람, 아니면 본인. 자리표시가 없는 문구는 그대로 나온다.
create or replace function app.flex_render(p_text text, p_name text) returns text
language sql immutable as $$
  select replace(replace(p_text, '{giver}', coalesce(p_name, '누군가')),
                 '{이/가}',
                 case when ascii(right(coalesce(p_name, '누군가'), 1)) between 44032 and 55203
                       and (ascii(right(coalesce(p_name, '누군가'), 1)) - 44032) % 28 > 0
                      then '이' else '가' end);
$$;


-- -------------------------------------------------------------
-- 10. 클라이언트에 돌려줄 상태
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
-- 11. 내 상태 조회 (일일 리셋 + 시간 경과 정산까지 반영)
-- -------------------------------------------------------------
create or replace function public.get_my_state()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 일일 리셋과 시간 경과 정산이 모두 app.accrue 안에서 처리된다.
  v_p := app.accrue(v_uid);
  return app.state_json(v_p);
end;
$$;

-- 본인이 직접 기재하는 신상 항목. 빈 문자열은 미기재로 접는다.
-- 가축권 동의 여부(p_livestock_consent)만은 예외로, 미기재를 허용하지 않는다 —
-- 신상을 고칠 때마다 동의/비동의 중 하나를 반드시 골라야 한다.
--
-- 동의 -> 비동의로 되돌리는 것은, 가축 지목권·호칭권을 사놓고(또는 이미 그걸로
-- 맺어진 관계가 살아있는 동안) 발을 빼는 걸 막기 위해 다음 동안은 거부한다:
--   · 가축 지목권·호칭권을 아직 쓰지 않고 들고 있을 때(inventories)
--   · 가축·호칭 관계(kind in ('livestock','title'))가 살아있을 때 — 본인이
--     가축/대상이든 주인/지목자이든
--   · 본인이 지목자로서 가축 지목권·호칭권을 쓴 뒤 app.livestock_consent_lock_days()가
--     지나지 않았을 때(livestock_used_at, 둘이 같은 타이머를 공유) — 대상 쪽에는
--     적용되지 않는다
-- 키·체중은 소수점 한 자리까지 받는다. 처음엔 정수 인자였으므로 옛 시그니처를 지워
-- 오버로드 둘이 공존하지 않게 한다.
drop function if exists public.set_profile_details(text, integer, integer, integer, text, boolean);
create or replace function public.set_profile_details(
  p_crime              text,
  p_age                integer,
  p_height_cm          numeric,
  p_weight_kg          numeric,
  p_bio                text,
  p_livestock_consent  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_name  text;
  v_crime text := nullif(btrim(coalesce(p_crime, '')), '');
  v_bio   text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_crime is not null and length(v_crime) > 40 then raise exception 'INVALID_DETAIL'; end if;
  if v_bio is not null and length(v_bio) > 300 then raise exception 'INVALID_DETAIL'; end if;
  if p_age is not null and p_age not between 1 and 120 then raise exception 'INVALID_DETAIL'; end if;
  if p_height_cm is not null and p_height_cm not between 50 and 250 then raise exception 'INVALID_DETAIL'; end if;
  if p_weight_kg is not null and p_weight_kg not between 20 and 300 then raise exception 'INVALID_DETAIL'; end if;
  if p_livestock_consent is null then raise exception 'INVALID_DETAIL'; end if;

  if p_livestock_consent is false then
    select username into v_name from public.profiles where id = v_uid;

    if exists (
      select 1 from public.inventories
       where user_id = v_uid and item_code = 'livestock_pass' and qty > 0
    ) then
      raise exception 'LIVESTOCK_PASS_HELD';
    end if;

    if exists (
      select 1 from public.inventories
       where user_id = v_uid and item_code = 'title_pass' and qty > 0
    ) then
      raise exception 'TITLE_PASS_HELD';
    end if;

    if exists (
      select 1 from public.relations
       where kind = 'livestock' and expires_at > now()
         and (username = v_name or partner = v_name)
    ) then
      raise exception 'LIVESTOCK_ACTIVE';
    end if;

    if exists (
      select 1 from public.relations
       where kind = 'title' and expires_at > now()
         and (username = v_name or partner = v_name)
    ) then
      raise exception 'TITLE_ACTIVE';
    end if;

    if exists (
      select 1 from public.profiles
       where id = v_uid and livestock_used_at is not null
         and livestock_used_at + make_interval(days => app.livestock_consent_lock_days()) > now()
    ) then
      raise exception 'LIVESTOCK_COOLDOWN';
    end if;
  end if;

  update public.profiles
     set crime              = v_crime,
         age                = p_age,
         height_cm          = round(p_height_cm, 1),
         weight_kg          = round(p_weight_kg, 1),
         bio                = v_bio,
         livestock_consent  = p_livestock_consent
   where id = v_uid
  returning * into v_p;

  return app.state_json(v_p);
end;
$$;


-- -------------------------------------------------------------
-- 12. 게임 실행 (룰렛 · 슬롯머신)
--     한 판마다 플레이 횟수 1, 체력 1을 소모한다.
--     하이로우는 highlow_begin() 이 판을 열고 highlow_continue()/cashout() 이
--     이어받는다 — 1단계도 이제 패를 보고 고르므로 판정을 여기서 하지 않는다.
-- -------------------------------------------------------------
create or replace function public.play_game(
  p_game   text,
  p_bet    integer,
  p_choice text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_today  date := app.today_kst();

  v_payout  integer := 0;
  v_wage    integer := 0;
  v_outcome jsonb;

  v_slot  integer;
  v_color text;

  v_pool  text[] := array[
    'cherry','cherry','cherry','cherry','cherry','cherry',
    'lemon','lemon','lemon','lemon','lemon',
    'bell','bell','bell','bell',
    'star','star','star',
    'seven','seven',
    'diamond'
  ];
  v_r1 text; v_r2 text; v_r3 text;
  v_kind text;

  -- 키노: 1~40 에서 5개를 고르고 시설이 10개를 뽑는다.
  v_kn_picks int[];
  v_kn_draw  int[];
  v_kn_hits  int[];
  v_kn_n     integer;

  -- 추석 송편·네잎클로버가 얹어 주는 판돈(app.bonus_stake). 지급은 v_stake 기준, 코인은 p_bet 만 빠진다.
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
  if v_p.plays_used >= app.daily_play_limit() + v_p.bonus_plays + v_p.drug_plays
                        + app.chuseok_plays(v_p.chuseok_grade) then
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

    v_slot  := floor(random() * 15)::int;
    v_color := case when v_slot = 0 then 'green'
                    when v_slot <= 7 then 'red' else 'black' end;

    if p_choice in ('red', 'black', 'green') then
      if v_color = p_choice then
        v_payout := floor(v_stake * case when v_color = 'green' then 14.7 else 2.1 end)::int;
      end if;
    elsif v_slot = p_choice::int then
      v_payout := floor(v_stake * 14.7)::int;
    end if;

    v_outcome := jsonb_build_object('slot', v_slot, 'color', v_color);

  -- ---------------- 슬롯머신 ----------------
  elsif p_game = 'slots' then
    v_r1 := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];
    v_r2 := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];
    v_r3 := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];

    if v_r1 = v_r2 and v_r2 = v_r3 then
      v_kind := 'triple';
      v_payout := v_stake * case v_r1
                            when 'diamond' then 40 when 'seven' then 25
                            when 'star' then 12 when 'bell' then 8
                            when 'lemon' then 6 else 4 end;
    elsif v_r1 = v_r2 or v_r2 = v_r3 or v_r1 = v_r3 then
      v_kind := 'pair';
      v_payout := floor(v_stake * 1.45)::int;
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
    -- src/lib/game.ts 의 KENO_MULT 와 반드시 같은 값이어야 한다.
    v_payout := case v_kn_n
                  when 5 then v_stake * 60
                  when 4 then v_stake * 30
                  when 3 then v_stake * 15
                  when 2 then floor(v_stake * 1.5)::int
                  else 0 end;

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
  -- 일당은 나이트메어 2배 대상이 아니다. 승패와 무관하게, 판돈의 절반까지만 붙는 값이다.
  v_wage    := least(app.play_wage(v_p.coins), p_bet / 2);
  v_payout  := v_payout + v_wage;
  v_coins_after := v_p.coins - p_bet + v_payout;

  update public.profiles
     set coins      = v_coins_after,
         plays_used = v_p.plays_used + 1,
         last_reset = v_p.last_reset
   where id = v_uid
  returning * into v_p;

  -- 체력 소모 (0이 되면 병동으로 간다)
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
$$;


-- -------------------------------------------------------------
-- 13. 하이로우 - 시작
--     판돈을 걸고 패를 연다. 이 시점에 플레이 횟수 1, 체력 1, 일당을 정산한다.
--     여기서 끝나는 판정은 없으므로 game_rounds 는 남기지 않는다(사다리가 끝날
--     때 highlow_continue/highlow_cashout 이 한 번만 남긴다). 다만 코인은 여기서
--     움직이므로 원장(ledger)에는 '개시' 한 줄을 남긴다 — 안 남기면 사다리를
--     열어 둔 채 돌아오지 않은 판의 판돈이 어디에도 설명되지 않는다.
-- -------------------------------------------------------------
create or replace function public.highlow_begin(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
  if v_p.plays_used >= app.daily_play_limit() + v_p.bonus_plays + v_p.drug_plays
                        + app.chuseok_plays(v_p.chuseok_grade) then
    raise exception 'DAILY_LIMIT';
  end if;
  if p_bet > v_p.coins then raise exception 'NOT_ENOUGH_COINS'; end if;
  if v_p.hl_bet > 0 then raise exception 'HIGHLOW_IN_PROGRESS'; end if;

  -- 추석 송편·네잎클로버(app.bonus_stake): 첫 판정의 기준액에만 얹힌다(highlow_continue).
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

  -- 판돈은 여기서 빠지고 일당도 여기서 붙는다. 이 움직임을 적지 않으면 원장의
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


-- -------------------------------------------------------------
-- 14. 하이로우 - 판정 (0단계 포함) / 받기
--     highlow_begin() 이 연 판을 이어받는다. 0단계(패를 보고 첫 선택)든 사다리
--     도중이든 여기서 판정하며, 추가 판돈도 횟수도 체력도 더 쓰지 않는다.
-- -------------------------------------------------------------
create or replace function public.highlow_continue(p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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
    -- 0단계(첫 판정)의 기준액은 판돈(+ 추석 송편이 얹은 몫)이다. 그다음부터는 쌓인 적립금이 기준이다.
    v_pot := round((case when v_p.hl_stage = 0 then v_p.hl_bet + v_p.hl_bonus else v_p.hl_pot end)
                    * v_mult)::int;
    if v_stage >= app.hl_max_stage() then
      v_payout := v_pot;
      v_stage  := 0;
    end if;
  end if;

  v_payout := app.apply_win_double(v_uid, v_payout);
  -- 일당은 highlow_begin() 이 이미 지급했다. 여기서 코인을 더 주는 게 아니라,
  -- 이 판의 순이익을 제대로 적으려고 같은 공식으로 다시 구하기만 한다.
  -- 일당이 보유 코인에 따라 달라지므로 begin 이 적어 둔 hl_wage 를 그대로 쓴다.
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
            -- 일당 포함. play_game 이 넣는 payout 과 같은 뜻의 값이라야
            -- 실시간 피드의 payout - bet 이 상단 배너와 어긋나지 않는다.
            v_payout + v_wage, v_coins_after);

    perform app.log(v_uid, 'game', '하이로우 사다리', v_payout, v_coins_after,
      jsonb_build_object('bet', v_bet, 'outcome', v_outcome));
  end if;

  return app.state_json(v_p) || jsonb_build_object(
    'game', 'highlow', 'bet', 0, 'choice', p_choice,
    'outcome', v_outcome,
    -- 판이 끝난 판정에만 일당을 얹어 돌려준다. 사다리가 이어지는 중이면
    -- 상단 배너가 뜨지 않으므로(Casino.tsx 의 midLadder) 0 으로 둔다.
    'payout', case when v_stage = 0 then v_payout + v_wage else v_payout end,
    'net',    case when v_stage = 0 then v_payout + v_wage - v_bet else 0 end);
end;
$$;

create or replace function public.highlow_cashout()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
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


-- -------------------------------------------------------------
-- 15. (삭제됨) 상점의 회원권 판매와 대출 기능
--     거래소 개편으로 없앴다. 등급 변경은 admin_set_grade() 로만 한다.
--     loan_requests 테이블과 profiles.debt 는 기존 기록 보존을 위해 남겨 둔다.
-- -------------------------------------------------------------
drop function if exists public.buy_black_membership();
drop function if exists public.request_loan(integer);
drop function if exists public.repay_loan(integer);


-- -------------------------------------------------------------
-- 16. 배급소 - 아이템 사용 / 구매 / 판매 (시스템 상대)
-- -------------------------------------------------------------
-- 배급소는 사람마다 다른 물품이 올라온다.
-- 서로 필요한 것이 달라야 거래가 생기기 때문이다.
drop table if exists public.shop_daily;

create table if not exists public.shop_offers (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  codes   text[] not null,
  primary key (user_id, day)
);

-- 오늘 품목별로 이미 산 수량. { "code": qty } 형태로 쌓인다.
alter table public.shop_offers
  add column if not exists bought jsonb not null default '{}'::jsonb;

-- 오늘 훔치기를 이미 한 번 썼는지. 품목별이 아니라 배급소 전체에 하루 하나다.
-- 이 행 자체가 (user_id, day) 라 자정이 지나면 저절로 다시 false 가 된다.
alter table public.shop_offers
  add column if not exists steal_used boolean not null default false;

-- 그날 네잎클로버 할인가(app.clover_price). 목록이 뽑히는 순간의 보유 코인으로 정해지고
-- 그날은 바뀌지 않는다. null 이면 정가.
alter table public.shop_offers
  add column if not exists clover_price integer;

create or replace function app.shop_size() returns integer
  language sql immutable as $$ select 5 $$;

-- 사재기 방지: 품목당 하루 최대 구매 수량.
create or replace function app.shop_daily_cap() returns integer
  language sql immutable as $$ select 3 $$;

-- 품목별 하루 최대 구매 수량. 네잎클로버만 따로 적다(00_rules.sql 의 app.clover_daily_cap).
create or replace function app.shop_item_cap(p_code text) returns integer
  language sql immutable as $$
    select case when p_code = 'clover' then app.clover_daily_cap() else app.shop_daily_cap() end
  $$;

-- 고정으로 올라오는 물품은 없다. 다섯 칸 모두 뽑는다.
drop function if exists app.shop_fixed();

-- 등급 뽑기.
--   보통 칸: 기본 60 / 고급 30 / 희귀 10 / 특급 0    (병동·중독 가중: 55/25/10/10)
--   마지막 칸: 기본 30 / 고급 40 / 희귀 25 / 특급 5  (병동·중독 가중: 20/25/15/40)
-- 특급은 마지막 한 칸에서만 나온다. 화면에는 드러내지 않는다.
-- p_epic_boost 는 병동이거나 중독일 때만 true — 보장이 아니라 가중이다.
drop function if exists app.roll_grade(boolean);
create or replace function app.roll_grade(p_last boolean default false, p_epic_boost boolean default false)
returns text
language sql
volatile
as $$
  select case
           when p_last then
             case when p_epic_boost then
               case when r < 0.20 then 'common'
                    when r < 0.45 then 'uncommon'
                    when r < 0.60 then 'rare'
                    else 'epic' end
             else
               case when r < 0.30 then 'common'
                    when r < 0.70 then 'uncommon'
                    when r < 0.95 then 'rare'
                    else 'epic' end
             end
           else
             case when p_epic_boost then
               case when r < 0.55 then 'common'
                    when r < 0.80 then 'uncommon'
                    when r < 0.90 then 'rare'
                    else 'epic' end
             else
               case when r < 0.60 then 'common'
                    when r < 0.90 then 'uncommon'
                    else 'rare' end
             end
         end
    from (select random() as r) s;
$$;

-- p_uid 로 병동·중독 여부를 읽어 등급 가중과 후보 선택에 반영한다.
-- 보장이 아니라 가중이다 — 그래도 안 뜨면 거래로 구할 수 있다(둘 다 tradable).
drop function if exists app.roll_shop();
create or replace function app.roll_shop(p_uid uuid)
returns text[]
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_codes text[] := array[]::text[];
  v_have  integer := 0;
  v_grade text;
  v_code  text;
  v_try   integer;
  v_ward     boolean;
  v_addicted boolean;
  v_boost    boolean;
  v_coins    integer;
begin
  select (ward_until is not null),
         (drug_load >= app.drug_addict_threshold()),
         coins
    into v_ward, v_addicted, v_coins
    from public.profiles where id = p_uid;
  v_boost := coalesce(v_ward, false) or coalesce(v_addicted, false);
  v_coins := coalesce(v_coins, 0);

  -- 앞의 네 칸은 보통 표, 마지막 한 칸만 다른 표를 쓴다.
  v_try := 0;
  while v_have < app.shop_size() - 1 and v_try < 300 loop
    v_try := v_try + 1;
    v_grade := app.roll_grade(false, v_boost);

    -- 배급소는 배급소다. 식량·의약품 말고는 여기 올라오지 않는다.
    -- 병동이면 퇴원서, 중독이면 해독제 쪽으로 후보 선택을 당긴다(보장은 아니다).
    -- 네잎클로버는 가진 코인이 적은 사람에게만 오르고, 더 적으면 그쪽으로 당긴다
    -- (00_rules.sql 의 app.clover_* — 화면에는 드러내지 않는다).
    select code into v_code
      from public.item_defs
     where grade = v_grade and buy_price is not null
       and kind in ('food', 'medicine', 'charm')
       and not (code = any(v_codes))
       and (code <> 'clover' or v_coins <= app.clover_rich_cut())
     order by case when (v_ward and code = 'discharge')
                       or (v_addicted and code = 'detox')
                       or (v_coins <= app.clover_poor_line() and code = 'clover')
                   then random() * 0.1 else random() end
     limit 1;

    if v_code is not null then
      v_codes := v_codes || v_code;
      v_have  := v_have + 1;
    end if;
  end loop;

  v_try := 0;
  while v_have < app.shop_size() and v_try < 300 loop
    v_try := v_try + 1;
    v_grade := app.roll_grade(true, v_boost);

    select code into v_code
      from public.item_defs
     where grade = v_grade and buy_price is not null
       and kind in ('food', 'medicine', 'charm')
       and not (code = any(v_codes))
       and (code <> 'clover' or v_coins <= app.clover_rich_cut())
     order by case when (v_ward and code = 'discharge')
                       or (v_addicted and code = 'detox')
                       or (v_coins <= app.clover_poor_line() and code = 'clover')
                   then random() * 0.1 else random() end
     limit 1;

    if v_code is not null then
      v_codes := v_codes || v_code;
      v_have  := v_have + 1;
    end if;
  end loop;

  return v_codes;
end;
$$;

-- 그 사람의 오늘 물품. 자정(KST)이 지나면 새로 뽑힌다.
-- 낮에 병동에 들어가거나 중독되어도 그날 오퍼는 바뀌지 않는다 —
-- 가중은 다음 자정의 추첨부터 반영된다.
create or replace function app.shop_today(p_uid uuid)
returns text[]
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_day   date := app.today_kst();
  v_codes text[];
begin
  select codes into v_codes
    from public.shop_offers where user_id = p_uid and day = v_day;
  if v_codes is not null then return v_codes; end if;

  -- 네잎클로버 할인가도 목록과 같은 순간의 보유 코인으로 정해 둔다.
  insert into public.shop_offers (user_id, day, codes, clover_price)
  select p_uid, v_day, app.roll_shop(p_uid), app.clover_price(p.coins)
    from public.profiles p where p.id = p_uid
  on conflict (user_id, day) do nothing;

  select codes into v_codes
    from public.shop_offers where user_id = p_uid and day = v_day;
  return v_codes;
end;
$$;

create or replace function public.shop_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_codes  text[];
  v_bought jsonb;
  v_steal  boolean;
  v_clover integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  v_codes := app.shop_today(v_uid);

  select bought, steal_used, clover_price into v_bought, v_steal, v_clover from public.shop_offers
   where user_id = v_uid and day = app.today_kst();

  -- 정렬은 카탈로그 순서를 그대로 쓴다.
  -- 뽑힌 순서대로 늘어놓으면 마지막 칸이 어디인지 드러난다.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', code, 'name', name, 'kind', kind, 'grade', grade,
             'emoji', emoji, 'heal', heal, 'plays', plays,
             'ward_cut', ward_cut, 'win_double', win_double,
             -- 네잎클로버는 목록이 뽑힐 때 정해진 할인가가 있으면 그 값. 할인이면 정가를 list_price 로 함께 실어
             -- 화면에 할인으로 보이게 한다(정가 그대로면 null).
             'buy_price', case when code = 'clover' then coalesce(v_clover, buy_price) else buy_price end,
             'list_price', case when code = 'clover' and v_clover < buy_price then buy_price end,
             'sell_price', sell_price,
             'tradable', tradable, 'description', description,
             'daily_cap', app.shop_item_cap(code),
             'bought', coalesce((coalesce(v_bought, '{}'::jsonb)->>code)::int, 0),
             -- 시도권은 배급소 전체에 하나뿐이라 모든 항목에 같은 값이 실린다.
             -- 배열 모양을 그대로 두려고 이렇게 붙였다.
             'steal_used', coalesce(v_steal, false)
           ) order by sort_order, code)
      from public.item_defs
     where code = any(v_codes) and buy_price is not null), '[]'::jsonb);
end;
$$;


-- -------------------------------------------------------------
-- 16-1. 과시 상태 공용 도우미
--   두 곳(use_item 의 약물, flex_use)이 같은 규칙으로 player_flex 를 쓴다.
-- -------------------------------------------------------------

-- 인벤에서 1개를 덜어내되, 선물로 받은 몫(gifted_qty)부터 소모한다.
-- 돌려주는 값이 true 면 이번에 소모된 1개가 선물분이라는 뜻이다.
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

-- 절도비법(steal_trick) 확정 성공이 실제로 터질 때만 호출된다(shop_steal/
-- smuggle_steal 안에서). 장착만 해서는 소모되지 않는다 — 정본은
-- 16_steal_trick.sql, 여기는 그 사본이다.
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

-- 소모형(consume) 과시 상태를 올리거나 연장한다.
--   · 동시 소모 상태는 app.flex_consume_limit()(00_rules.sql)개까지 — 칸이 찬 채로
--     또 쓰면 가장 오래된 것을 밀어낸다.
--   · 같은 것을 또 쓰면 남은 시간이 늘지만 flex_hours 의 2배를 넘지 않는다.
--   · 약물(kind='drug')은 늘지 않고 새로 쓴 시각부터 flex_hours 를 다시 센다.
create or replace function app.flex_apply(p_uid uuid, p_code text, p_gifted boolean)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_def   public.item_defs;
  v_count integer;
begin
  select * into v_def from public.item_defs where code = p_code;
  if v_def.flex_kind is distinct from 'consume' then return; end if;

  select count(*) into v_count
    from public.player_flex f
    join public.item_defs d on d.code = f.item_code
   where f.user_id = p_uid and d.flex_kind = 'consume' and f.item_code <> p_code;

  if v_count >= app.flex_consume_limit() then
    delete from public.player_flex
     where user_id = p_uid and item_code = (
       select f.item_code from public.player_flex f
         join public.item_defs d on d.code = f.item_code
        where f.user_id = p_uid and d.flex_kind = 'consume' and f.item_code <> p_code
        order by f.started_at asc
        limit 1
     );
  end if;

  insert into public.player_flex (user_id, item_code, gifted, expires_at, started_at)
  values (p_uid, p_code, p_gifted, now() + make_interval(hours => v_def.flex_hours), now())
  on conflict (user_id, item_code) do update
     set gifted     = excluded.gifted,
         together   = false,
         expires_at = case when v_def.kind = 'drug'
                           then now() + make_interval(hours => v_def.flex_hours)
                           else least(
                             greatest(player_flex.expires_at, now()) + make_interval(hours => v_def.flex_hours),
                             now() + make_interval(hours => v_def.flex_hours * 2)
                           )
                      end;
end;
$$;

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

-- 누군가와 함께 쓰기(술·RP 약물·젤 중 flex_text_with 가 있는 것). 물건은 쓰는 사람 것
-- 하나만 빠지고, 효과·중독·부작용도 쓰는 사람에게만 — 고른 사람에게는 특이사항
-- 한 줄(flex_text_with)만 붙는다. 검증·소모·효과는 use_item/flex_use 를 그대로 탄다.
-- 음식(구운 고구마·생선)만 예외로, 고른 사람도 같은 체력·게임 횟수를 받는다 — 각자의
-- 체력 최대치와 하루 회복 상한(max_bonus_plays · max_extra_plays)은 따로 걸린다.
create or replace function public.use_together(p_code text, p_with text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid  uuid := auth.uid();
  v_def  public.item_defs;
  v_mate public.profiles;
  v_out  jsonb;
  v_p    public.profiles;
  v_mate_hp    integer;
  v_mate_plays integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.flex_text_with is null then raise exception 'NOT_SHAREABLE'; end if;

  select * into v_mate from public.profiles where username = p_with and not hidden;
  if not found then raise exception 'NO_SUCH_USER'; end if;
  if v_mate.id = v_uid then raise exception 'SELF_TARGET'; end if;
  -- 병동에선 특이사항이 가려진다. 화면은 애초에 병동 사람을 목록에서 빼지만,
  -- 팝업을 연 사이에 입원했을 수 있어 한 번 더 막는다.
  v_mate := app.accrue(v_mate.id);
  if v_mate.ward_until is not null then raise exception 'MATE_IN_WARD'; end if;

  if v_def.kind = 'food' then
    v_out := public.use_item(p_code);

    -- 고른 사람에게도 같은 효과. use_item 과 같은 식으로 상한을 건다.
    v_mate_plays := least(v_def.plays,
                          greatest(0, app.max_bonus_plays() - v_mate.bonus_plays),
                          greatest(0, app.max_extra_plays() - v_mate.bonus_plays - v_mate.drug_plays));
    v_mate_hp := least(app.hp_max(), v_mate.hp + v_def.heal) - v_mate.hp;
    update public.profiles
       set hp = hp + greatest(0, v_mate_hp),
           bonus_plays = bonus_plays + v_mate_plays
     where id = v_mate.id;

    -- 음식은 flex_kind 가 없어 flex_apply 가 아무것도 안 한다. 함께 먹었다는
    -- 한 줄만 두 사람에게 직접 1시간 붙인다(네잎클로버와 같은 방식 — 술·약물의
    -- 동시 칸 밀어내기에 끼지 않는다). app.accrue 가 만료되면 치운다.
    insert into public.player_flex (user_id, item_code, gifted, together, expires_at, started_at)
    values (v_uid, p_code, false, true, now() + interval '1 hour', now()),
           (v_mate.id, p_code, false, true, now() + interval '1 hour', now())
    on conflict (user_id, item_code) do update
       set together = true, gifted = false, stolen = false,
           expires_at = excluded.expires_at, started_at = excluded.started_at;

    select * into v_p from public.profiles where id = v_uid;
    return v_out || app.state_json(v_p)
                 || jsonb_build_object('with', v_mate.username,
                                       'mate_heal', greatest(0, v_mate_hp),
                                       'mate_plays', v_mate_plays);
  end if;

  v_out := case when v_def.kind = 'drug' then public.use_item(p_code)
                else public.flex_use(p_code) end;

  update public.player_flex set together = true
   where user_id = v_uid and item_code = p_code;

  perform app.flex_apply(v_mate.id, p_code, false);
  update public.player_flex set together = true
   where user_id = v_mate.id and item_code = p_code;

  -- use_item 이 실은 hp_before · hp_lost · plays_gained 는 남기고, 상태는 together 가
  -- 켜진 뒤로 다시 읽는다.
  select * into v_p from public.profiles where id = v_uid;
  return v_out || app.state_json(v_p) || jsonb_build_object('with', v_mate.username);
end;
$$;

-- 라이터로 생고구마·생선을 굽는다. 라이터는 소모되지 않고 보유만 본다(담배와 같다).
-- 선물로 받은 몫을 구웠으면 구운 것도 선물 몫으로 이어 받는다.
create or replace function public.roast_item(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_to     text;
  v_gifted boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  v_to := case p_code when 'sweet_potato_chestnut' then 'roast_potato_chestnut'
                      when 'sweet_potato_pumpkin'  then 'roast_potato_pumpkin'
                      when 'fish_mackerel'         then 'roast_fish_mackerel'
                      when 'fish_horse_mackerel'   then 'roast_fish_horse_mackerel' end;
  if v_to is null then raise exception 'NOT_ROASTABLE'; end if;
  if not app.has_lighter(v_uid) then raise exception 'NEED_LIGHTER'; end if;

  v_gifted := app.take_one_item(v_uid, p_code);

  insert into public.inventories (user_id, item_code, qty, gifted_qty)
  values (v_uid, v_to, 1, case when v_gifted then 1 else 0 end)
  on conflict (user_id, item_code)
    do update set qty        = inventories.qty + excluded.qty,
                  gifted_qty = inventories.gifted_qty + excluded.gifted_qty;

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

-- 우유에 커피·아이스 커피·루이보스티 중 하나를 섞는다. 둘 다 하나씩 거두고 섞은
-- 음료(카페라떼·아이스 카페라떼·밀크티) 하나를 준다. 우유가 선물 몫이었으면 섞은
-- 것도 선물 몫으로 이어 받는다. 섞은 셋은 flex_text_with 가 없어 함께 먹을 수 없다.
create or replace function public.mix_item(p_code text, p_with text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_to     text;
  v_gifted boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  if p_code is distinct from 'milk' then raise exception 'NOT_MIXABLE'; end if;
  v_to := case p_with when 'instant_coffee' then 'cafe_latte'
                      when 'ice_coffee'     then 'iced_latte'
                      when 'rooibos_tea'    then 'milk_tea' end;
  if v_to is null then raise exception 'NOT_MIXABLE'; end if;

  -- 어느 쪽이든 없으면 NOT_ENOUGH_ITEMS 로 막히고 트랜잭션째 되돌려진다.
  perform app.take_one_item(v_uid, p_with);
  v_gifted := app.take_one_item(v_uid, p_code);

  insert into public.inventories (user_id, item_code, qty, gifted_qty)
  values (v_uid, v_to, 1, case when v_gifted then 1 else 0 end)
  on conflict (user_id, item_code)
    do update set qty        = inventories.qty + excluded.qty,
                  gifted_qty = inventories.gifted_qty + excluded.gifted_qty;

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

-- 장착형 과시품(라이터·반지·시계·절도비법). 소모되지 않는다 — 해제할 때까지
-- 인벤에서 1개가 잠긴다(판매·거래 불가, sell_item/app.can_give 가 이 잠금을
-- 본다). 절도비법(item_defs.steal_sure)만 예외로, 장착이 profiles.steal_sure
-- 를 함께 켠다 — 물건 자체는 다음 훔치기가 확정 성공으로 실제로 터질 때
-- (app.consume_steal_trick)에야 비로소 소모된다.
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

create or replace function public.flex_unequip(p_code text)
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

  -- 겹쳐 장착한 것이면 하나만 벗는다.
  update public.player_flex set stack = stack - 1
   where user_id = v_uid and item_code = p_code and expires_at is null and stack > 1;
  if found then
    v_p := app.accrue(v_uid);
    return app.state_json(v_p);
  end if;

  delete from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at is null;
  if not found then raise exception 'NOT_EQUIPPED'; end if;

  -- 절도비법은 "장착 중"이어야 효과가 유지된다. 훔치기가 실제로 터지기
  -- 전에 해제하면 확정 성공 예약도 함께 꺼진다 — 안 그러면 장착 -> 해제로
  -- 잠금을 풀어 물건을 넘기고도 확정 성공만 챙기는 구멍이 생긴다.
  select * into v_def from public.item_defs where code = p_code;
  if v_def.steal_sure then
    update public.profiles set steal_sure = false where id = v_uid;
  end if;

  v_p := app.accrue(v_uid);
  return app.state_json(v_p);
end;
$$;

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

create or replace function public.buy_item(p_code text, p_qty integer default 1)
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
  v_price integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_qty is null or p_qty < 1 then raise exception 'INVALID_QTY'; end if;

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  if v_def.buy_price is null then raise exception 'NOT_BUYABLE'; end if;

  -- 오퍼 행이 있는지 먼저 보장한 뒤 잠근다 — 동시 구매로 bought 갱신이 겹쳐 쓰이지 않게.
  perform app.shop_today(v_uid);
  select * into v_offer from public.shop_offers
   where user_id = v_uid and day = app.today_kst() for update;

  -- 오늘 배급소에 올라온 물건만 살 수 있다.
  if not (p_code = any(v_offer.codes)) then raise exception 'NOT_IN_SHOP'; end if;

  v_had := coalesce((v_offer.bought->>p_code)::int, 0);
  if v_had + p_qty > app.shop_item_cap(p_code) then raise exception 'DAILY_ITEM_CAP'; end if;

  -- 네잎클로버는 목록이 뽑힐 때 정해진 할인가(shop_offers.clover_price)가 있으면 그 값.
  v_price := case when p_code = 'clover' then coalesce(v_offer.clover_price, v_def.buy_price)
                  else v_def.buy_price end;

  if v_p.coins < v_price * p_qty then raise exception 'NOT_ENOUGH_COINS'; end if;

  update public.profiles set coins = coins - v_price * p_qty
   where id = v_uid
  returning * into v_p;

  insert into public.inventories (user_id, item_code, qty)
  values (v_uid, p_code, p_qty)
  on conflict (user_id, item_code)
    do update set qty = inventories.qty + excluded.qty;

  update public.shop_offers
     set bought = bought || jsonb_build_object(p_code, v_had + p_qty)
   where user_id = v_uid and day = app.today_kst();

  perform app.log(v_uid, 'shop',
    format('%s %s개 구매', v_def.name, p_qty),
    -v_price * p_qty, v_p.coins,
    jsonb_build_object('code', p_code, 'qty', p_qty));

  return app.state_json(v_p);
end;
$$;


-- -------------------------------------------------------------
-- 16-3. 훔치기 — 배급소와 밀거래(05_smuggle.sql)가 나눠 쓴다
--
--   가진 게 적을수록 손이 잘 든다. 다만 물건 가액이 크면 상한이 걸린다 —
--   개인 거래로 코인을 잠시 남에게 넘겨 10코인 미만을 만든 뒤 퇴원서(300)·
--   해독제(400) 만 40%로 노리는 게 압도적으로 남는 장사가 되기 때문이다.
-- -------------------------------------------------------------

-- 배급소 기본 성공률
create or replace function app.shop_steal_base(p_coins integer) returns numeric
  language sql immutable as $$
    select case
             when coalesce(p_coins, 0) < 10 then 0.40
             when coalesce(p_coins, 0) < 20 then 0.25
             when coalesce(p_coins, 0) < 50 then 0.10
             else 0.03
           end
  $$;

-- 물건 가액에 따른 성공률 상한
create or replace function app.steal_value_cap(p_price integer) returns numeric
  language sql immutable as $$
    select case
             when coalesce(p_price, 0) <= 100 then 1.00
             when coalesce(p_price, 0) <= 200 then 0.10
             else 0.05
           end
  $$;

create or replace function app.steal_rate(p_base numeric, p_price integer) returns numeric
  language sql immutable as $$
    select least(p_base, app.steal_value_cap(p_price))
  $$;

-- 실패 벌칙. p_coin_base 까지는 코인에서 가져가고, 총합이 p_total 이 되도록
-- 나머지를 체력에서 가져간다. 코인이 모자라면 그만큼 체력 쪽이 커진다.
-- 체력마저 모자라면 체력 0 이 되어 app.spend_hp 가 병동 사다리로 보낸다 —
-- 그걸로 끝이고 코인을 더 가져가지는 않는다.
create or replace function app.steal_penalty(
  p_uid uuid, p_coin_base integer, p_total integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_p         public.profiles;
  v_coin_cut  integer;
  v_hp_before integer;
  v_hp_cut    integer;
begin
  select * into v_p from public.profiles where id = p_uid for update;

  -- coins_non_negative 제약이 걸려 있으므로 보유량을 넘겨 깎지 않는다.
  v_coin_cut  := least(greatest(v_p.coins, 0), greatest(p_coin_base, 0));
  v_hp_before := v_p.hp;

  if v_coin_cut > 0 then
    update public.profiles set coins = coins - v_coin_cut
     where id = p_uid
    returning * into v_p;
  end if;

  v_p      := app.spend_hp(p_uid, greatest(0, p_total - v_coin_cut));
  v_hp_cut := greatest(0, v_hp_before - v_p.hp);

  return jsonb_build_object(
    'coin_cut', v_coin_cut,
    'hp_cut',   v_hp_cut,
    'to_ward',  (v_p.ward_until is not null)
  );
end;
$$;

-- 배급소 훔치기. 하루 한 번(밀거래와는 별개의 시도권).
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
  -- 절도비법(steal_sure)을 미리 읽어 뒀으면 확률과 무관하게 성공하고,
  -- 그 자리에서 플래그가 꺼진다 — 오늘의 시도권은 평소대로 소모된다.
  if v_p.steal_sure then
    v_ok := true;
    update public.profiles set steal_sure = false where id = v_uid;
    perform app.consume_steal_trick(v_uid);
  else
    v_ok := random() < app.steal_rate(app.shop_steal_base(v_p.coins), v_def.buy_price);
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
-- 17. 관리자 페이지용 (브라우저에서 호출, 함수 안에서 관리자 확인)
-- -------------------------------------------------------------
drop function if exists public.panel_players();
drop function if exists public.panel_add_player(text, text);

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


-- 전체 아이템 목록 (지급 드롭다운용). 배급소 순환과 무관하게 전부 준다.
create or replace function public.panel_items()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
begin
  perform app.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', code, 'name', name, 'kind', kind, 'grade', grade,
             'emoji', emoji, 'heal', heal, 'plays', plays,
             'ward_cut', ward_cut, 'win_double', win_double,
             'buy_price', buy_price, 'sell_price', sell_price,
             'tradable', tradable, 'description', description
           ) order by sort_order, code)
      from public.item_defs), '[]'::jsonb);
end;
$$;

-- 관리자가 무언가를 주거나 거둘 때 붙이는 사유.
--   분류(category)는 셋 중 하나로 고정한다 — 유저 화면(Record.tsx)이 이 세 값에만
--   한글 이름을 붙이기 때문이다. 메모(note)는 자유 문장이고, 그대로 유저에게 보인다.
--   둘 다 생략할 수 있다(예전 호출·SQL Editor 에서 직접 부르던 호출).
create or replace function app.admin_reason(p_category text, p_note text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
begin
  if v_cat is not null and v_cat not in ('log', 'event', 'etc') then
    raise exception 'INVALID_REASON';
  end if;
  return jsonb_build_object('category', v_cat,
                            'note',     nullif(btrim(coalesce(p_note, '')), ''));
end;
$$;

-- 아이템 지급 (음수면 회수). 준 것도 거둔 것도 유저 화면 "수감기록 > 기록"에 남는다.
-- 인자를 늘렸으므로 옛 3-인자 함수를 먼저 지운다 — create or replace 는 인자 목록을
-- 바꾸지 못해서, 그냥 두면 오버로드 둘이 공존하며 호출이 모호해진다.
drop function if exists public.panel_give_item(text, text, integer);
create or replace function public.panel_give_item(
  p_name     text,
  p_code     text,
  p_qty      integer default 1,
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
  v_qty    integer;
  v_coins  integer;
  v_reason jsonb;
begin
  perform app.require_admin();
  if p_qty is null or p_qty = 0 then raise exception 'INVALID_QTY'; end if;
  v_reason := app.admin_reason(p_category, p_note);

  select id, coins into v_id, v_coins from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  select name, emoji into v_name, v_emoji from public.item_defs where code = p_code;
  if v_name is null then raise exception 'NO_SUCH_ITEM'; end if;

  insert into public.inventories (user_id, item_code, qty)
  values (v_id, p_code, greatest(0, p_qty))
  on conflict (user_id, item_code)
    do update set qty = greatest(0, inventories.qty + p_qty);

  select qty into v_qty
    from public.inventories where user_id = v_id and item_code = p_code;

  -- 코인은 움직이지 않으므로 delta 0, coin_after 에는 지금 잔액을 그대로 적는다.
  perform app.log(
    v_id, 'admin',
    format('%s %s %s개 %s', v_emoji, v_name, abs(p_qty),
           case when p_qty > 0 then '지급' else '회수' end),
    0, v_coins,
    v_reason || jsonb_build_object('code', p_code, 'qty', p_qty));

  return jsonb_build_object('name', btrim(p_name), 'item', v_name, 'qty', v_qty);
end;
$$;

-- 한 사람의 현재 상태와 소지품, 최근 기록
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


-- 게임 횟수 조절
--   오늘 쓴 횟수를 0으로 되돌리거나, 기본 한도 위로 더 얹어 준다.
--   아이템의 하루 상한(app.max_bonus_plays)은 여기에 적용되지 않는다.
create or replace function public.panel_reset_plays(p_name text)
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

  -- 날짜가 넘어간 상태라면 먼저 정리해서 조절값이 곧바로 지워지지 않게 한다.
  perform app.accrue(v_id);

  update public.profiles set plays_used = 0 where id = v_id
  returning * into v_p;

  return jsonb_build_object(
    'name', v_p.username,
    'plays_used', v_p.plays_used,
    'bonus_plays', v_p.bonus_plays,
    'plays_left', greatest(0, app.daily_play_limit() + v_p.bonus_plays - v_p.plays_used));
end;
$$;

-- 배정 횟수 지급 (음수면 회수). 코인은 움직이지 않지만 기록에는 남는다.
drop function if exists public.panel_give_plays(text, integer);
create or replace function public.panel_give_plays(
  p_name     text,
  p_amount   integer,
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
  v_p      public.profiles;
  v_reason jsonb;
begin
  perform app.require_admin();
  if p_amount is null or p_amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_reason := app.admin_reason(p_category, p_note);

  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  perform app.accrue(v_id);

  update public.profiles
     set bonus_plays = greatest(0, bonus_plays + p_amount)
   where id = v_id
  returning * into v_p;

  perform app.log(
    v_id, 'admin',
    format('배정 횟수 %s회 %s', abs(p_amount),
           case when p_amount > 0 then '지급' else '회수' end),
    0, v_p.coins,
    v_reason || jsonb_build_object('plays', p_amount));

  return jsonb_build_object(
    'name', v_p.username,
    'plays_used', v_p.plays_used,
    'bonus_plays', v_p.bonus_plays,
    'plays_left', greatest(0, app.daily_play_limit() + v_p.bonus_plays - v_p.plays_used));
end;
$$;

create or replace function public.panel_add_player(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_code text;
begin
  perform app.require_admin();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'INVALID_NAME'; end if;
  if exists (select 1 from public.profiles where username = btrim(p_name)) then
    raise exception 'NAME_TAKEN';
  end if;

  v_code := app.gen_code(btrim(p_name));
  perform public.admin_create_player(p_name, v_code);

  -- 계정(프로필) 행은 auth.users 트리거가 만드므로 그 다음에 수용실을 배정한다.
  -- (숨김 계정은 트리거가 이미 cell_id 를 null 로 남겨 두므로 여기서 건드리지 않는다)
  update public.profiles set cell_id = app.assign_cell()
   where username = btrim(p_name) and cell_id is null and not hidden;

  return jsonb_build_object('name', btrim(p_name), 'code', v_code);
end;
$$;

-- 이름과 코드가 모두 맞아야 지운다. 본인 계정은 지울 수 없다.
create or replace function public.panel_delete_player(p_name text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id uuid;
begin
  perform app.require_admin();

  select p.id into v_id
    from public.profiles p
    join public.player_codes c on c.user_id = p.id
   where p.username = btrim(p_name) and c.code = upper(btrim(p_code));

  if v_id is null then raise exception 'NAME_CODE_MISMATCH'; end if;
  if v_id = auth.uid() then raise exception 'CANNOT_DELETE_SELF'; end if;

  perform public.admin_delete_player(p_name);

  return jsonb_build_object('name', btrim(p_name));
end;
$$;

-- 코인 지급 (음수면 회수). 사유는 유저 화면 "수감기록 > 기록"에 그대로 뜬다.
drop function if exists public.panel_grant_coins(text, integer);
create or replace function public.panel_grant_coins(
  p_name     text,
  p_amount   integer,
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
  v_before integer;
  v_coins  integer;
  v_delta  integer;
  v_reason jsonb;
begin
  perform app.require_admin();
  if p_amount is null or p_amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_reason := app.admin_reason(p_category, p_note);

  select id, coins into v_id, v_before
    from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  update public.profiles set coins = greatest(0, coins + p_amount)
   where id = v_id
  returning coins into v_coins;

  -- 잔액이 0에서 걸리면 실제로 움직인 양이 p_amount 보다 적다. 장부에는
  -- 요청한 값이 아니라 실제로 움직인 값을 적는다.
  v_delta := v_coins - v_before;

  perform app.log(
    v_id, 'admin',
    format('코인 %s개 %s', abs(v_delta),
           case when v_delta >= 0 then '지급' else '회수' end),
    v_delta, v_coins, v_reason);

  return jsonb_build_object('name', btrim(p_name), 'coins', v_coins);
end;
$$;

-- 아이템 회수 — 부정 수급 조사 등으로 특정 개수만 정확히 되가져올 때 쓴다.
-- 사유 어휘는 지급 쪽(panel_give_item · panel_grant_coins)과 같은 것을 쓴다.
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

-- 계정 정지 — 일수를 지정해 게임·거래·상점·대전을 막는다. 진정함은 열려 있다.
-- 이미 정지 중이면 지금부터 새로 센다(연장이 아니라 재설정).
create or replace function public.panel_suspend(
  p_name   text,
  p_days   integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id     uuid;
  v_until  timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_coins  integer;
begin
  perform app.require_admin();
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'INVALID_DAYS'; end if;

  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;
  if v_id = auth.uid() then raise exception 'CANNOT_SUSPEND_SELF'; end if;

  v_until := now() + make_interval(days => p_days);

  -- 정지 전까지의 체력·식사를 먼저 정산한다. 정지 중에는 둘 다 멈춘다(app.accrue).
  perform app.accrue(v_id);

  update public.profiles
     set suspended_until = v_until, suspend_reason = v_reason
   where id = v_id
  returning coins into v_coins;

  perform app.log(
    v_id, 'admin', format('수감 정지 %s일', p_days), 0, v_coins,
    jsonb_build_object('days', p_days, 'reason', v_reason, 'until', v_until)
  );

  return jsonb_build_object(
    'name', btrim(p_name),
    'suspended_until', v_until,
    'suspend_reason', v_reason
  );
end;
$$;

create or replace function public.panel_unsuspend(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id    uuid;
  v_coins integer;
begin
  perform app.require_admin();

  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  -- 정지 칸을 지우기 전에 정산해 체력·식사 시계를 지금으로 당겨 둔다 —
  -- 먼저 지우면 정지 기간이 한꺼번에 계산된다(app.accrue).
  perform app.accrue(v_id);

  update public.profiles
     set suspended_until = null, suspend_reason = null
   where id = v_id
  returning coins into v_coins;

  perform app.log(v_id, 'admin', '정지 해제', 0, v_coins, '{}'::jsonb);

  return jsonb_build_object('name', btrim(p_name));
end;
$$;


-- -------------------------------------------------------------
-- 18. RLS
-- -------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.game_rounds   enable row level security;
alter table public.loan_requests enable row level security;
alter table public.inventories   enable row level security;
alter table public.item_defs     enable row level security;
alter table public.ledger        enable row level security;
-- 배급소 목록은 shop_catalog() 로만 나간다.
alter table public.shop_offers   enable row level security;
-- 코드 보관 테이블은 정책을 만들지 않는다 (panel_players 로만 조회)
alter table public.player_codes  enable row level security;
-- 수용실 배정 테이블도 정책을 만들지 않는다 (app.state_json / inmate_roster 로만 조회)
alter table public.cells         enable row level security;
-- 주간 재배치 기록도 마찬가지 (서버만 읽고 쓴다)
alter table public.cell_rotations enable row level security;
alter table public.player_flex   enable row level security;

-- hidden 계정(관리자 페르소나)은 다른 유저의 profiles select 에서 아예 빠진다.
-- security definer RPC(get_my_state, panel_* 등)는 RLS 를 우회하므로
-- 본인 화면과 관리자 단말은 영향을 받지 않는다.
drop policy if exists "profiles are readable by logged in users" on public.profiles;
create policy "profiles are readable by logged in users"
  on public.profiles for select to authenticated using (not hidden);

-- RLS는 행만 가릴 뿐 열은 못 가린다. is_admin 을 포함한 다른 모든 열은
-- state_json()/inmate_roster() 같은 RPC(security definer)로만 나가야 하므로,
-- 클라이언트가 테이블을 직접 select 할 때는 순위표(Leaderboard.tsx)가
-- 실제로 쓰는 두 열만 보이게 한다. 이게 없으면
-- 로그인한 아무나 브라우저 콘솔에서 `select is_admin from profiles` 로
-- 관리자를 특정할 수 있다.
revoke select on public.profiles from authenticated;
grant select (username, coins) on public.profiles to authenticated;

-- hidden 계정이 플레이한 판, 또는 hidden 계정을 상대로 한 1:1 대전 기록은
-- 실시간 피드(LiveFeed)에서 빠진다. outcome->>'vs' 는 1:1 대전이 상대 이름을
-- 담아 두는 자리다. profiles 를 직접 서브쿼리하지 않고 반드시
-- app.is_hidden_uid/name() 을 거친다(위 함수 주석 참고).
drop policy if exists "rounds are readable by logged in users" on public.game_rounds;
create policy "rounds are readable by logged in users"
  on public.game_rounds for select to authenticated
  using (
    not app.is_hidden_uid(user_id)
    and not app.is_hidden_name(coalesce(outcome->>'vs', ''))
  );

drop policy if exists "own loan requests are readable" on public.loan_requests;
create policy "own loan requests are readable"
  on public.loan_requests for select to authenticated using (user_id = auth.uid());

-- 아이템 카탈로그는 모두가 읽어도 되는 공개 정보
drop policy if exists "item defs are readable" on public.item_defs;
create policy "item defs are readable"
  on public.item_defs for select to authenticated using (true);

-- 가방은 본인 것만
drop policy if exists "own inventory is readable" on public.inventories;
create policy "own inventory is readable"
  on public.inventories for select to authenticated using (user_id = auth.uid());

-- 원장도 본인 것만
drop policy if exists "own ledger is readable" on public.ledger;
create policy "own ledger is readable"
  on public.ledger for select to authenticated using (user_id = auth.uid());

-- 과시 상태는 본인 것만 테이블로 직접 읽을 수 있다. 남의 것은 문장으로만
-- inmate_roster() 가 내보낸다(만료 시각·품목 코드는 노출하지 않는다).
drop policy if exists "own flex is readable" on public.player_flex;
create policy "own flex is readable"
  on public.player_flex for select to authenticated using (user_id = auth.uid());

-- insert/update/delete 정책은 만들지 않는다 => 클라이언트가 직접 못 바꾼다.


-- -------------------------------------------------------------
-- 19. 실행 권한
-- -------------------------------------------------------------
revoke all on function app.accrue(uuid)                      from public, anon, authenticated;
revoke all on function app.has_food(uuid)                    from public, anon, authenticated;
revoke all on function app.apply_win_double(uuid, integer)   from public, anon, authenticated;
revoke all on function app.roll_shop(uuid)                    from public, anon, authenticated;
revoke all on function app.shop_item_cap(text)               from public, anon, authenticated;
revoke all on function app.roll_grade(boolean, boolean)       from public, anon, authenticated;
revoke all on function app.shop_today(uuid)                  from public, anon, authenticated;
revoke all on function app.spend_hp(uuid, integer)           from public, anon, authenticated;
revoke all on function app.in_withdrawal(public.profiles)     from public, anon, authenticated;
revoke all on function app.addict_lines(public.profiles)      from public, anon, authenticated;
revoke all on function app.shop_steal_base(integer)           from public, anon, authenticated;
revoke all on function app.steal_value_cap(integer)           from public, anon, authenticated;
revoke all on function app.steal_rate(numeric, integer)       from public, anon, authenticated;
revoke all on function app.steal_penalty(uuid, integer, integer) from public, anon, authenticated;
revoke all on function app.meal_slots(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.special_meal_date()               from public, anon, authenticated;
revoke all on function app.special_meal_item()               from public, anon, authenticated;
revoke all on function app.meal_item_at(timestamptz)         from public, anon, authenticated;
revoke all on function app.require_admin()                   from public, anon, authenticated;
revoke all on function app.gen_code(text)                    from public, anon, authenticated;
revoke all on function app.name_no(text)                     from public, anon, authenticated;
revoke all on function app.hidden_name()                     from public, anon, authenticated;
revoke all on function app.cell_capacity()                   from public, anon, authenticated;
revoke all on function app.cell_label(smallint, smallint)    from public, anon, authenticated;
revoke all on function app.assign_cell()                     from public, anon, authenticated;
revoke all on function app.cell_week_kst()                   from public, anon, authenticated;
revoke all on function app.cell_rotate()                     from public, anon, authenticated;
revoke all on function app.pick_shuffled(integer, integer, integer)
                                                             from public, anon, authenticated;

revoke all on function public.play_game(text, integer, text) from public;
revoke all on function public.get_my_state()                 from public;
revoke all on function public.highlow_begin(integer)          from public;
revoke all on function public.highlow_continue(text)         from public;
revoke all on function public.highlow_cashout()              from public;
revoke all on function app.log(uuid, text, text, integer, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.shop_catalog()                 from public;
revoke all on function public.use_item(text)                 from public;
revoke all on function public.sell_item(text, integer)       from public;
revoke all on function public.buy_item(text, integer)        from public;
revoke all on function public.shop_steal(text)               from public;
revoke all on function public.flex_use(text)                 from public;
revoke all on function public.use_together(text, text)     from public;
revoke all on function public.roast_item(text)               from public;
revoke all on function public.mix_item(text, text)           from public;
revoke all on function public.flex_equip(text)               from public;
revoke all on function public.flex_unequip(text)             from public;
revoke all on function public.panel_players()                from public;
revoke all on function public.panel_add_player(text)         from public;
revoke all on function public.panel_grant_coins(text, integer, text, text) from public;
revoke all on function public.panel_reset_plays(text)        from public;
revoke all on function public.panel_give_plays(text, integer, text, text) from public;
revoke all on function public.panel_items()                  from public;
revoke all on function public.panel_give_item(text, text, integer, text, text) from public;
revoke all on function public.panel_player(text)             from public;
revoke all on function public.panel_delete_player(text, text) from public;
revoke all on function public.panel_take_item(text, text, integer, text, text) from public;
revoke all on function app.admin_reason(text, text)           from public, anon, authenticated;
revoke all on function public.panel_suspend(text, integer, text) from public;
revoke all on function public.panel_unsuspend(text) from public;
revoke all on function public.set_profile_details(text, integer, numeric, numeric, text, boolean) from public;

grant execute on function public.play_game(text, integer, text) to authenticated;
grant execute on function public.get_my_state()                 to authenticated;
grant execute on function public.set_profile_details(text, integer, numeric, numeric, text, boolean) to authenticated;
grant execute on function public.highlow_begin(integer)          to authenticated;
grant execute on function public.highlow_continue(text)         to authenticated;
grant execute on function public.highlow_cashout()              to authenticated;
grant execute on function public.shop_catalog()                 to authenticated;
grant execute on function public.use_item(text)                 to authenticated;
grant execute on function public.sell_item(text, integer)       to authenticated;
grant execute on function public.buy_item(text, integer)        to authenticated;
grant execute on function public.shop_steal(text)               to authenticated;
grant execute on function public.flex_use(text)                 to authenticated;
grant execute on function public.use_together(text, text)     to authenticated;
grant execute on function public.roast_item(text)               to authenticated;
grant execute on function public.mix_item(text, text)           to authenticated;
grant execute on function public.flex_equip(text)               to authenticated;
grant execute on function public.flex_unequip(text)             to authenticated;
grant execute on function public.panel_players()                  to authenticated;
grant execute on function public.panel_add_player(text)           to authenticated;
grant execute on function public.panel_grant_coins(text, integer, text, text) to authenticated;
grant execute on function public.panel_reset_plays(text)          to authenticated;
grant execute on function public.panel_give_plays(text, integer, text, text)  to authenticated;
grant execute on function public.panel_items()                    to authenticated;
grant execute on function public.panel_give_item(text, text, integer, text, text) to authenticated;
grant execute on function public.panel_player(text)               to authenticated;
grant execute on function public.panel_delete_player(text, text)  to authenticated;
grant execute on function public.panel_take_item(text, text, integer, text, text) to authenticated;
grant execute on function public.panel_suspend(text, integer, text) to authenticated;
grant execute on function public.panel_unsuspend(text) to authenticated;


-- -------------------------------------------------------------
-- 20. 실시간 피드용 publication
-- -------------------------------------------------------------
do $$
begin
  execute 'alter publication supabase_realtime add table public.game_rounds';
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;


-- -------------------------------------------------------------
-- 21. 주기 작업(pg_cron) — 수용실 주간 재배치
--
--   일요일 21:05 UTC = 월요일 06:05 KST. cron 표현식은 DB 의 timezone
--   설정(Supabase 기본값 UTC)을 따르므로, 실행 전 `show timezone;` 으로
--   UTC 인지 확인한다.
--
--   정각(21:00)이 아니라 5분 뒤로 잡은 이유: 조금이라도 일찍 튀면
--   app.cell_week_kst() 가 아직 지난주를 가리켜 그 주 재배치를 통째로
--   건너뛰게 된다.
--
--   pg_cron 은 Supabase 대시보드 Database > Extensions 에서 켜야 한다.
--   꺼져 있어도 아래 블록은 경고만 남기고 넘어가므로 이 파일 전체는 끝까지
--   실행된다. 확장을 켠 뒤 이 절만 다시 돌리면 예약이 걸린다.
-- -------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise warning 'pg_cron 확장을 만들지 못했습니다: %', sqlerrm;
end;
$$;

do $$
begin
  perform cron.unschedule('cell-rotate-weekly');
exception when others then
  null;  -- 예약이 아직 없으면 그냥 넘어간다
end;
$$;

do $$
begin
  perform cron.schedule('cell-rotate-weekly', '5 21 * * 0', 'select app.cell_rotate();');
  raise notice '수용실 주간 재배치 예약 완료 — 일 21:05 UTC = 월 06:05 KST';
exception when others then
  raise warning 'pg_cron 예약 실패: % / 대시보드에서 pg_cron 을 켠 뒤 이 절만 다시 실행하세요.', sqlerrm;
end;
$$;
