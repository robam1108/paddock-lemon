-- =============================================================
--  01. 특선 도시락 — ★ 날짜 한 줄만 고치면 켜지고 꺼진다
--
--  지정한 하루(KST)만 배급 도시락 세 끼(08:00 · 12:00 · 19:00)가 전부
--  특선 도시락으로 나간다. 배급 시각도 끼니 수도 그대로고, 같은 자리에 다른
--  것이 담길 뿐이다. 날짜가 지나면 아무 조치 없이 평소 도시락으로 돌아간다.
--
--  끄려면 지난 날짜로 바꿔 이 파일만 다시 돌린다. 스위치는 아래 날짜 하나뿐이다.
--  품목 자체(체력 +18 · 게임 횟수 +1)는 17_items.sql 이 정한다.
--
--  app.meal_item_at() 은 02_schema.sql 의 app.accrue() 가 밀린 배급을 채울 때
--  부른다 — 정산이 특선일을 걸쳐 있으면 그 날 몫만 특선으로 나뉘어 들어간다.
--  함수 본문은 실행 시점에 이름을 찾으므로, 이 파일이 02 보다 먼저 와도 된다.
-- =============================================================

-- 하루만 도시락 대신 특선 도시락이 나가는 날(KST). 이 날짜가 지나면
-- 아무 조치 없이 평소 배급으로 돌아간다. 끄려면 지난 날짜로 바꾸면 된다.
create or replace function app.special_meal_date() returns date
  language sql immutable as $$ select date '2026-09-18' $$;

create or replace function app.special_meal_item() returns text
  language sql immutable as $$ select 'lunchbox_special' $$;

-- 배급 슬롯 하나가 어떤 품목이 되는지. 날짜 경계는 KST 자정이다
-- (app.today_kst() 의 06시 경계가 아니다 — 그랬다간 19시 배급이 다음 날로 밀린다).
create or replace function app.meal_item_at(p_slot timestamptz) returns text
  language sql stable as $$
    select case when (timezone('Asia/Seoul', p_slot))::date = app.special_meal_date()
                then app.special_meal_item()
                else app.meal_item() end
  $$;

revoke all on function app.special_meal_date()        from public, anon, authenticated;
revoke all on function app.special_meal_item()        from public, anon, authenticated;
revoke all on function app.meal_item_at(timestamptz)  from public, anon, authenticated;
