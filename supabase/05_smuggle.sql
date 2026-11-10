-- =============================================================
--  MINI CASINO - 밀거래 (거래소 > 밀거래)
--
--  실행 순서: 02_schema.sql -> 03_pvp.sql -> 04_trade.sql -> 05_smuggle.sql -> ...
--
--  흐름
--    1) 미해금 상태에서 라스트 카드(purpose='unlock')를 이겨야 밀거래가 열린다.
--    2) 해금되면 그날부터 매일(KST) app.roll_smuggle() 로 app.smuggle_size() 칸이 새로 뽑힌다.
--       배급소와 달리 식량·의약품은 빠지고 등급도 더 좋게 나온다.
--    3) 라스트 카드(purpose='special')를 이기면 그날 상시분에 없는 물건
--       app.smuggle_special_size() 칸(칸마다 특급 정가 · 중급 할인 · 절도비법)이
--       한꺼번에 열린다. 하루에 한 번 열리면 그걸로 끝이다.
--    4) 라스트 카드는 마지막으로 붙은 시각에서 5시간이 지나야 다시 걸 수 있다.
--       해금 승부와 특별 상품 승부가 그 쿨다운 하나를 같이 쓴다. 카운터도
--       날짜도 두지 않고 lastcard_games.created_at 하나로 판정한다.
--
--  라스트 카드 승률은 의도적으로 50%다. 뒤집기 같은 되돌리기 수단이 없어서
--  1~9 아홉 장 중 3장씩 나눠 갖는 이 구조에서는 어떤 순서로 내든 기댓값이
--  똑같다(시뮬레이션으로 확인함). NPC 행동패턴 4종 + 20% 이탈 확률은 승률을
--  조절하는 손잡이가 아니라, 매판 같은 수를 반복해서 읽히지 않게 하는
--  연출 장치일 뿐이다.
-- =============================================================

create table if not exists public.smuggle_state (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  unlocked_day date
);

create table if not exists public.smuggle_offers (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  codes         text[] not null,
  special_code  text references public.item_defs(code),
  special_kind  text check (special_kind in ('grade', 'sale', 'trick')),
  special_price integer,
  special_open  boolean not null default false,
  primary key (user_id, day)
);

-- create table if not exists 는 이미 있는 테이블의 제약조건을 갱신하지
-- 않는다. 절도비법(special_kind='trick')을 추가하려면 여기서 다시 걸어야
-- 한다.
alter table public.smuggle_offers drop constraint if exists smuggle_offers_special_kind_check;
alter table public.smuggle_offers add constraint smuggle_offers_special_kind_check
  check (special_kind in ('grade', 'sale', 'trick'));

-- 그날 가져간 품목(상시분 + 특별 상품 포함). 한 번 사면 그날은 다시 못 산다.
alter table public.smuggle_offers
  add column if not exists bought text[] not null default '{}';

-- 그날 훔치기를 이미 한 번 썼는지. 배급소 시도권과는 완전히 별개다.
-- 이 행 자체가 (user_id, day) 라 자정이 지나면 저절로 다시 false 가 된다.
alter table public.smuggle_offers
  add column if not exists steal_used boolean not null default false;

-- 그날 상시분을 돈 내고 한 번 갈아엎었는지(public.smuggle_reroll). 자정이 지나면
-- 새 행이 생기므로 저절로 다시 false 다.
alter table public.smuggle_offers
  add column if not exists rerolled boolean not null default false;

-- 그날의 특별 상품 칸들 — [{code, kind, price}, …], app.smuggle_special_size() 개까지.
-- 승부를 이기면(special_open) 전부 한꺼번에 열린다. 예전에는 한 칸이라
-- special_code/kind/price 세 컬럼에 담았다 — 2026-11-07 부터 쓰지 않는다
-- (repair/2026-11-07_smuggle_specials_cat_paw.sql 이 그날 행을 옮겨 담았다).
alter table public.smuggle_offers
  add column if not exists specials jsonb not null default '[]'::jsonb;

-- 약물별 누적 구매 장부(가격 누진, app.drug_price). 밀거래로 사거나 훔칠 때마다
-- 그 약물 행만 1 씩 오른다 — 러시를 사도 블러드 값은 그대로다. 해독제로도
-- 지워지지 않는다. 2026-10-12 이전의 profiles.drug_bought(모든 약물 공용,
-- dose 만큼 쌓임)를 대신한다.
create table if not exists public.drug_purchases (
  user_id   uuid not null references auth.users(id) on delete cascade,
  item_code text not null references public.item_defs(code) on delete cascade,
  bought    integer not null default 0 check (bought >= 0),
  primary key (user_id, item_code)
);

