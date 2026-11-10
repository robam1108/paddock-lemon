-- =============================================================
--  22. 경마장 — 흑색구역의 두 번째 판
--
--  왜
--    지금까지의 판은 전부 혼자 즉석에서 끝나거나(백색구역) 1:1 대전이었다
--    (흑색구역). 여럿이 같은 시각, 같은 결과를 기다리는 판을 하나 연다.
--
--  규칙
--    · 경주마 20두(race_horses)는 외형·능력·습성이 고정이다. 컨디션만 날마다
--      다섯 단계(최상·양호·보통·저조·최악)로 새로 굴리고, 그건 숨긴다.
--    · 하루 2경주 — 10:00 · 22:00 KST 발주(app.race_post_hours). 경주마다 8두,
--      같은 날 같은 말이 두 번 뛰지 않는다(16두 출전, 4두 휴양).
--    · 발주 시각에 배팅이 닫힌다. 결과는 그 뒤에야 만든다 — 마감 전에는 DB 어디에도
--      결과가 없으므로 남의 배팅이나 화면으로 미리 알 길이 없다.
--    · 고정배당. 출전표를 만들 때 공개 정보(능력·거리·주로)만으로 몬테카를로를
--      돌려 배당을 정한다. 숨은 컨디션은 사전분포에서 뽑으므로 정보 없이 사면
--      기대값이 1 − 공제율(app.race_take)이다. 라디오(CH2)로 컨디션을 엿들은
--      사람만 그보다 낫다 — 그게 이 판의 재미다.
--    · 승식은 단승(1착) · 연승(3착 안) · 복승(1·2착, 순서 무관).
--      한 장 최소 app.race_min_bet, 한 경주 합계 최대 app.race_max_bet.
--    · 마권 한 장마다 체력 app.hp_per_play() 을 쓴다(테스트 경주는 안 쓴다).
--      배정 횟수는 쓰지 않는다. 일당도 없다(흑색구역 규칙).
--    · 정산은 pg_cron(10:01 · 22:01 KST) + 누가 출전표를 열 때 lazy 하게 한 번 더.
--
--  관리자 사전 확인
--    · 2026-10-29 정식 오픈(app.race_public() = true). false 로 되돌리면 시험 계정
--      (app.race_tester_name — 관리자 권한이 있고 이름이 그것인 계정 하나)만 경마장 RPC 를
--      쓸 수 있다. 다른 관리자 계정도 막힌다. 이 값 하나와 클라이언트 RACE_PUBLIC 을 같이 바꾼다.
--    · 시험 계정은 오픈 뒤에도 race_admin_test 로 시각과 무관한 테스트 경주를 편성·즉시 발주할 수 있다.
--      테스트 경주는 코인을 움직이지 않고 원장·게임기록·말 전적에도 남지 않는다.
--
--  적용 순서: 17_items.sql(라디오 행) 뒤. 라이브에도 이 파일 하나를 통째로 돌린다
--  (새 테이블 · 새 함수뿐이고 멱등이다). 클라이언트 배포보다 먼저.
--  실행 전 pg_cron 이 켜져 있어야 정산 예약이 걸린다(꺼져 있어도 lazy 정산은 돈다).
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 0. 손잡이
-- -------------------------------------------------------------
-- 공개 스위치. false 면 시험 계정만 들어온다.
create or replace function app.race_public() returns boolean
  language sql immutable as $$ select true $$;

-- 시험 계정 이름. 관리자 권한(is_admin)이 있고 이 이름인 계정만 비공개 기간에 들어오고,
-- 테스트 경주를 돌린다. ★ 클라이언트 RACE_TESTER 와 같이 바꾼다.
create or replace function app.race_tester_name() returns text
  language sql immutable as $$ select '관리자' $$;

-- 발주 시각(KST 시). 경주 번호 = 배열 순서.
create or replace function app.race_post_hours() returns integer[]
  language sql immutable as $$ select array[10, 22] $$;

create or replace function app.race_field() returns integer
  language sql immutable as $$ select 8 $$;

-- 한 장 최소 · 한 경주 합계 최대
create or replace function app.race_min_bet() returns integer
  language sql immutable as $$ select 20 $$;
create or replace function app.race_max_bet() returns integer
  language sql immutable as $$ select 300 $$;

-- 공제율. 실제 경마(KRA) 단승 환급률이 약 80% 다.
create or replace function app.race_take() returns double precision
  language sql immutable as $$ select 0.20::double precision $$;

-- 라디오가 경주마다 한 사람에게 들려주는 속보 수
create or replace function app.race_tips_per_race() returns integer
  language sql immutable as $$ select 3 $$;

-- 배당을 정하는 몬테카를로 횟수
create or replace function app.race_mc_runs() returns integer
  language sql immutable as $$ select 1500 $$;

create or replace function app.race_odds_cap() returns numeric
  language sql immutable as $$ select 200.0 $$;

-- 컨디션 단계(0 최상 ~ 4 최악)별 속도 보정(%)
create or replace function app.race_cond_pct(p_lvl smallint) returns double precision
  language sql immutable as $$
  select (array[0.6, 0.3, 0, -0.3, -0.6]::double precision[])[p_lvl + 1]
$$;

-- 컨디션 굴리기: 최상 10% · 양호 22% · 보통 36% · 저조 22% · 최악 10%
create or replace function app.race_roll_cond() returns smallint
  language sql volatile as $$
  select case when r < 0.10 then 0 when r < 0.32 then 1 when r < 0.68 then 2
              when r < 0.90 then 3 else 4 end::smallint
    from (select random() as r) x
$$;

