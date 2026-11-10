-- =============================================================
--  21. 라디오 — 켜면 특이사항에 한 줄이 1시간 남는다
--
--  라디오(item_defs 'radio', 사치품·희귀)는 flex_kind = 'consume' · flex_hours = 1
--  이지만 쓴다고 사라지지 않는다. flex_use 는 한 개를 거두므로 여기서 따로 켠다 —
--  보유만 확인하고, 과시 상태는 기존 app.flex_apply 를 그대로 쓴다(다시 켜면
--  남은 시간이 늘지만 2시간을 넘지 않고, 동시 소모 칸 규칙도 같이 따른다).
--  무엇을 틀지(유튜브 목록)는 화면이 고른다(src/lib/radio.ts).
--
--  적용 순서: 17_items.sql(라디오 행) 뒤. 라이브는 repair/2026-10-07_radio_discount.sql
--  → 17_items.sql → 클라이언트 배포.
-- =============================================================

begin;

create or replace function public.radio_on(p_code text)
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

  if p_code is distinct from 'radio' then raise exception 'NO_SUCH_ITEM'; end if;

  select qty, gifted_qty into v_qty, v_gifted
    from public.inventories
   where user_id = v_uid and item_code = p_code;
  if coalesce(v_qty, 0) < 1 then raise exception 'NOT_ENOUGH_ITEMS'; end if;

  perform app.flex_apply(v_uid, p_code, coalesce(v_gifted, 0) > 0);

  select * into v_p from public.profiles where id = v_uid;
  return app.state_json(v_p);
end;
$$;

revoke all on function public.radio_on(text) from public;
grant execute on function public.radio_on(text) to authenticated;

commit;
