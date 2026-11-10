-- 수용실 주간 재배치 — 매주 월요일 오전 6시(KST)에 전원을 다시 섞는다.
--
--   지금까지 수용실은 계정을 발급할 때 한 번 정해지고 그 뒤로 바뀌지 않았다
--   (app.assign_cell() 이 인원이 가장 적은 방에 밀어 넣는 게 전부였다).
--   이제는 매주 월요일 06:00 KST 에 app.cell_rotate() 가 돌아
--   전원을 무작위로 줄 세워 3인 1실로 다시 배치한다.
--
--   방 이름표는 동 1~9 · 실 01~11 안에서만 뽑고 서로 겹치지 않게 짝짓는다.
--   실이 11개라 방 11개(33명)까지는 실이 유일하고, 방이 9개를 넘어가는
--   순간부터 동이 겹치기 시작한다. 그보다 더 늘어나면 동·실 둘 다 재사용한다.
--
--   대상은 not hidden 인 사람 전원 — 병동에 있어도 방은 그대로 배정받고,
--   관리자(hidden)는 예전처럼 수용실을 갖지 않는다.
--
--   이 저장소에 주기 작업이 들어오는 것은 이번이 처음이다. pg_cron 을 쓰되,
--   app.cell_rotate() 자체가 '이번 주차를 이미 돌았는지'를 표(cell_rotations)로
--   들고 있어서 두 번 튀거나 손으로 한 번 더 돌려도 한 주에 한 번만 돈다.
--
-- 라이브 DB 에는 02_schema.sql 전체를 다시 돌리지 말고 이 파일만 실행한다.
-- (내용은 02_schema.sql 에 이미 반영되어 있다. 적용 후 이 파일은 지워도 된다.)
--
-- 실행 전 준비: Supabase 대시보드 Database → Extensions 에서 pg_cron 을 켠다.
--   꺼져 있어도 이 파일은 끝까지 실행되지만, 맨 아래 예약 블록이 경고만 남기고
--   넘어간다. 그때는 확장을 켠 뒤 예약 블록만 다시 실행하면 된다.
--
-- 배포 순서: 서버(이 패치)를 먼저 올려도 되고 클라이언트를 먼저 올려도 된다.
--   내려주는 필드(cell_id·cell)가 그대로라 옛 클라이언트도 그냥 동작한다.
--
-- 첫 재배치 시각: 이 패치는 맨 끝에서 '이번 주차'를 이미 돈 것으로 찍어 둔다.
--   따라서 올리는 순간에는 방이 바뀌지 않고, 다음 월요일 06:05 KST 에 처음 돈다.
--
-- 롤백: select cron.unschedule('cell-rotate-weekly'); 로 예약만 끄면 방은 그 자리에
--   멈춘다. 함수까지 되돌리려면 app.assign_cell() 을 예전 정의(정원이 남은 방 →
--   없으면 max(block)+1 로 새 방)로 다시 create or replace 한다.
--   이미 섞인 배치는 되돌릴 수 없다.

begin;

-- -------------------------------------------------------------
-- 주차 기준 시각
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

-- 어느 주차를 이미 돌았는지 적어 두는 표. 이 한 줄이 중복 실행을 막는다.
create table if not exists public.cell_rotations (
  week_at timestamptz primary key,
  done_at timestamptz not null default now(),
  rooms   integer not null default 0,
  people  integer not null default 0
);

-- public.cells 와 마찬가지로 RLS 만 켜고 정책은 두지 않는다 = 클라이언트는 못 읽는다.
alter table public.cell_rotations enable row level security;

-- -------------------------------------------------------------
-- 이름표 뽑기
-- -------------------------------------------------------------

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

-- -------------------------------------------------------------
-- 재배치 본체
-- -------------------------------------------------------------

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

-- -------------------------------------------------------------
-- 주 중간에 계정을 발급할 때 — 이름표가 1~9동 / 01~11실 을 벗어나지 않게
-- -------------------------------------------------------------

-- 예전 함수는 방이 전부 차면 max(block)+1 로 새 방을 만들었다. 그대로 두면
-- 주 중간에 한 명만 발급해도 10동이 생겨 규칙이 깨진다. 새 방은 안 쓴 실 →
-- 안 쓴 동 순으로 골라 연다(어차피 다음 월요일에 전부 다시 뽑힌다).
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
  -- 1) 정원이 남은 방 중 인원이 가장 적은 곳. 동률이면 동·호실이 앞선 쪽.
  select c.id into v_id
    from public.cells c
    left join public.profiles p on p.cell_id = c.id
   group by c.id, c.block, c.room
  having count(p.id) < app.cell_capacity()
   order by count(p.id), c.block, c.room
   limit 1;

  if found then return v_id; end if;

  -- 2) 전부 찼으면 새 방. 아직 안 쓴 실을 먼저, 그 다음 안 쓴 동을 우선한다.
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

revoke all on function app.cell_week_kst()                     from public, anon, authenticated;
revoke all on function app.pick_shuffled(integer, integer, integer) from public, anon, authenticated;
revoke all on function app.cell_rotate()                       from public, anon, authenticated;

-- 이번 주차는 이미 돈 것으로 찍어 둔다 — 패치를 올리는 즉시 방이 바뀌면
-- 곤란하므로, 첫 재배치는 다음 월요일 06:05 KST 다.
insert into public.cell_rotations (week_at) values (app.cell_week_kst())
on conflict (week_at) do nothing;

commit;


-- -------------------------------------------------------------
-- pg_cron 예약 — 일요일 21:05 UTC = 월요일 06:05 KST
--
--   cron 표현식은 DB 의 timezone 설정(Supabase 기본값 UTC)을 따른다.
--   실행 전 `show timezone;` 로 UTC 인지 확인한다.
--
--   정각(21:00)이 아니라 5분 뒤로 잡은 이유: 조금이라도 일찍 튀면
--   app.cell_week_kst() 가 아직 지난주를 가리켜 그 주 재배치를 통째로
--   건너뛰게 된다.
--
--   아래 두 블록은 pg_cron 이 꺼져 있어도 패치를 망가뜨리지 않도록
--   경고만 남기고 넘어간다.
-- -------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise warning 'pg_cron 확장을 만들지 못했습니다: %', sqlerrm;
end $$;

do $$
begin
  perform cron.unschedule('cell-rotate-weekly');
exception when others then
  null;  -- 예약이 아직 없으면 그냥 넘어간다
end $$;

do $$
begin
  perform cron.schedule('cell-rotate-weekly', '5 21 * * 0', 'select app.cell_rotate();');
  raise notice '주간 재배치 예약 완료 — 일 21:05 UTC = 월 06:05 KST';
exception when others then
  raise warning 'pg_cron 예약 실패: % / Supabase 대시보드 Database > Extensions 에서 pg_cron 을 켠 뒤 이 블록만 다시 실행하세요.', sqlerrm;
end $$;

-- 확인
--   select jobname, schedule, command, active from cron.job where jobname = 'cell-rotate-weekly';
--   select * from public.cell_rotations order by week_at desc;
--   select app.cell_label(c.block, c.room) as 수용실, p.username
--     from public.profiles p join public.cells c on c.id = p.cell_id
--    order by 1, 2;