-- 당일 마체중 증감(kg, 짝수). 컨디션과 약하게만 엮인다 — 눈치 빠른 사람의 단서.
create or replace function app.race_wdelta(p_lvl smallint) returns smallint
  language sql volatile as $$
  select ((2 - p_lvl) * 2
          + round(sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()) * 1.5) * 2)::smallint
$$;

create or replace function app.race_distances() returns integer[]
  language sql immutable as $$ select array[1000, 1200, 1400, 1600, 1800, 2000] $$;


-- -------------------------------------------------------------
-- 1. 경주마
--    style: 1 선행 · 2 선입 · 3 차입 · 4 추입
--    dist : S 단거리(~1200) · M 중거리(1400~1600) · L 장거리(1800~)
--    wet  : -1 마른 주로 선호 · 0 무관 · 1 젖은 주로 선호
-- -------------------------------------------------------------
create table if not exists public.race_horses (
  id      smallint primary key,
  name    text not null,
  coat    text not null,
  face    text not null,
  legs    text not null,
  sex     text not null,
  age     smallint not null,
  weight  smallint not null,
  spd     smallint not null,
  sta     smallint not null,
  acc     smallint not null,
  gut     smallint not null,
  stb     smallint not null,
  style   smallint not null check (style between 1 and 4),
  dist    text not null check (dist in ('S', 'M', 'L')),
  wet     smallint not null check (wet between -1 and 1),
  bio     text not null
);
-- 예전 판에 있던 부마 · 산지 · 기수 열 — 결과에 쓰이지 않아 뺐다(이미 만든 테이블에서도 지운다).
alter table public.race_horses drop column if exists sire;
alter table public.race_horses drop column if exists origin;
alter table public.race_horses drop column if exists jockey;
alter table public.race_horses enable row level security;

insert into public.race_horses
  (id, name, coat, face, legs, sex, age, weight,
   spd, sta, acc, gut, stb, style, dist, wet, bio)
values
  ( 1, '미스터파크',   '흑모',   '별',   '없음',       '수',   4, 498, 92, 78, 88, 70, 72, 1, 'M',  0,
    '출발 신호와 동시에 튀어 나가는 선행마. 초반 주도권을 놓친 적이 드물다.'),
  ( 2, '문라이트소나타', '청모',   '유성', '왼뒷발 흰',  '암',   5, 466, 85, 92, 70, 84, 80, 3, 'L', -1,
    '회색 털이 달빛처럼 빛나는 장거리 암말. 마른 주로에서 특히 무섭다.'),
  ( 3, '썬더볼트',    '밤색',   '작',   '없음',       '거세', 3, 472, 95, 58, 94, 62, 60, 1, 'S',  0,
    '단거리 최강의 스타트. 다만 1400m를 넘기면 다리가 무거워진다.'),
  ( 4, '킹오브레인',   '갈색',   '없음', '네 발 흰',   '수',   6, 516, 78, 95, 66, 90, 88, 4, 'L',  1,
    '비 오는 날이면 눈빛이 달라지는 노장. 마지막 직선의 괴력.'),
  ( 5, '모닝캄',     '밤색',   '별',   '오른앞발 흰','암',   4, 458, 82, 80, 80, 78, 75, 2, 'M',  0,
    '무난함의 대명사. 어느 거리에서도 크게 무너지지 않는다.'),
  ( 6, '선셋블레이즈',  '적다모', '유성', '없음',       '수',   5, 490, 76, 74, 72, 88, 66, 4, 'M',  1,
    '해 질 녘처럼 늦게 타오르는 추입마. 젖은 주로를 반긴다.'),
  ( 7, '블루드래곤',   '흑갈색', '백면', '양뒷발 흰',  '수',   3, 484, 88, 70, 85, 74, 64, 2, 'S', -1,
    '혈기 왕성한 3세마. 기복이 있지만 터지는 날은 아무도 못 따라잡는다.'),
  ( 8, '윈드러너',    '갈색',   '별',   '없음',       '거세', 6, 502, 80, 85, 74, 80, 82, 3, 'L',  0,
    '꾸준함으로 상금을 쌓아 온 베테랑. 장거리에서 빛난다.'),
  ( 9, '스틸하트',    '흑갈색', '없음', '없음',       '수',   7, 520, 72, 90, 64, 95, 90, 4, 'L',  0,
    '출전마 중 최고령. 근성 하나로 버티는, 끝까지 포기하지 않는 말.'),
  (10, '문나이트',    '청모',   '작',   '오른뒷발 흰','거세', 5, 476, 84, 76, 78, 72, 70, 2, 'M', -1,
    '영리한 자리 잡기가 장기. 마른 주로의 중거리라면 믿을 만하다.'),
  (11, '노던스타',    '밤색',   '별',   '왼앞발 흰',  '암',   4, 452, 74, 82, 70, 76, 78, 3, 'M',  1,
    '작은 체구에 큰 심장. 비가 오면 한 단계 올라선다.'),
  (12, '머드킹',     '흑갈색', '없음', '없음',       '수',   6, 510, 70, 88, 62, 82, 92, 3, 'L',  1,
    '빠르진 않지만 무너지지도 않는다. 진흙탕 장거리의 단골 복병.'),
  (13, '스톰체이서',   '밤색',   '백면', '양앞발 흰',  '수',   4, 480, 90, 62, 90, 66, 55, 1, 'S',  0,
    '폭발적인 선행력. 그러나 기복이 심해 "도 아니면 모"로 불린다.'),
  (14, '골든캐리지',   '밤색',   '유성', '없음',       '거세', 5, 494, 79, 79, 76, 79, 79, 2, 'M',  0,
    '모든 능력치가 고르게 받쳐 주는 교과서 같은 말.'),
  (15, '실버메인',    '청모',   '없음', '없음',       '암',   3, 448, 86, 68, 82, 70, 62, 1, 'S',  1,
    '은빛 갈기를 휘날리며 앞에서 끄는 3세 암말. 젖은 단거리에 강하다.'),
  (16, '빅드럼',     '흑모',   '별',   '왼뒷발 흰',  '수',   4, 488, 77, 72, 80, 86, 58, 4, 'S',  0,
    '단거리 추입이라는 드문 습성. 막판 200m의 발소리가 천둥 같다.'),
  (17, '에베레스트',   '갈색',   '유성', '네 발 흰',   '수',   7, 518, 68, 94, 60, 84, 86, 3, 'L', -1,
    '지구력만큼은 최고. 짧은 거리에서는 몸이 덜 풀린 채 끝난다.'),
  (18, '와일드파이어',  '적다모', '백면', '없음',       '암',   3, 456, 83, 66, 86, 64, 52, 1, 'M',  0,
    '번지듯 치고 나가는 선행 암말. 컨디션 타는 게 흠.'),
  (19, '라스트댄스',   '흑갈색', '작',   '오른앞발 흰','거세', 6, 500, 73, 78, 68, 92, 68, 4, 'M',  0,
    '결승선 앞에서만 진심인 말. 이름값을 하는 날이 꼭 온다.'),
  (20, '럭키레터',    '밤색',   '별',   '없음',       '암',   5, 462, 75, 75, 75, 75, 74, 2, 'M',  1,
    '평범한 능력치, 비범한 운. 배당표 아래쪽에서 종종 편지를 보낸다.')
