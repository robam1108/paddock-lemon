-- =============================================================
--  20. 추석 특집 — 랜덤 송편 이벤트 (한정, 2026-09-26 KST 까지)
--
--  9/24 저녁 배급 시각(app.chuseok_coupon_at())이 지나면 app.accrue 가 송편 쿠폰을
--  한 장 넣는다(02_schema.sql, 병동·체력 0 이어도 준다). 소지품에서 쿠폰을 쓰면
--  팝업이 뜨고, 쿠폰을 거두면서 흰·쑥·분홍 송편 셋 중 하나가 뽑힌다.
--  한 사람에 딱 하나 — 뽑기 결과는 이 표에 남아 새로고침해도 다시 뽑히지 않는다.
--  마음에 안 들면 딱 한 번 "한 번 더 뽑기" 로 새 결과와 바꿀 수 있다(교체).
--
--  뽑힌 송편은 소지품에 들어오고, 먹으면(public.use_songpyeon) 9월 26일까지
--    · 특이사항에 한 줄이 남는다(player_flex, expires_at = app.chuseok_end())
--    · 등급별 효과가 붙는다(profiles.chuseok_grade)
--        흰 송편(고급)  하루 게임 +5판 (아이템 회복 총량과 별개 — 최대 33판)
--        쑥 송편(희귀)  매일 첫 5판의 판돈 +15 코인
--        분홍 송편(특급) 매일 첫 7판의 판돈 +30 코인
--  효과 크기·끝나는 시각·뽑기 분포는 전부 00_rules.sql 의 app.chuseok_* 가 쥔다.
--  판돈 추가는 play_game / highlow_begin 이 app.chuseok_charge 로 쓴다(02_schema.sql).
--
--  적용 순서: 17_items.sql(송편 세 품목) 뒤. 라이브는 repair/2026-09-24_chuseok.sql
--  → 17_items.sql → 이 파일 → 클라이언트 배포.
--
--  끝나면: 9/27 00:01 KST 에 pg_cron 이 안 먹은 송편을 거두고 등급을 지운 뒤
--  스스로 예약을 내린다. pg_cron 이 없어도 효과는 app.chuseok_end() 로 꺼진다 —
--  남는 건 못 먹는 송편뿐이고, 그건 select app.chuseok_cleanup(); 로 치운다.
-- =============================================================

begin;

create table if not exists public.chuseok_draws (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  grade    text not null check (grade in ('uncommon', 'rare', 'epic')),
  -- 한 번 더 뽑기를 썼는지. 쓰면 그 결과로 확정(done)된다.
  rerolled boolean not null default false,
  -- 받기를 눌렀거나, 다시 뽑았거나, 송편을 먹었으면 true — 팝업이 더는 안 뜬다.
  done     boolean not null default false,
  drawn_at timestamptz not null default now()
);

-- 정책을 만들지 않는다 — 아래 RPC 로만 읽고 쓴다.
alter table public.chuseok_draws enable row level security;


-- 뽑은 등급의 송편 하나를 넣는다.
create or replace function app.chuseok_give(p_uid uuid, p_grade text)
returns void
language sql
security definer
set search_path = public, app
as $$
  insert into public.inventories (user_id, item_code, qty)
  values (p_uid, app.chuseok_code(p_grade), 1)
  on conflict (user_id, item_code) do update set qty = inventories.qty + 1;
$$;

create or replace function app.chuseok_draw_json(d public.chuseok_draws)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'open',     now() < app.chuseok_end(),
    'grade',    d.grade,
    'rerolled', coalesce(d.rerolled, false),
    'done',     coalesce(d.done, false));
$$;


-- 팝업을 띄울지. 이벤트 기간이고 아직 확정하지 않았으면 뜬다.
create or replace function public.chuseok_state()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid uuid := auth.uid();
  v_d   public.chuseok_draws;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_d from public.chuseok_draws where user_id = v_uid;
  return app.chuseok_draw_json(v_d);
end;
$$;


-- 첫 뽑기(송편 쿠폰 사용). 쿠폰 한 장을 거두고 뽑는다 — 없으면 NOT_ENOUGH_ITEMS.
-- 이미 뽑았으면 쿠폰을 건드리지 않고 그 결과를 그대로 돌려준다.
create or replace function public.chuseok_draw()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_d     public.chuseok_draws;
  v_grade text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if now() >= app.chuseok_end() then raise exception 'EVENT_OVER'; end if;

  -- 동시에 두 번 불려도 한 번만 뽑히도록 프로필 행을 잠근다.
  perform 1 from public.profiles where id = v_uid for update;

  select * into v_d from public.chuseok_draws where user_id = v_uid;
  if found then return app.chuseok_draw_json(v_d); end if;

  perform app.take_one_item(v_uid, 'songpyeon_coupon');

  v_grade := app.chuseok_roll();
  insert into public.chuseok_draws (user_id, grade) values (v_uid, v_grade)
  returning * into v_d;
  perform app.chuseok_give(v_uid, v_grade);

  return app.chuseok_draw_json(v_d);
end;
$$;


