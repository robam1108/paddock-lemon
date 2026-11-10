-- =============================================================
--  23. 운동기구 — 착용하면 특이사항에 한 줄이 1시간 남는다
--
--  아령·악력기·하모니카·리코더(item_defs, 사치품)는 라디오(21_radio.sql)와 같은 방식이다.
--  flex_kind = 'consume' · flex_hours = 1 이지만 쓴다고 사라지지 않는다 —
--  flex_use 는 한 개를 거두므로 여기서 따로 착용한다. 보유만 확인하고, 과시
--  상태는 기존 app.flex_apply 를 그대로 쓴다(동시 소모 칸 규칙도 같이 따른다).
--  착용 중에는 소지품 버튼이 `해제` 로 바뀌고, 해제하면(gear_off) 특이사항도
--  바로 사라진다. 1시간이 지나면 저절로 풀린다. 풀린 뒤에는 언제든 다시 착용한다.
--
--  새 운동기구는 app.gear_codes() 에 code 한 줄, 17_items.sql 에 행 하나,
--  src/lib/gear.ts 에 code 하나를 더하면 끝이다.
--
--  적용 순서: 00_rules.sql(app.flex_consume_limit) · 17_items.sql(운동기구 행) 뒤.
--  새 함수뿐이라 라이브에도 통째로 돌린다.
-- =============================================================

begin;

create or replace function app.gear_codes() returns text[]
language sql immutable as $$ select array['dumbbell', 'hand_gripper', 'harmonica', 'recorder'] $$;

create or replace function public.gear_on(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_p      public.profiles;
  v_qty    integer;
  v_gifted integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform app.require_active();

  v_p := app.accrue(v_uid);

  if p_code is null or not (p_code = any(app.gear_codes())) then
    raise exception 'NO_SUCH_ITEM';
  end if;

  select qty, gifted_qty into v_qty, v_gifted
    from public.inventories
   where user_id = v_uid and item_code = p_code;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  -- 이미 착용 중이면 화면에는 `해제` 만 뜬다 — 두 번 눌려 시간이 늘어나지 않게 막는다.
  if exists (select 1 from public.player_flex
              where user_id = v_uid and item_code = p_code and expires_at > now()) then
    raise exception 'GEAR_ACTIVE';
  end if;

  perform app.flex_apply(v_uid, p_code, coalesce(v_gifted, 0) > 0);

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

create or replace function public.gear_off(p_code text)
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

  if p_code is null or not (p_code = any(app.gear_codes())) then
    raise exception 'NO_SUCH_ITEM';
  end if;

  delete from public.player_flex
   where user_id = v_uid and item_code = p_code and expires_at > now();
  if not found then raise exception 'NOT_EQUIPPED'; end if;

  v_p := app.accrue(v_uid);
  return app.state_json(v_p);
end;
$$;

revoke all on function public.gear_on(text)  from public;
revoke all on function public.gear_off(text) from public;
grant execute on function public.gear_on(text)  to authenticated;
grant execute on function public.gear_off(text) to authenticated;

commit;