on conflict (id) do update set
  name = excluded.name, coat = excluded.coat, face = excluded.face, legs = excluded.legs,
  sex = excluded.sex, age = excluded.age, weight = excluded.weight,
  spd = excluded.spd, sta = excluded.sta,
  acc = excluded.acc, gut = excluded.gut, stb = excluded.stb, style = excluded.style,
  dist = excluded.dist, wet = excluded.wet, bio = excluded.bio;


-- -------------------------------------------------------------
-- 2. 경주 일정 · 경주 · 마권 · 라디오 속보
--    전부 RLS 만 켜고 정책을 만들지 않는다 — 숨은 컨디션이 들어 있어서
--    클라이언트는 RPC 로만 읽는다.
-- -------------------------------------------------------------
-- 하루치 숨은 상태. cond · wdelta 는 말 번호(1~20) 순서.
create table if not exists public.race_days (
  day        date primary key,
  track      smallint not null check (track between 0 and 3),  -- 0 건조 · 1 양호 · 2 다습 · 3 불량
  lineup     smallint[] not null,                              -- 출전 16두(앞 8 = 제1경주)
  cond       smallint[] not null,
  wdelta     smallint[] not null,
  created_at timestamptz not null default now()
);
alter table public.race_days enable row level security;

create table if not exists public.races (
  id         bigint generated always as identity primary key,
  day        date not null,
  no         smallint not null,                 -- 경주 번호(테스트는 0)
  is_test    boolean not null default false,
  created_by uuid references auth.users(id) on delete cascade,
  post_at    timestamptz not null,
  distance   integer not null,
  track      smallint not null,
  entries    smallint[] not null,               -- 게이트 순서의 말 번호
  cond       smallint[] not null,               -- 게이트 순서
  wdelta     smallint[] not null,               -- 게이트 순서
  odds       jsonb not null,                    -- {win:[], place:[], quin:{"1-2":x}}
  status     text not null default 'open' check (status in ('open', 'done')),
  result     jsonb,                             -- {order:[게이트], splits:[[10]]}
  ranks      smallint[],                        -- 게이트별 착순
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.races enable row level security;
create unique index if not exists races_day_no_idx on public.races (day, no) where not is_test;
create index if not exists races_open_idx on public.races (status, post_at);

create table if not exists public.race_bets (
  id         bigint generated always as identity primary key,
  race_id    bigint not null references public.races(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('win', 'place', 'quin')),
  picks      smallint[] not null,               -- 게이트 번호
  amount     integer not null check (amount > 0),
  odds       numeric(6, 1) not null,
  payout     integer,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.race_bets enable row level security;
create index if not exists race_bets_race_idx on public.race_bets (race_id, user_id);

create table if not exists public.race_tips (
  user_id  uuid not null references auth.users(id) on delete cascade,
  race_id  bigint not null references public.races(id) on delete cascade,
  gates    smallint[] not null,
  revealed smallint not null default 0,
  primary key (user_id, race_id)
);
alter table public.race_tips enable row level security;

-- 경마 기록이 실시간 피드(game_rounds)에 들어간다.
-- ★ 이 목록은 02_schema.sql · 03_pvp.sql 에도 있다. 세 곳이 글자까지 같아야 한다
--   (라이브는 이 파일이 'race' 를 더한다).
alter table public.game_rounds drop constraint if exists game_rounds_game_check;
alter table public.game_rounds add constraint game_rounds_game_check
  check (game in ('roulette', 'slots', 'keno', 'highlow', 'dice', 'indian', 'blackjack', 'race'));


-- -------------------------------------------------------------
-- 3. 시뮬레이션
-- -------------------------------------------------------------
-- 출전마의 능력을 게이트 순서로 납작하게 편다(말마다 8칸).
-- [스피드, 지구력, 순발력, 근성, 안정성, 습성, 거리적성(0/1/2), 주로적성]
create or replace function app.race_stats(p_entries smallint[])
returns double precision[]
language sql
stable
set search_path = public
as $$
  select array_agg(v order by e.ord, s.k)
    from unnest(p_entries) with ordinality e(hid, ord)
    join public.race_horses h on h.id = e.hid
   cross join lateral unnest(array[
     h.spd, h.sta, h.acc, h.gut, h.stb, h.style,
     case h.dist when 'S' then 0 when 'M' then 1 else 2 end,
     h.wet
   ]::double precision[]) with ordinality s(v, k)
$$;

-- 한 판을 달린다. 10구간 누적 타임(초)을 게이트별로 이어 붙여 돌려준다(n×10).
-- 구간 속도 = 기본(스피드) × (1 + 컨디션 − 거리 부적합 + 주로 적성 + 그날 몸 상태
--             + 습성 곡선 + 초반 순발력 / 막판 근성 − 지구력 소진 + 구간 잡음)
create or replace function app.race_run(
  p_stats double precision[], p_dist integer, p_track smallint, p_cond smallint[]
)
returns double precision[]
language plpgsql
volatile
as $$
declare
  n     integer := array_length(p_cond, 1);
  seg   double precision := p_dist / 10.0;
  dcat  integer := case when p_dist <= 1200 then 0 when p_dist <= 1600 then 1 else 2 end;
  v_out double precision[] := array_fill(0::double precision, array[n * 10]);
  i integer; k integer; o integer;
  spd double precision; sta double precision; acc double precision; gut double precision;
  stb double precision; sty integer; dp integer; wp double precision;
  base double precision; cm double precision; dmis double precision; wm double precision;
  sig double precision; form double precision; m double precision; t double precision;
  curve double precision[];
begin
  for i in 1..n loop
    o   := (i - 1) * 8;
    spd := p_stats[o + 1]; sta := p_stats[o + 2]; acc := p_stats[o + 3]; gut := p_stats[o + 4];
    stb := p_stats[o + 5]; sty := p_stats[o + 6]::integer; dp := p_stats[o + 7]::integer;
    wp  := p_stats[o + 8];

    base := 16 + (spd - 75) * 0.018;
    cm   := app.race_cond_pct(p_cond[i]) / 100;
    dmis := abs(dp - dcat) * 0.01;
    wm   := wp * (p_track - 1.5) * 0.005;
    sig  := 0.014 * (1.6 - stb / 100);
    form := sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()) * sig;
    -- 초반(0~2) · 중반(3~6) · 막판(7~9) 가감(%). 구간 수를 곱한 합이 0 이다.
    curve := case sty
               when 1 then array[2.0, 0, -2.0]
               when 2 then array[1.0, 0.5, -5.0 / 3]
               when 3 then array[-1.0, 0, 1.0]
               else        array[-2.0, -0.5, 8.0 / 3]
             end::double precision[];
    t := 0;
    for k in 0..9 loop
      m := 1 + cm - dmis + wm + form
             + curve[case when k < 3 then 1 when k < 7 then 2 else 3 end] / 100;
      if k < 2 then m := m + (acc - 75) * 0.0008; end if;
      if k >= 7 then m := m + (gut - 75) * 0.0008; end if;
      m := m - greatest(0, (p_dist / 1000.0) * ((k + 0.5) / 10) - sta / 80) * 0.04;
      m := m + sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()) * sig;
      t := t + seg / (base * m);
      v_out[(i - 1) * 10 + k + 1] := t;
    end loop;
  end loop;
  return v_out;