-- 한 번 더 뽑기. 앞의 송편을 거두고 새로 뽑은 것으로 바꾼다. 딱 한 번, 그 결과로 확정.
create or replace function public.chuseok_reroll()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid   uuid := auth.uid();
  v_d     public.chuseok_draws;
  v_grade text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();
  if now() >= app.chuseok_end() then raise exception 'EVENT_OVER'; end if;

  select * into v_d from public.chuseok_draws where user_id = v_uid for update;
  if not found then raise exception 'NOT_DRAWN'; end if;
  if v_d.rerolled or v_d.done then raise exception 'ALREADY_REROLLED'; end if;

  -- 앞의 송편이 아직 가방에 있어야 바꿀 수 있다(없으면 NOT_ENOUGH_ITEMS).
  perform app.take_one_item(v_uid, app.chuseok_code(v_d.grade));

  v_grade := app.chuseok_roll();
  update public.chuseok_draws
     set grade = v_grade, rerolled = true, done = true, drawn_at = now()
   where user_id = v_uid
  returning * into v_d;
  perform app.chuseok_give(v_uid, v_grade);

  return app.chuseok_draw_json(v_d);
end;
$$;


-- 받기. 지금 결과로 확정하고 팝업을 닫는다.
create or replace function public.chuseok_finish()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid uuid := auth.uid();
  v_d   public.chuseok_draws;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  update public.chuseok_draws set done = true
   where user_id = v_uid
  returning * into v_d;
  if not found then raise exception 'NOT_DRAWN'; end if;

  return app.chuseok_draw_json(v_d);
end;
$$;


-- 송편을 먹는다. 효과는 한 사람에 하나 — 이미 먹었으면 ALREADY_ACTIVE.
create or replace function public.use_songpyeon(p_code text)
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

  v_p := app.accrue(v_uid);

  select * into v_def from public.item_defs where code = p_code;
  if not found then raise exception 'NO_SUCH_ITEM'; end if;
  -- 쿠폰도 kind='event' 지만 먹는 게 아니라 뽑기(chuseok_draw)에 쓴다.
  if v_def.kind <> 'event' or p_code = 'songpyeon_coupon' then raise exception 'NOT_USABLE'; end if;
  if now() >= app.chuseok_end() then raise exception 'EVENT_OVER'; end if;
  if v_p.chuseok_grade is not null then raise exception 'ALREADY_ACTIVE'; end if;

  perform app.take_one_item(v_uid, p_code);

  update public.profiles
     set chuseok_grade = v_def.grade,
         chuseok_day   = app.today_kst(),
         chuseok_used  = 0
   where id = v_uid
  returning * into v_p;

  -- 특이사항 한 줄. 이벤트가 끝나는 시각에 만료되고, app.accrue 가 치운다.
  insert into public.player_flex (user_id, item_code, gifted, expires_at, started_at)
  values (v_uid, p_code, false, app.chuseok_end(), now())
  on conflict (user_id, item_code) do update
     set expires_at = excluded.expires_at, started_at = excluded.started_at;

  update public.chuseok_draws set done = true where user_id = v_uid;

  return app.state_json(v_p);
end;
$$;


-- 이벤트 뒤 정리. 안 먹은 송편을 거두고 등급을 지운다. 여러 번 돌려도 안전하다.
create or replace function app.chuseok_cleanup()
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if now() < app.chuseok_end() then return; end if;

  delete from public.inventories
   where item_code in ('songpyeon_coupon', 'songpyeon_white', 'songpyeon_green', 'songpyeon_pink');
  delete from public.player_flex
   where item_code in ('songpyeon_white', 'songpyeon_green', 'songpyeon_pink');
  update public.profiles
     set chuseok_grade = null, chuseok_day = null, chuseok_used = 0
   where chuseok_grade is not null;

  begin
    perform cron.unschedule('chuseok-cleanup');
  exception when others then
    null;  -- pg_cron 이 없거나 이미 내려갔다
  end;
end;
$$;


revoke all on function app.chuseok_give(uuid, text)             from public, anon, authenticated;
revoke all on function app.chuseok_draw_json(public.chuseok_draws) from public, anon, authenticated;
revoke all on function app.chuseok_cleanup()                     from public, anon, authenticated;

revoke all on function public.chuseok_state()           from public;
revoke all on function public.chuseok_draw()            from public;
revoke all on function public.chuseok_reroll()          from public;
revoke all on function public.chuseok_finish()          from public;
revoke all on function public.use_songpyeon(text)       from public;
grant execute on function public.chuseok_state()        to authenticated;
grant execute on function public.chuseok_draw()         to authenticated;
grant execute on function public.chuseok_reroll()       to authenticated;
grant execute on function public.chuseok_finish()       to authenticated;
grant execute on function public.use_songpyeon(text)    to authenticated;

commit;


-- -------------------------------------------------------------
-- pg_cron 예약 — 9/26 15:01 UTC = 9/27 00:01 KST 에 한 번 돌고 스스로 내려간다.
-- pg_cron 이 꺼져 있어도 이 파일은 끝까지 돈다(13_cell_rotation.sql 과 같은 방식).
-- -------------------------------------------------------------
do $$
begin
  perform cron.unschedule('chuseok-cleanup');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule('chuseok-cleanup', '1 15 26 9 *', 'select app.chuseok_cleanup();');
  raise notice '추석 정리 예약 완료 — 9/26 15:01 UTC = 9/27 00:01 KST';
exception when others then
  raise warning 'pg_cron 예약 실패: % / 9/27 이후 select app.chuseok_cleanup(); 을 직접 실행하세요.', sqlerrm;
end $$;

-- 확인
--   select grade, count(*) from public.chuseok_draws group by 1;
--   select username, chuseok_grade, chuseok_day, chuseok_used from public.profiles where chuseok_grade is not null;
--   select jobname, schedule, active from cron.job where jobname = 'chuseok-cleanup';