create table if not exists public.lastcard_games (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  purpose     text not null check (purpose in ('unlock', 'special')),
  my_cards    integer[] not null,
  npc_cards   integer[] not null,
  pattern     text not null
              check (pattern in ('conservative', 'aggressive', 'gambler', 'balanced')),
  my_played   integer[] not null default '{}',
  npc_played  integer[] not null default '{}',
  -- 라운드별 승자. 'me' | 'npc'. 카드가 전부 다르므로 무승부는 없다.
  results     text[] not null default '{}',
  status      text not null default 'playing'
              check (status in ('playing', 'won', 'lost')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 쿨다운은 시각 비교로 판정한다. 인덱스는 판이 둘 이상 동시에 열리는 것만 막는다.
drop index if exists public.lastcard_one_per_day;

-- 날짜로 가르던 시절에는 자정을 넘기면 안 끝난 판을 둔 채 새 판을 열 수 있었다.
-- 아래 인덱스가 걸리도록, 사람마다 가장 최근 한 판만 남기고 나머지는 접는다.
update public.lastcard_games g
   set status = 'lost', updated_at = now()
 where g.status = 'playing'
   and exists (
     select 1 from public.lastcard_games h
      where h.user_id = g.user_id
        and h.status = 'playing'
        -- created_at 이 같은 행이 있어도 하나만 남도록 id 로 갈라 준다
        and (h.created_at, h.id) > (g.created_at, g.id)
   );

create unique index if not exists lastcard_one_playing
  on public.lastcard_games (user_id) where status = 'playing';

alter table public.smuggle_state  enable row level security;
alter table public.smuggle_offers enable row level security;
alter table public.lastcard_games enable row level security;
alter table public.drug_purchases enable row level security;
-- 정책 없음: smuggle_* / lastcard_* 함수로만 접근한다.

-- 이 사람이 이 약물을 지금까지 몇 번 가져갔는지(app.drug_price 의 두 번째 인자).
create or replace function app.drug_bought(p_uid uuid, p_code text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select bought from public.drug_purchases
                    where user_id = p_uid and item_code = p_code), 0);
$$;


-- -------------------------------------------------------------
-- 1. 밀거래 상시분 뽑기 — 몇 칸인지는 app.smuggle_size() 하나가 쥔다
--    배급소(app.roll_shop)와 반대로 식량·의약품은 빠지고, 등급 분포도
--    배급소보다 좋게 잡는다(특급이 배급소에선 안 나온다). 정식 배급이
--    아니라는 걸 물건으로 보여준다.
-- -------------------------------------------------------------
create or replace function app.smuggle_size() returns integer
  language sql immutable as $$ select 5 $$;

-- 승부를 이기면 열리는 특별 상품 칸 수(가축 지목권·호칭권은 따로 붙는다).
create or replace function app.smuggle_special_size() returns integer
  language sql immutable as $$ select 3 $$;

-- 가축 지목권 값. 배급·밀거래 상시분·특별 상품 추첨과 무관하게 여기서만 정한다.
create or replace function app.livestock_pass_price() returns integer
  language sql immutable as $$ select 500 $$;

-- 가축 지목권은 살 때마다 이만큼 오른다(profiles.livestock_bought 장부).
create or replace function app.livestock_pass_step() returns integer
  language sql immutable as $$ select 100 $$;

-- 가축 지목권 값은 여기까지 오르고, 이 값에 산 다음 구매는 다시 기본가다.
-- 500 → 600 → 700 → 800 → 900 → 500 → …
create or replace function app.livestock_pass_max() returns integer
  language sql immutable as $$ select 900 $$;

-- 지금 유효한 구매 횟수 — 기본가부터 상한까지 한 바퀴(5회)를 돌면 0 으로 돌아온다.
-- p_at(마지막 구매 시각)은 쓰지 않지만 호출부를 그대로 두려고 시그니처에 남긴다.
create or replace function app.livestock_pass_count(p_bought integer, p_at timestamptz)
returns integer
  language sql stable as $$
    select coalesce(p_bought, 0)
         % ((app.livestock_pass_max() - app.livestock_pass_price()) / app.livestock_pass_step() + 1)
  $$;

-- 이 사람이 다음에 낼 가축 지목권 값. 표시가(smuggle_state)와 결제(smuggle_buy)가 함께 쓴다.
create or replace function app.livestock_pass_price(p_bought integer, p_at timestamptz)
returns integer
  language sql stable as $$
    select app.livestock_pass_price()
         + app.livestock_pass_step() * app.livestock_pass_count(p_bought, p_at)
  $$;

-- 호칭권 값. 가축 지목권과 같은 자리(특별 상품이 열린 날)에 나란히 뜨지만
-- 값은 따로 정한다.
create or replace function app.title_pass_price() returns integer
  language sql immutable as $$ select 150 $$;

-- 상시분 다시 보기 값. 하루 한 번, 처음 뜬 칸·특별 상품과 겹치지 않는 새 칸으로
-- 통째로 갈아엎는다(public.smuggle_reroll).
create or replace function app.smuggle_reroll_price() returns integer
  language sql immutable as $$ select 30 $$;

-- 라스트 카드를 다시 걸 수 있게 되기까지의 간격. 해금 승부와 특별 상품 승부가
-- 이 하나를 같이 쓴다.
create or replace function app.lastcard_cooldown() returns interval
  language sql immutable as $$ select interval '5 hours' $$;

-- 등급을 먼저 뽑고, 그 등급 안에서는 app.roll_smuggle() 이 균등하게 하나를
-- 고른다. 그래서 개당 확률은 아래 가중치를 그 등급의 풀 크기로 나눈 값이다 —
-- 등급이 좋다고 더 잘 뜨는 구조가 아니다. 지금 풀(71종: common 14 /
-- uncommon 16 / rare 20 / epic 21) 기준 개당 확률은 고급 2.50% > 희귀 1.50% >
-- 일반 1.43% > 특급 0.48%. 어떤 등급에 물건을 더하면 그 등급이 통째로 묽어지므로,
-- 카탈로그(17_items.sql)를 늘릴 때는 등급별 개수의 균형을 같이 본다.
create or replace function app.roll_smuggle_grade()
returns text
language sql
volatile
as $$
  select case
           when r < 0.20 then 'common'
           when r < 0.60 then 'uncommon'
           when r < 0.90 then 'rare'
           else 'epic'
         end
    from (select random() as r) s;
$$;

-- p_exclude 에 든 코드는 뽑지 않는다(다시 보기가 처음 칸·특별 상품을 넘긴다).
-- 인자가 생기면서 시그니처가 바뀌었으므로 옛 무인자 버전을 먼저 지운다.
drop function if exists app.roll_smuggle();

create or replace function app.roll_smuggle(p_exclude text[] default '{}')
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
  v_try   integer := 0;
begin
  while v_have < app.smuggle_size() and v_try < 300 loop
    v_try := v_try + 1;
    v_grade := app.roll_smuggle_grade();

    select code into v_code
      from public.item_defs
     where grade = v_grade and buy_price is not null
       and kind not in ('food', 'medicine', 'charm')
       and not (code = any(v_codes || coalesce(p_exclude, '{}')))
     order by random()
     limit 1;

    if v_code is not null then
      v_codes := v_codes || v_code;
      v_have  := v_have + 1;
    end if;
  end loop;

  return v_codes;
end;
$$;

-- app.roll_special(오늘 상시분에 없는 물건 한 칸 뽑기)의 정본은 16_steal_trick.sql 이다.
-- 여기 있던 사본은 16 과 같은 본문이 두 곳에 있던 것이라 지웠다 — APPLY.md
-- "함수 몸통은 한 파일에만 둔다" 참고. 아래 함수들은 몸통에서만 부르므로 16 이
-- 이 파일보다 뒤에 돌아도 된다.

-- 오늘 특별 상품 칸들. app.roll_special 을 app.smuggle_special_size() 번 부르되,
-- 매번 상시분과 이미 뽑은 칸을 빼고 뽑아 같은 물건이 두 번 서지 않는다.
-- 후보가 떨어져 null 이 나오면 그 칸은 건너뛴다.
create or replace function app.roll_specials(p_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_taken text[] := coalesce(p_codes, '{}');
  v_one   jsonb;
begin
  for i in 1 .. app.smuggle_special_size() loop
    v_one := app.roll_special(v_taken);
    if v_one is not null then
      v_out   := v_out || jsonb_build_array(v_one);
      v_taken := v_taken || (v_one ->> 'code');
    end if;
  end loop;
  return v_out;
end;
$$;

-- 오늘 특별 상품 칸의 코드들.
create or replace function app.smuggle_special_codes(p_offer public.smuggle_offers)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(e ->> 'code'), '{}')
    from jsonb_array_elements(coalesce(p_offer.specials, '[]'::jsonb)) e
$$;

-- 열려 있는 특별 상품 칸 중 p_code 인 것. 안 열렸거나 없으면 null.
create or replace function app.smuggle_special_find(p_offer public.smuggle_offers, p_code text)
returns jsonb
language sql
immutable
as $$
  select e
    from jsonb_array_elements(coalesce(p_offer.specials, '[]'::jsonb)) e
   where p_offer.special_open and e ->> 'code' = p_code
   limit 1
$$;

-- 이 사람이 특별 상품 한 칸에 낼 값과 취소선 정가 — {price, list_price}.
-- 표시(smuggle_state) · 구매(smuggle_buy) · 훔치기(smuggle_steal)가 모두 이것을 쓴다.
-- 특별 상품이 약물이면 누진을 먼저 얹고, 65% 할인(sale)은 그 위에 다시 곱한다.
-- 그래야 할인이 진짜 의미를 갖는다 — 순서를 뒤집으면 할인이 누진을 지운다.
-- 할인일 때 취소선으로 보일 정가도 약물은 누진이 얹힌 값이어야 한다 —
-- 누진 전 기본가를 정가로 쓰면 할인가가 정가보다 높게 보인다.
create or replace function app.smuggle_special_price(p_uid uuid, p_entry jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  v_def  public.item_defs;
  v_kind text := p_entry ->> 'kind';
  v_list integer;
begin
  select * into v_def from public.item_defs where code = p_entry ->> 'code';

  if v_def.kind = 'drug' then
    v_list := app.drug_price(v_def.buy_price, app.drug_bought(p_uid, v_def.code));
    return jsonb_build_object(
      'price', case when v_kind = 'sale' then greatest(1, round(v_list * 0.65))::int else v_list end,
      'list_price', case when v_kind = 'sale' then v_list else null end);
  end if;

  return jsonb_build_object(
    'price', (p_entry ->> 'price')::int,
    'list_price', case when v_kind = 'sale' then v_def.buy_price else null end);
end;
$$;

-- 그 사람의 오늘 밀거래 상시분 + 특별 상품. 자정(KST)이 지나면 새로 뽑힌다.
create or replace function app.smuggle_today(p_uid uuid)
returns public.smuggle_offers
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_day     date := app.today_kst();
  v_offer   public.smuggle_offers;
  v_codes   text[];
begin
  select * into v_offer from public.smuggle_offers where user_id = p_uid and day = v_day;
  if found then return v_offer; end if;

  v_codes := app.roll_smuggle();

  insert into public.smuggle_offers (user_id, day, codes, specials)
  values (p_uid, v_day, v_codes, app.roll_specials(v_codes))
  on conflict (user_id, day) do nothing;

  select * into v_offer from public.smuggle_offers where user_id = p_uid and day = v_day;
  return v_offer;
end;
$$;


-- -------------------------------------------------------------
-- 2. 라스트 카드
--    1~9 한 덱에서 앞 3장 / 뒤 3장을 나눠 가지므로 같은 숫자가 양쪽에
--    갈리지 않는다. 3판 2선승, 되돌리는 수단은 없다.
-- -------------------------------------------------------------

-- NPC 의 다음 수. p_hand 는 아직 안 낸 카드만 들어온다.
create or replace function app.lc_npc_pick(
  p_pattern  text,
  p_hand     integer[],
  p_round    integer,
  p_npc_wins integer,
  p_my_wins  integer
)
returns integer
language plpgsql
volatile
as $$
declare
  v_sorted integer[];
  v_n      integer := array_length(p_hand, 1);
begin
  if v_n = 1 then
    return p_hand[1];
  end if;

  -- 이탈: 패턴을 따르지 않고 아무 카드나 낸다. 승률이 아니라 읽힘 방지용.
  if random() < 0.20 then
    return p_hand[1 + floor(random() * v_n)::int];
  end if;

  select array_agg(x order by x) into v_sorted from unnest(p_hand) x;

  if p_pattern = 'conservative' then
    return v_sorted[1];
  elsif p_pattern = 'aggressive' then
    return v_sorted[v_n];
  elsif p_pattern = 'gambler' then
    return p_hand[1 + floor(random() * v_n)::int];
  else -- balanced: 첫 수는 중간, 이후엔 지고 있으면 최고 · 이기고 있으면 최저
    if p_round = 0 then
      return v_sorted[(v_n / 2) + 1];
    elsif p_npc_wins < p_my_wins then
      return v_sorted[v_n];
    else
      return v_sorted[1];
    end if;
  end if;
end;
$$;

-- 클라이언트에 내보내는 모양. 아직 안 낸 NPC 카드 숫자와 패턴은 절대 나가지 않는다.
create or replace function app.lc_view(g public.lastcard_games)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',         g.id,
    'purpose',    g.purpose,
    'my_cards',   (select coalesce(array_agg(x), '{}')
                     from unnest(g.my_cards) x
                    where not (x = any(g.my_played))),
    'my_played',  g.my_played,
    'npc_played', g.npc_played,
    'npc_left',   coalesce(array_length(g.npc_cards, 1), 0)
                  - coalesce(array_length(g.npc_played, 1), 0),
    'results',    g.results,
    'status',     g.status
  );
$$;

-- 2승 또는 2패가 나면 판을 마감하고, 이겼으면 해금/특별 상품을 반영한다.
create or replace function app.lc_finalize(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  g          public.lastcard_games;
  v_my_wins  integer;
  v_npc_wins integer;
  v_status   text;
begin
  select * into g from public.lastcard_games where id = p_id for update;

  v_my_wins  := (select count(*) from unnest(g.results) r where r = 'me');
  v_npc_wins := (select count(*) from unnest(g.results) r where r = 'npc');
  v_status   := case when v_my_wins = 2 then 'won' else 'lost' end;

  update public.lastcard_games set status = v_status, updated_at = now() where id = p_id;

  if g.purpose = 'unlock' then
    if v_status = 'won' then
      insert into public.smuggle_state (user_id, unlocked_day)
      values (g.user_id, g.day)
      on conflict (user_id) do update set unlocked_day = excluded.unlocked_day;
      perform app.smuggle_today(g.user_id);
    end if;

    perform app.log(g.user_id, 'smuggle',
      case when v_status = 'won' then '밀거래 승부 승리' else '밀거래 승부 패배' end,
      0, (select coins from public.profiles where id = g.user_id),
      jsonb_build_object('purpose', 'unlock', 'result', v_status));
  else
    if v_status = 'won' then
      -- 자정을 넘겨 끝난 판이라도, 지금 화면에 걸려 있는 오늘 오퍼를 연다.
      update public.smuggle_offers set special_open = true
       where user_id = g.user_id and day = app.today_kst();
    end if;

    perform app.log(g.user_id, 'smuggle',
      case when v_status = 'won' then '오늘의 특별 상품 승리' else '오늘의 특별 상품 패배' end,
      0, (select coins from public.profiles where id = g.user_id),
      jsonb_build_object('purpose', 'special', 'result', v_status));
  end if;
end;
$$;

-- 판을 새로 연다. purpose='unlock' 은 미해금일 때만, 'special' 은 해금 뒤에만.
-- 둘 다 마지막으로 붙은 지 5시간이 안 됐으면 막힌다.
create or replace function public.lastcard_start(p_purpose text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid     uuid := auth.uid();
  v_day     date := app.today_kst();
  v_state   public.smuggle_state;
  v_last    timestamptz;
  v_deck    integer[];
  v_my      integer[];
  v_npc     integer[];
  v_pattern text;
  v_game    public.lastcard_games;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if p_purpose not in ('unlock', 'special') then raise exception 'INVALID_PURPOSE'; end if;

  select * into v_state from public.smuggle_state where user_id = v_uid;

  if p_purpose = 'unlock' then
    if v_state.unlocked_day is not null then raise exception 'ALREADY_UNLOCKED'; end if;
  else
    if v_state.unlocked_day is null then raise exception 'NOT_UNLOCKED'; end if;
    perform app.smuggle_today(v_uid);

    -- 오늘 몫이 이미 열렸으면 더 붙을 이유가 없다.
    if (select special_open from public.smuggle_offers
         where user_id = v_uid and day = v_day) then
      raise exception 'SPECIAL_ALREADY_OPEN';
    end if;
  end if;

  -- 끝나지 않은 판이 있으면 그것부터. lastcard_one_playing 이 최종 방어선이다.
  if exists (
    select 1 from public.lastcard_games where user_id = v_uid and status = 'playing'
  ) then
    raise exception 'GAME_IN_PROGRESS';
  end if;

  select max(created_at) into v_last
    from public.lastcard_games where user_id = v_uid;
  if v_last is not null and now() < v_last + app.lastcard_cooldown() then
    raise exception 'LASTCARD_COOLDOWN';
  end if;

  select array_agg(x order by random()) into v_deck
    from unnest(array[1, 2, 3, 4, 5, 6, 7, 8, 9]) x;
  v_my  := v_deck[1:3];
  v_npc := v_deck[4:6];
  v_pattern := (array['conservative', 'aggressive', 'gambler', 'balanced'])
               [1 + floor(random() * 4)::int];

  insert into public.lastcard_games
    (user_id, day, purpose, my_cards, npc_cards, pattern)
  values (v_uid, v_day, p_purpose, v_my, v_npc, v_pattern)
  returning * into v_game;

  return app.lc_view(v_game);
end;
$$;

-- 유저가 카드 한 장을 낸다. NPC 수를 그 자리에서 정하고, 라운드를 판정한다.
create or replace function public.lastcard_play(p_card integer)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid      uuid := auth.uid();
  g          public.lastcard_games;
  v_npc_hand integer[];
  v_npc_card integer;
  v_round    integer;
  v_my_wins  integer;
  v_npc_wins integer;
  v_winner   text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into g from public.lastcard_games
   where user_id = v_uid and status = 'playing'
   order by created_at desc
   limit 1
   for update;
  if not found then raise exception 'NO_GAME'; end if;

  if not (p_card = any(g.my_cards)) or (p_card = any(g.my_played)) then
    raise exception 'NOT_YOUR_CARD';
  end if;

  v_round    := coalesce(array_length(g.my_played, 1), 0);
  v_my_wins  := (select count(*) from unnest(g.results) r where r = 'me');
  v_npc_wins := (select count(*) from unnest(g.results) r where r = 'npc');

  select array_agg(x) into v_npc_hand
    from unnest(g.npc_cards) x
   where not (x = any(g.npc_played));

  v_npc_card := app.lc_npc_pick(g.pattern, v_npc_hand, v_round, v_npc_wins, v_my_wins);
  v_winner   := case when p_card > v_npc_card then 'me' else 'npc' end;

  update public.lastcard_games
     set my_played  = my_played  || p_card,
         npc_played = npc_played || v_npc_card,
         results    = results    || v_winner,
         updated_at = now()
   where id = g.id
  returning * into g;

  v_my_wins  := (select count(*) from unnest(g.results) r where r = 'me');
  v_npc_wins := (select count(*) from unnest(g.results) r where r = 'npc');

  if v_my_wins = 2 or v_npc_wins = 2 then
    perform app.lc_finalize(g.id);
    select * into g from public.lastcard_games where id = g.id;
  end if;

  return app.lc_view(g);
end;
$$;


-- -------------------------------------------------------------
-- 3. 화면에 내보낼 종합 상태
-- -------------------------------------------------------------
-- public.smuggle_state 의 정본은 16_steal_trick.sql 이다(특별 상품 item 에 steal_sure 를
-- 함께 내보내는 판). 여기 있던 옛 사본은 지웠다 — APPLY.md "함수 몸통은 한 파일에만
-- 둔다" 참고. 권한(revoke/grant)도 16 으로 옮겼다 — 새로 설치할 때 "함수가 없다" 로
-- 멈추지 않게.


-- -------------------------------------------------------------
-- 4. 구매 — 오늘 밀거래 상시분 + (열렸다면) 특별 상품 칸들만
-- -------------------------------------------------------------
create or replace function public.smuggle_buy(p_code text, p_qty integer default 1)
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
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  -- 밀거래는 RP 커뮤니티 창구다. 물건 하나는 하루 한 개만 가져갈 수 있다.
  if p_qty is null or p_qty <> 1 then raise exception 'INVALID_QTY'; end if;

  select * into v_st from public.smuggle_state where user_id = v_uid;
  if v_st.unlocked_day is null then raise exception 'NOT_UNLOCKED'; end if;

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;

  perform app.smuggle_today(v_uid);
  -- 오퍼 행을 잠가서 동시 구매로 bought 갱신이 겹쳐 쓰이지 않게 한다.
  select * into v_offer from public.smuggle_offers
   where user_id = v_uid and day = app.today_kst() for update;

  if p_code = any(v_offer.bought) then raise exception 'ALREADY_BOUGHT'; end if;

  if p_code = any(v_offer.codes) then
    -- 약물은 살수록 오른 값을 낸다. 표시가(smuggle_state)와 반드시 같은 식이어야 한다.
    v_price := case when v_def.kind = 'drug'
                     then app.drug_price(v_def.buy_price, app.drug_bought(v_uid, p_code))
                     else v_def.buy_price end;
  elsif app.smuggle_special_find(v_offer, p_code) is not null then
    -- 특별 상품 칸. 표시가(smuggle_state)와 같은 함수로 값을 낸다.
    v_price := (app.smuggle_special_price(v_uid, app.smuggle_special_find(v_offer, p_code)) ->> 'price')::int;
  elsif v_offer.special_open and p_code = 'livestock_pass' then
    if not coalesce((select livestock_consent from public.profiles where id = v_uid), false) then
      raise exception 'NOT_CONSENTED';
    end if;
    -- 살 때마다 오른 값. 표시가(smuggle_state)와 반드시 같은 식이어야 한다.
    v_price := app.livestock_pass_price(v_p.livestock_bought, v_p.livestock_bought_at);
  elsif v_offer.special_open and p_code = 'title_pass' then
    if not coalesce((select livestock_consent from public.profiles where id = v_uid), false) then
      raise exception 'NOT_CONSENTED';
    end if;
    v_price := app.title_pass_price();
  else
    raise exception 'NOT_IN_SMUGGLE';
  end if;

  if v_price is null then raise exception 'NOT_BUYABLE'; end if;
  if v_p.coins < v_price * p_qty then raise exception 'NOT_ENOUGH_COINS'; end if;

  update public.profiles
     set coins = coins - v_price * p_qty,
         -- 가축 지목권 구매 장부. 한 바퀴(상한까지) 돈 횟수는 접어서 이어 센다.
         livestock_bought = case when p_code = 'livestock_pass'
                                 then app.livestock_pass_count(livestock_bought, livestock_bought_at) + p_qty
                                 else livestock_bought end,
         livestock_bought_at = case when p_code = 'livestock_pass' then now()
                                    else livestock_bought_at end
   where id = v_uid
  returning * into v_p;

  insert into public.inventories (user_id, item_code, qty)
  values (v_uid, p_code, p_qty)
  on conflict (user_id, item_code)
    do update set qty = inventories.qty + excluded.qty;

  -- 약물은 그 약물 장부에만 쌓인다. 해독제로도 지워지지 않는다(가격 누진 전용 장부).
  if v_def.kind = 'drug' then
    insert into public.drug_purchases (user_id, item_code, bought)
    values (v_uid, p_code, p_qty)
    on conflict (user_id, item_code)
      do update set bought = drug_purchases.bought + excluded.bought;
  end if;

  update public.smuggle_offers set bought = bought || p_code
   where user_id = v_uid and day = app.today_kst();

  perform app.log(v_uid, 'smuggle',
    format('%s %s개 밀거래', v_def.name, p_qty),
    -v_price * p_qty, v_p.coins,
    jsonb_build_object('code', p_code, 'qty', p_qty, 'price', v_price));

  return app.state_json(v_p);
end;
$$;


-- -------------------------------------------------------------
-- 4-0. 다시 보기 — 하루 한 번, app.smuggle_reroll_price() 를 내고 상시분을
--      통째로 갈아엎는다. 새 칸은 처음 뜬 칸·특별 상품과 겹치지 않는다.
--      이미 가져간 기록(bought)은 그대로 남아, 산 물건을 다시 살 수는 없다.
-- -------------------------------------------------------------
create or replace function public.smuggle_reroll()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_p     public.profiles;
  v_st    public.smuggle_state;
  v_offer public.smuggle_offers;
  v_price integer := app.smuggle_reroll_price();
  v_codes text[];
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  select * into v_st from public.smuggle_state where user_id = v_uid;
  if v_st.unlocked_day is null then raise exception 'NOT_UNLOCKED'; end if;

  v_p := app.accrue(v_uid);

  perform app.smuggle_today(v_uid);
  -- 오퍼 행을 잠가서 두 번 눌러도 한 번만 갈아엎이게 한다.
  select * into v_offer from public.smuggle_offers
   where user_id = v_uid and day = app.today_kst() for update;

  if v_offer.rerolled then raise exception 'SMUGGLE_REROLLED'; end if;
  if v_p.coins < v_price then raise exception 'NOT_ENOUGH_COINS'; end if;

  v_codes := app.roll_smuggle(
    v_offer.codes || app.smuggle_special_codes(v_offer));
  -- 풀이 바닥나 칸을 다 못 채우면 돈을 받지 않고 그만둔다.
  if coalesce(array_length(v_codes, 1), 0) < app.smuggle_size() then
    raise exception 'REROLL_EMPTY';
  end if;

  update public.smuggle_offers
     set codes = v_codes, rerolled = true
   where user_id = v_uid and day = v_offer.day;

  update public.profiles set coins = coins - v_price
   where id = v_uid
  returning * into v_p;

  perform app.log(v_uid, 'smuggle', '밀거래 물건 다시 보기', -v_price, v_p.coins,
    jsonb_build_object('codes', v_codes));

  return app.state_json(v_p);
end;
$$;


-- -------------------------------------------------------------
-- 4-1. 훔치기 — 하루 한 번(배급소 시도권과는 별개)
--
--   상대가 배급관이 아니라 장사꾼이라 배급소보다 안 통한다. 대신 실패했을 때
--   값을 치를 수 있는 사람이면 물건 없이 값의 절반만 뜯긴다(그마저 없으면
--   25%). 가액 상한(app.smuggle_value_cap)은 배급소와 따로 쥔다 — 같이 쓰면
--   상한을 올릴 때마다 퇴원서·해독제의 배급소 절도까지 덩달아 쉬워진다.
--   체력·병동행 상계 규칙(app.steal_penalty)만 배급소와 같은 것을 쓴다 —
--   02_schema.sql 16-3 참고.
-- -------------------------------------------------------------
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

-- public.smuggle_steal 의 정본은 16_steal_trick.sql 이다. 여기 있던 옛 사본은
-- 절도비법(steal_sure) 확정 성공 분기가 없는 이전 본문이라, 이 파일만 단독으로
-- 다시 돌리면 그 기능이 조용히 되감겼다 — 그래서 지웠다.
-- 권한(revoke/grant)도 정본이 있는 16_steal_trick.sql 쪽으로 옮겼다.
-- APPLY.md "함수 몸통은 한 파일에만 둔다" 참고.


-- -------------------------------------------------------------
-- 5. 권한
-- -------------------------------------------------------------
revoke all on function app.smuggle_size()                                       from public, anon, authenticated;
revoke all on function app.livestock_pass_price()                               from public, anon, authenticated;
revoke all on function app.livestock_pass_step()                                from public, anon, authenticated;
revoke all on function app.livestock_pass_max()                                 from public, anon, authenticated;
revoke all on function app.livestock_pass_count(integer, timestamptz)           from public, anon, authenticated;
revoke all on function app.livestock_pass_price(integer, timestamptz)           from public, anon, authenticated;
revoke all on function app.title_pass_price()                                   from public, anon, authenticated;
revoke all on function app.drug_bought(uuid, text)                             from public, anon, authenticated;
revoke all on function app.lastcard_cooldown()                                  from public, anon, authenticated;
revoke all on function app.roll_smuggle_grade()                                 from public, anon, authenticated;
revoke all on function app.smuggle_steal_base(integer)                          from public, anon, authenticated;
revoke all on function app.smuggle_value_cap(integer)                           from public, anon, authenticated;
revoke all on function app.roll_smuggle(text[])                                 from public, anon, authenticated;
revoke all on function app.smuggle_reroll_price()                               from public, anon, authenticated;
revoke all on function app.smuggle_special_size()                               from public, anon, authenticated;
revoke all on function app.roll_specials(text[])                                from public, anon, authenticated;
revoke all on function app.smuggle_special_codes(public.smuggle_offers)         from public, anon, authenticated;
revoke all on function app.smuggle_special_find(public.smuggle_offers, text)    from public, anon, authenticated;
revoke all on function app.smuggle_special_price(uuid, jsonb)                   from public, anon, authenticated;
revoke all on function app.smuggle_today(uuid)                                  from public, anon, authenticated;
revoke all on function app.lc_npc_pick(text, integer[], integer, integer, integer) from public, anon, authenticated;
revoke all on function app.lc_view(public.lastcard_games)                       from public, anon, authenticated;
revoke all on function app.lc_finalize(bigint)                                  from public, anon, authenticated;

revoke all on function public.lastcard_start(text)            from public;
revoke all on function public.lastcard_play(integer)          from public;
revoke all on function public.smuggle_buy(text, integer)      from public;
revoke all on function public.smuggle_reroll()                from public;

grant execute on function public.smuggle_reroll()                to authenticated;
grant execute on function public.lastcard_start(text)            to authenticated;
grant execute on function public.lastcard_play(integer)          to authenticated;
grant execute on function public.smuggle_buy(text, integer)      to authenticated;