end;
$$;

-- 게이트별 착순(1부터). 동타는 안쪽 게이트가 앞.
create or replace function app.race_ranks(p_times double precision[], p_n integer)
returns smallint[]
language plpgsql
immutable
as $$
declare
  v_r smallint[] := '{}';
  i integer; j integer; c integer;
begin
  for i in 1..p_n loop
    c := 1;
    for j in 1..p_n loop
      if p_times[j * 10] < p_times[i * 10]
         or (p_times[j * 10] = p_times[i * 10] and j < i) then
        c := c + 1;
      end if;
    end loop;
    v_r := v_r || c::smallint;
  end loop;
  return v_r;
end;
$$;

-- 확률 → 배당. 0.1 단위로 버리고 [1.1, cap] 로 자른다.
create or replace function app.race_price(p double precision)
returns numeric
language sql
immutable
as $$
  select least(app.race_odds_cap(),
               greatest(1.1, floor((1 - app.race_take()) / greatest(p, 1e-6) * 10) / 10))::numeric(6, 1)
$$;

-- 공개 정보만으로 배당을 정한다. 컨디션은 매 판 사전분포에서 새로 뽑는다.
create or replace function app.race_odds(
  p_stats double precision[], p_dist integer, p_track smallint, p_runs integer
)
returns jsonb
language plpgsql
volatile
as $$
declare
  n    integer := array_length(p_stats, 1) / 8;
  w    integer[] := array_fill(0, array[n]);
  pl   integer[] := array_fill(0, array[n]);
  q    integer[] := array_fill(0, array[n * n]);
  c    smallint[];
  t    double precision[];
  rk   smallint[];
  r integer; i integer; a integer; b integer;
  pairs integer := n * (n - 1) / 2;
  jw   jsonb := '[]';
  jp   jsonb := '[]';
  jq   jsonb := '{}';
begin
  for r in 1..p_runs loop
    c := '{}';
    for i in 1..n loop c := c || app.race_roll_cond(); end loop;
    t  := app.race_run(p_stats, p_dist, p_track, c);
    rk := app.race_ranks(t, n);
    for i in 1..n loop
      if rk[i] = 1 then w[i] := w[i] + 1; a := i; end if;
      if rk[i] = 2 then b := i; end if;
      if rk[i] <= 3 then pl[i] := pl[i] + 1; end if;
    end loop;
    i := (least(a, b) - 1) * n + greatest(a, b);
    q[i] := q[i] + 1;
  end loop;

  for i in 1..n loop
    jw := jw || to_jsonb(app.race_price(greatest(w[i], 0.5) / p_runs));
    jp := jp || to_jsonb(app.race_price(greatest(pl[i], 0.5) / p_runs));
  end loop;
  -- 복승은 조합이 많아 0회가 흔하다 — +1 평활로 터무니없는 배당을 막는다.
  for a in 1..n - 1 loop
    for b in a + 1..n loop
      jq := jq || jsonb_build_object(a || '-' || b,
              app.race_price((q[(a - 1) * n + b] + 1)::double precision / (p_runs + pairs)));
    end loop;
  end loop;
  return jsonb_build_object('win', jw, 'place', jp, 'quin', jq);
end;
$$;


-- -------------------------------------------------------------
-- 4. 편성
-- -------------------------------------------------------------
create or replace function app.race_create(
  p_day date, p_no smallint, p_test boolean, p_post timestamptz,
  p_entries smallint[], p_dist integer, p_track smallint,
  p_cond smallint[], p_wdelta smallint[], p_by uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id bigint;
begin
  insert into public.races
    (day, no, is_test, created_by, post_at, distance, track, entries, cond, wdelta, odds)
  values
    (p_day, p_no, p_test, p_by, p_post, p_dist, p_track, p_entries, p_cond, p_wdelta,
     app.race_odds(app.race_stats(p_entries), p_dist, p_track, app.race_mc_runs()))
  on conflict (day, no) where not is_test do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- 그날의 숨은 상태와 정식 경주들을 (없으면) 만든다.
create or replace function app.race_ensure(p_day date)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  d       public.race_days;
  v_hours integer[] := app.race_post_hours();
  v_f     integer := app.race_field();
  v_no    integer;
  v_cond  smallint[];
  v_wd    smallint[];
  v_ent   smallint[];
  i       integer;
begin
  if (select count(*) from public.races
       where day = p_day and not is_test) >= array_length(v_hours, 1) then
    return;
  end if;

  -- 출전표 만들기(몬테카를로)는 한 사람만 한다.
  perform pg_advisory_xact_lock(hashtext('race_ensure'));

  select * into d from public.race_days where day = p_day;
  if not found then
    v_cond := '{}'; v_wd := '{}';
    for i in 1..20 loop
      v_cond := v_cond || app.race_roll_cond();
      v_wd   := v_wd || app.race_wdelta(v_cond[i]);
    end loop;
    insert into public.race_days (day, track, lineup, cond, wdelta)
    values (p_day, floor(random() * 4)::smallint,
            app.pick_shuffled(1, 20, v_f * array_length(v_hours, 1)), v_cond, v_wd)
    on conflict (day) do nothing;
    select * into d from public.race_days where day = p_day;
  end if;

  for v_no in 1..array_length(v_hours, 1) loop
    if exists (select 1 from public.races where day = p_day and no = v_no and not is_test) then
      continue;
    end if;
    -- 발주 시각이 이미 지난 칸은 만들지 않는다 — 아무도 살 수 없었던 경주이고,
    -- 지운 경주가 다음 호출 때 결과까지 난 채로 되살아나는 것도 막는다.
    if ((p_day + make_time(v_hours[v_no], 0, 0)) at time zone 'Asia/Seoul') <= now() then
      continue;
    end if;
    v_ent := d.lineup[(v_no - 1) * v_f + 1 : v_no * v_f];
    select array_agg(d.cond[e] order by o), array_agg(d.wdelta[e] order by o)
      into v_cond, v_wd
      from unnest(v_ent) with ordinality u(e, o);
    perform app.race_create(
      p_day, v_no::smallint, false,
      ((p_day + make_time(v_hours[v_no], 0, 0)) at time zone 'Asia/Seoul'),
      v_ent,
      (app.race_distances())[1 + floor(random() * array_length(app.race_distances(), 1))::integer],
      d.track, v_cond, v_wd, null);
  end loop;
end;
$$;


-- -------------------------------------------------------------
-- 5. 발주 · 정산
-- -------------------------------------------------------------
create or replace function app.race_settle(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  r        public.races;
  n        integer;
  v_t      double precision[];
  v_rk     smallint[];
  v_order  smallint[];
  v_splits jsonb;
  v_winner text;
  u        record;
  v_coins  integer;
  v_name   text;
begin
  select * into r from public.races where id = p_id for update;
  if not found or r.status <> 'open' or r.post_at > now() then return; end if;

  n    := array_length(r.entries, 1);
  v_t  := app.race_run(app.race_stats(r.entries), r.distance, r.track, r.cond);
  v_rk := app.race_ranks(v_t, n);

  select array_agg(g::smallint order by v_rk[g]) into v_order from generate_series(1, n) g;
  select jsonb_agg(
           (select jsonb_agg(round(v_t[(g - 1) * 10 + k]::numeric, 3) order by k)
              from generate_series(1, 10) k)
           order by g)
    into v_splits
    from generate_series(1, n) g;

  update public.races
     set status = 'done', ranks = v_rk, settled_at = now(),
         result = jsonb_build_object('order', to_jsonb(v_order), 'splits', v_splits)
   where id = p_id;

  update public.race_bets b
     set payout = case
           when b.kind = 'win'   and v_rk[b.picks[1]] = 1 then floor(b.amount * b.odds)
           when b.kind = 'place' and v_rk[b.picks[1]] <= 3 then floor(b.amount * b.odds)
           when b.kind = 'quin'  and v_rk[b.picks[1]] <= 2 and v_rk[b.picks[2]] <= 2
             then floor(b.amount * b.odds)
           else 0
         end,
         settled_at = now()
   where b.race_id = p_id;

  -- 테스트 경주는 코인 · 원장 · 피드를 건드리지 않는다.
  if r.is_test then return; end if;

  select name into v_winner from public.race_horses where id = r.entries[v_order[1]];

  for u in
    select user_id, sum(amount)::integer as bet, sum(payout)::integer as pay,
           jsonb_agg(jsonb_build_object('kind', kind, 'picks', picks, 'amount', amount,
                                        'odds', odds, 'payout', payout) order by id) as tickets
      from public.race_bets
     where race_id = p_id
     group by user_id
  loop
    update public.profiles set coins = coins + u.pay
     where id = u.user_id
     returning coins, username into v_coins, v_name;
    if not found then continue; end if;

    insert into public.game_rounds
      (user_id, username, game, bet, choice, outcome, payout, balance_after)
    values
      (u.user_id, v_name, 'race', u.bet, r.no::text,
       jsonb_build_object('race_id', r.id, 'day', r.day, 'no', r.no,
                          'winner', v_winner, 'winner_gate', v_order[1],
                          'tickets', u.tickets),
       u.pay, v_coins);

    if u.pay > 0 then
      perform app.log(u.user_id, 'game', format('경마 · 제%s경주 적중', r.no),
                      u.pay, v_coins, jsonb_build_object('race_id', r.id, 'tickets', u.tickets));
    end if;
  end loop;
end;
$$;

create or replace function app.race_settle_due()
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_id bigint;
  v_n  integer := 0;
begin
  for v_id in
    select id from public.races
     where status = 'open' and post_at <= now()
     order by post_at
  loop
    perform app.race_settle(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;


-- -------------------------------------------------------------
-- 6. 화면용
-- -------------------------------------------------------------
-- 시험 계정인가 — 관리자 권한이 있고 이름이 app.race_tester_name() 인 계정.
create or replace function app.race_is_tester(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin and username = app.race_tester_name()
                     from public.profiles where id = p_uid), false)
$$;

-- 비공개 기간에는 시험 계정만. 돌려주는 값 = 시험 계정 여부.
create or replace function app.race_gate()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tester boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_tester := app.race_is_tester(auth.uid());
  if not app.race_public() and not v_tester then
    raise exception 'RACE_NOT_OPEN';
  end if;
  return v_tester;
end;
$$;

-- 경주 한 건. 숨은 컨디션은 끝난 경주에서만 내보낸다.
create or replace function app.race_json(r public.races, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',       r.id,
    'day',      r.day,
    'no',       r.no,
    'is_test',  r.is_test,
    'post_at',  r.post_at,
    'distance', r.distance,
    'track',    r.track,
    'status',   r.status,
    'entries',  (select jsonb_agg(jsonb_build_object(
                          'gate', g, 'horse', r.entries[g],
                          'weight', h.weight + r.wdelta[g], 'wdelta', r.wdelta[g])
                        order by g)
                   from generate_subscripts(r.entries, 1) g
                   join public.race_horses h on h.id = r.entries[g]),
    'odds',     r.odds,
    'result',   r.result,
    'ranks',    to_jsonb(r.ranks),
    'cond',     case when r.status = 'done' then to_jsonb(r.cond) end,
    'tickets',  coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', b.id, 'kind', b.kind, 'picks', b.picks,
                                   'amount', b.amount, 'odds', b.odds, 'payout', b.payout)
                                 order by b.id)
                            from public.race_bets b
                           where b.race_id = r.id and b.user_id = p_uid), '[]'::jsonb)
  )
$$;

create or replace function public.race_card()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_tester boolean;
begin
  v_tester := app.race_gate();

  -- 편성 먼저, 정산은 그 다음 — 발주 시각이 지난 칸은 편성하지 않고(race_ensure),
  -- 지났는데 아직 열린 경주는 여기서 결과가 난다.
  perform app.race_ensure(app.today_kst());
  perform app.race_ensure(app.today_kst() + 1);
  perform app.race_settle_due();

  return jsonb_build_object(
    'public',   app.race_public(),
    'tester',   v_tester,
    'now',      now(),
    'min_bet',  app.race_min_bet(),
    'max_bet',  app.race_max_bet(),
    'tips_per_race', app.race_tips_per_race(),
    'horses', (
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'name', h.name, 'coat', h.coat, 'face', h.face, 'legs', h.legs,
               'sex', h.sex, 'age', h.age, 'weight', h.weight,
               'spd', h.spd, 'sta', h.sta, 'acc', h.acc, 'gut', h.gut, 'stb', h.stb,
               'style', h.style, 'dist', h.dist, 'wet', h.wet, 'bio', h.bio,
               'runs', coalesce(rec.runs, 0), 'wins', coalesce(rec.wins, 0),
               'top3', coalesce(rec.top3, 0), 'last5', coalesce(rec.last5, '[]'::jsonb))
             order by h.id)
        from public.race_horses h
        left join lateral (
          select count(*)::integer as runs,
                 count(*) filter (where x.rk = 1)::integer as wins,
                 count(*) filter (where x.rk <= 3)::integer as top3,
                 (select jsonb_agg(y.rk order by y.post_at desc)
                    from (select r2.ranks[g2] as rk, r2.post_at
                            from public.races r2, generate_subscripts(r2.entries, 1) g2
                           where not r2.is_test and r2.status = 'done' and r2.entries[g2] = h.id
                           order by r2.post_at desc
                           limit 5) y) as last5
            from (select r.ranks[g] as rk
                    from public.races r, generate_subscripts(r.entries, 1) g
                   where not r.is_test and r.status = 'done' and r.entries[g] = h.id) x
        ) rec on true
    ),
    'upcoming', coalesce((
      select jsonb_agg(x.j order by x.post_at)
        from (select app.race_json(r, v_uid) as j, r.post_at
                from public.races r
               where not r.is_test and r.status = 'open' and r.post_at > now()
               order by r.post_at
               limit 2) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x.j order by x.post_at desc)
        from (select app.race_json(r, v_uid) as j, r.post_at
                from public.races r
               where not r.is_test and r.status = 'done'
               order by r.post_at desc
               limit 4) x), '[]'::jsonb),
    'test', case when v_tester then (
      select app.race_json(r, v_uid)
        from public.races r
       where r.is_test and r.created_by = v_uid
       order by r.created_at desc
       limit 1) end
  );
end;
$$;

-- 마권 사기. 정식 경주는 그 자리에서 코인이 빠진다.
create or replace function public.race_bet(
  p_race bigint, p_kind text, p_picks integer[], p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  r       public.races;
  v_p     public.profiles;
  n       integer;
  v_picks smallint[];
  v_sum   integer;
  v_odds  numeric(6, 1);
  v_label text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.race_gate();

  -- 경주 행을 먼저 잠근다(정산과 같은 순서: 경주 → 프로필).
  select * into r from public.races where id = p_race for update;
  if not found or (r.is_test and r.created_by is distinct from v_uid) then
    raise exception 'RACE_NOT_FOUND';
  end if;
  if r.status <> 'open' or now() >= r.post_at then raise exception 'RACE_CLOSED'; end if;

  perform app.require_active();

  n := array_length(r.entries, 1);
  if p_kind is null or p_kind not in ('win', 'place', 'quin') or p_picks is null then
    raise exception 'INVALID_CHOICE';
  end if;
  if exists (select 1 from unnest(p_picks) x where x is null or x < 1 or x > n) then
    raise exception 'INVALID_CHOICE';
  end if;
  if p_kind = 'quin' then
    if coalesce(array_length(p_picks, 1), 0) <> 2 or p_picks[1] = p_picks[2] then
      raise exception 'INVALID_CHOICE';
    end if;
    v_picks := array[least(p_picks[1], p_picks[2]), greatest(p_picks[1], p_picks[2])]::smallint[];
    v_odds  := (r.odds -> 'quin' ->> (v_picks[1] || '-' || v_picks[2]))::numeric;
  else
    if coalesce(array_length(p_picks, 1), 0) <> 1 then raise exception 'INVALID_CHOICE'; end if;
    v_picks := array[p_picks[1]]::smallint[];
    v_odds  := (r.odds -> p_kind ->> (v_picks[1] - 1))::numeric;
  end if;

  if p_amount is null or p_amount < app.race_min_bet() then raise exception 'RACE_BET_LOW'; end if;
  select coalesce(sum(amount), 0) into v_sum
    from public.race_bets where race_id = r.id and user_id = v_uid;
  if v_sum + p_amount > app.race_max_bet() then raise exception 'RACE_BET_HIGH'; end if;

  v_p := app.accrue(v_uid);

  if not r.is_test then
    if v_p.ward_until is not null then raise exception 'IN_WARD'; end if;
    if v_p.coins < p_amount then raise exception 'NOT_ENOUGH_COINS'; end if;
    if v_p.hp < app.hp_per_play() then raise exception 'NO_HP'; end if;

    update public.profiles set coins = coins - p_amount where id = v_uid;
    -- 마권 한 장마다 체력을 쓴다. 0 이 되면 spend_hp 가 병동 사다리로 보낸다.
    v_p := app.spend_hp(v_uid, app.hp_per_play());

    v_label := case p_kind when 'win' then '단승' when 'place' then '연승' else '복승' end;
    perform app.log(v_uid, 'game',
      format('경마 · 제%s경주 %s %s', r.no, v_label, array_to_string(v_picks, '-')),
      -p_amount, v_p.coins, jsonb_build_object('race_id', r.id, 'kind', p_kind,
                                               'picks', v_picks, 'odds', v_odds));
  end if;

  insert into public.race_bets (race_id, user_id, kind, picks, amount, odds)
  values (r.id, v_uid, p_kind, v_picks, p_amount, v_odds);

  return app.state_json(v_p);
end;
$$;

-- 라디오 CH2 — 다음 경주 출전마 중 내게 배정된 몇 두의 컨디션을 하나씩 들려준다.
-- 시험 계정은 열린 테스트 경주가 있으면 그쪽 소식을 듣는다(라디오가 없어도 된다).
create or replace function public.race_radio()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_tester boolean;
  r       public.races;
  t       public.race_tips;
  v_fresh boolean := false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  v_tester := app.race_gate();

  if not v_tester and not exists (
    select 1 from public.inventories
     where user_id = v_uid and item_code = 'radio' and qty > 0) then
    raise exception 'NOT_ENOUGH_ITEMS';
  end if;

  if v_tester then
    select * into r from public.races
     where is_test and created_by = v_uid and status = 'open'
     order by created_at desc limit 1;
  end if;
  if r.id is null then
    perform app.race_ensure(app.today_kst());
    perform app.race_ensure(app.today_kst() + 1);
    select * into r from public.races
     where not is_test and status = 'open' and post_at > now()
     order by post_at limit 1;
  end if;
  if r.id is null then
    return jsonb_build_object('race', null, 'tips', '[]'::jsonb, 'left', 0, 'fresh', false);
  end if;

  insert into public.race_tips (user_id, race_id, gates)
  values (v_uid, r.id,
          app.pick_shuffled(1, array_length(r.entries, 1), app.race_tips_per_race()))
  on conflict do nothing;

  update public.race_tips
     set revealed = revealed + 1
   where user_id = v_uid and race_id = r.id and revealed < array_length(gates, 1)
  returning * into t;
  v_fresh := found;
  if not v_fresh then
    select * into t from public.race_tips where user_id = v_uid and race_id = r.id;
  end if;

  return jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'day', r.day, 'no', r.no, 'is_test', r.is_test,
                               'post_at', r.post_at, 'distance', r.distance, 'track', r.track),
    'tips', coalesce((select jsonb_agg(jsonb_build_object(
                      'gate', g, 'horse', r.entries[g], 'name', h.name,
                      'level', r.cond[g], 'wdelta', r.wdelta[g])
                    order by o)
               from unnest(t.gates[1:t.revealed]) with ordinality u(g, o)
               join public.race_horses h on h.id = r.entries[g]), '[]'::jsonb),
    'left',  array_length(t.gates, 1) - t.revealed,
    'fresh', v_fresh
  );
end;
$$;

-- 시험 계정 전용 테스트: create(편성) · start(지금 발주) · reset_tips(속보 한도 초기화)
create or replace function public.race_admin_test(p_action text, p_opts jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    bigint;
  v_ent   smallint[];
  v_cond  smallint[] := '{}';
  v_wd    smallint[] := '{}';
  v_dist  integer;
  v_track smallint;
  v_delay integer;
  i       integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app.race_is_tester(v_uid) then raise exception 'NOT_ADMIN'; end if;
  p_opts := coalesce(p_opts, '{}'::jsonb);

  if p_action = 'create' then
    delete from public.races
     where is_test and created_by = v_uid
       and (status = 'open' or created_at < now() - interval '1 day');

    v_ent  := app.pick_shuffled(1, 20, app.race_field());
    v_dist := coalesce((p_opts ->> 'distance')::integer,
                       (app.race_distances())[1 + floor(random() * array_length(app.race_distances(), 1))::integer]);
    if not v_dist = any (app.race_distances()) then raise exception 'INVALID_CHOICE'; end if;
    v_track := coalesce((p_opts ->> 'track')::smallint, floor(random() * 4)::smallint);
    if v_track not between 0 and 3 then raise exception 'INVALID_CHOICE'; end if;
    v_delay := least(3600, greatest(10, coalesce((p_opts ->> 'delay_sec')::integer, 120)));
    for i in 1..array_length(v_ent, 1) loop
      v_cond := v_cond || app.race_roll_cond();
      v_wd   := v_wd || app.race_wdelta(v_cond[i]);
    end loop;
    perform app.race_create(app.today_kst(), 0::smallint, true, now() + make_interval(secs => v_delay),
                            v_ent, v_dist, v_track, v_cond, v_wd, v_uid);

  elsif p_action = 'start' then
    select id into v_id from public.races
     where is_test and created_by = v_uid and status = 'open'
     order by created_at desc limit 1;
    if v_id is null then raise exception 'RACE_NOT_FOUND'; end if;
    update public.races set post_at = now() where id = v_id;
    perform app.race_settle(v_id);

  elsif p_action = 'reset_tips' then
    delete from public.race_tips where user_id = v_uid;

  else
    raise exception 'INVALID_CHOICE';
  end if;

  return public.race_card();
end;
$$;


-- -------------------------------------------------------------
-- 7. 권한
-- -------------------------------------------------------------
revoke all on function app.race_stats(smallint[])                                   from public, anon, authenticated;
revoke all on function app.race_run(double precision[], integer, smallint, smallint[]) from public, anon, authenticated;
revoke all on function app.race_odds(double precision[], integer, smallint, integer)   from public, anon, authenticated;
revoke all on function app.race_create(date, smallint, boolean, timestamptz, smallint[], integer, smallint, smallint[], smallint[], uuid)
                                                                                    from public, anon, authenticated;
revoke all on function app.race_ensure(date)                                        from public, anon, authenticated;
revoke all on function app.race_settle(bigint)                                      from public, anon, authenticated;
revoke all on function app.race_settle_due()                                        from public, anon, authenticated;
revoke all on function app.race_is_tester(uuid)                                     from public, anon, authenticated;
revoke all on function app.race_gate()                                              from public, anon, authenticated;
revoke all on function app.race_json(public.races, uuid)                            from public, anon, authenticated;

revoke all on function public.race_card()                                  from public;
revoke all on function public.race_bet(bigint, text, integer[], integer)   from public;
revoke all on function public.race_radio()                                 from public;
revoke all on function public.race_admin_test(text, jsonb)                 from public;
grant execute on function public.race_card()                                to authenticated;
grant execute on function public.race_bet(bigint, text, integer[], integer) to authenticated;
grant execute on function public.race_radio()                               to authenticated;
grant execute on function public.race_admin_test(text, jsonb)               to authenticated;

commit;


-- -------------------------------------------------------------
-- 8. 정산 예약 — 01:01 · 13:01 UTC = 10:01 · 22:01 KST
--    꺼져 있어도 누군가 출전표를 열면 그 자리에서 정산된다.
-- -------------------------------------------------------------
do $$
begin
  perform cron.schedule('race-settle', '1 1,13 * * *', 'select app.race_settle_due();');
  raise notice '경마 정산 예약 완료 — 01:01 · 13:01 UTC = 10:01 · 22:01 KST';
exception when others then
  raise warning 'pg_cron 예약 실패: % / Database > Extensions 에서 pg_cron 을 켠 뒤 이 블록만 다시 실행하세요.', sqlerrm;
end $$;

-- 확인
--   select jobname, schedule, active from cron.job where jobname = 'race-settle';
--   select id, day, no, is_test, post_at, distance, track, status from public.races order by post_at desc limit 6;
--   -- 출전표 생성 시간(몬테카를로) 재기
--   explain analyze select app.race_odds(app.race_stats(array[1,2,3,4,5,6,7,8]::smallint[]), 1600, 1::smallint, app.race_mc_runs());
