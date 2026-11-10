-- =============================================================
--  MINI CASINO - 관리자용 계정 발급 도구
--
--  Supabase 대시보드 > SQL Editor 에서 실행하세요.
--  02_schema.sql 을 먼저 실행한 뒤에 이 파일을 실행합니다.
--
--  여기 정의된 함수들은 SQL Editor(postgres 권한)에서만 실행할 수 있고,
--  사이트를 통해서는 절대 호출할 수 없습니다(맨 아래 revoke 참고).
-- =============================================================

create extension if not exists pgcrypto with schema extensions;


-- -------------------------------------------------------------
-- 이름 -> 로그인용 이메일
--   한글 이름을 이메일에 그대로 쓸 수 없으므로 UTF-8 바이트를 16진수로 인코딩한다.
--   src/lib/auth.ts 의 nameToEmail() 과 반드시 동일한 규칙이어야 한다.
-- -------------------------------------------------------------
create or replace function public.name_to_email(p_name text)
returns text
language sql
immutable
as $$
  select encode(convert_to(lower(btrim(p_name)), 'UTF8'), 'hex') || '@minicasino.local';
$$;


-- -------------------------------------------------------------
-- 플레이어 발급
--   사용법:  select admin_create_player('윤태강', '6175-3XPWT9');
-- -------------------------------------------------------------
-- 회원 등급 폐지로 시그니처가 (text, text, text) -> (text, text) 로 돌아왔다.
drop function if exists public.admin_create_player(text, text, text);

create or replace function public.admin_create_player(p_name text, p_code text)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_display text := btrim(p_name);
  v_email   text;
  v_id      uuid := gen_random_uuid();
begin
  if v_display = '' then
    raise exception '이름이 비어 있습니다.';
  end if;
  if length(btrim(p_code)) < 4 then
    raise exception '코드는 4자 이상이어야 합니다.';
  end if;

  v_email := public.name_to_email(v_display);

  if exists (select 1 from auth.users where email = v_email) then
    raise exception '이미 발급된 이름입니다: %', v_display;
  end if;

  -- 주의: 아래 토큰 컬럼들을 반드시 빈 문자열('')로 채워야 한다.
  -- 인증 서버(GoTrue)는 이 컬럼들을 NULL 을 허용하지 않는 문자열로 읽기 때문에,
  -- NULL 로 두면 로그인할 때 "Database error querying schema" 500 이 발생한다.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id,
    'authenticated', 'authenticated',
    v_email, extensions.crypt(btrim(p_code), extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_display),
    false, false,
    '', '',
    '', '', '',
    '', '', ''
  );

  -- 비밀번호 로그인이 동작하려면 identities 행이 함께 있어야 한다.
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  -- 관리자 페이지에서 코드를 확인할 수 있도록 따로 보관해 둔다.
  insert into public.player_codes (user_id, code)
  values (v_id, btrim(p_code))
  on conflict (user_id) do update set code = excluded.code, updated_at = now();

  return format('발급 완료 — 이름: %s / 코드: %s', v_display, btrim(p_code));
end;
$$;

-- 회원 등급이 폐지되어 더는 쓰지 않는다.
drop function if exists public.admin_set_grade(text, text);


-- -------------------------------------------------------------
-- 코드 변경
--   사용법:  select admin_reset_code('윤태강', '6175-K7QM4B');
-- -------------------------------------------------------------
create or replace function public.admin_reset_code(p_name text, p_code text)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := public.name_to_email(p_name);
  v_n     integer;
begin
  if length(btrim(p_code)) < 4 then
    raise exception '코드는 4자 이상이어야 합니다.';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(btrim(p_code), extensions.gen_salt('bf')),
         updated_at = now()
   where email = v_email;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name);
  end if;

  insert into public.player_codes (user_id, code)
  select id, btrim(p_code) from auth.users where email = v_email
  on conflict (user_id) do update set code = excluded.code, updated_at = now();

  return format('코드 변경 완료 — 이름: %s / 새 코드: %s', btrim(p_name), btrim(p_code));
end;
$$;


-- -------------------------------------------------------------
-- 코드 재발급 — 이름만으로 새 형식(수용번호-영대문자숫자6자리) 코드를 다시 뽑는다.
--   사용법:  select admin_regen_code('윤태강');   -> 새 코드를 돌려준다
-- -------------------------------------------------------------
create or replace function public.admin_regen_code(p_name text)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions, app
as $$
declare
  v_code text := app.gen_code(btrim(p_name));
begin
  perform public.admin_reset_code(p_name, v_code);
  return v_code;
end;
$$;


-- -------------------------------------------------------------
-- 플레이어 삭제 (게임 기록까지 함께 지워집니다)
--   사용법:  select admin_delete_player('윤태강');
-- -------------------------------------------------------------
create or replace function public.admin_delete_player(p_name text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_n integer;
begin
  delete from auth.users where email = public.name_to_email(p_name);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name);
  end if;
  return format('삭제 완료 — %s', btrim(p_name));
end;
$$;


-- -------------------------------------------------------------
-- 플레이어 목록
--   사용법:  select * from admin_list_players();
-- -------------------------------------------------------------
drop function if exists public.admin_list_players();

create or replace function public.admin_list_players()
returns table (
  이름       text,
  코인       integer,
  체력       integer,
  상태       text,
  빚         integer,
  남은횟수   integer,
  발급일     timestamptz
)
language sql
security definer
set search_path = public, app
as $$
  select p.username,
         p.coins,
         p.hp,
         app.hp_status(p.hp),
         p.debt,
         greatest(0, app.daily_play_limit() + p.bonus_plays - p.plays_used),
         p.created_at
    from public.profiles p
   order by p.created_at;
$$;


-- -------------------------------------------------------------
-- 대출 심사
--   대기 목록:  select * from admin_list_loans();
--   승인:       select admin_approve_loan(1);
--   거절:       select admin_reject_loan(1, '사유');
-- -------------------------------------------------------------
create or replace function public.admin_list_loans(p_status text default 'pending')
returns table (
  번호     bigint,
  이름     text,
  금액     integer,
  상태     text,
  신청일   timestamptz,
  처리일   timestamptz,
  메모     text
)
language sql
security definer
set search_path = public
as $$
  select l.id, l.username, l.amount, l.status, l.created_at, l.decided_at, l.note
    from public.loan_requests l
   where p_status is null or l.status = p_status
   order by l.created_at;
$$;

create or replace function public.admin_approve_loan(p_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan public.loan_requests;
begin
  select * into v_loan from public.loan_requests where id = p_id for update;
  if not found then
    raise exception '그런 신청이 없습니다: %', p_id;
  end if;
  if v_loan.status <> 'pending' then
    raise exception '이미 처리된 신청입니다 (현재 상태: %)', v_loan.status;
  end if;

  -- 승인 즉시 코인을 지급하고 같은 금액을 빚으로 기록한다.
  update public.profiles
     set coins = coins + v_loan.amount,
         debt  = debt  + v_loan.amount
   where id = v_loan.user_id;

  update public.loan_requests
     set status = 'approved', decided_at = now()
   where id = p_id;

  return format('승인 — %s 에게 %s 코인 지급', v_loan.username, v_loan.amount);
end;
$$;

create or replace function public.admin_reject_loan(p_id bigint, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan public.loan_requests;
begin
  select * into v_loan from public.loan_requests where id = p_id for update;
  if not found then
    raise exception '그런 신청이 없습니다: %', p_id;
  end if;
  if v_loan.status <> 'pending' then
    raise exception '이미 처리된 신청입니다 (현재 상태: %)', v_loan.status;
  end if;

  update public.loan_requests
     set status = 'rejected', decided_at = now(), note = p_note
   where id = p_id;

  return format('거절 — %s 의 %s 코인 신청', v_loan.username, v_loan.amount);
end;
$$;

-- -------------------------------------------------------------
-- 체력 / 병동 / 아이템
--   체력 설정:  select admin_set_hp('윤태강', 100);
--   퇴원 시키기: select admin_discharge('윤태강');
--   아이템 지급: select admin_give_item('윤태강', 'lunchbox', 3);
-- -------------------------------------------------------------
create or replace function public.admin_set_hp(p_name text, p_hp integer)
returns text
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_n integer;
begin
  if p_hp < 0 or p_hp > app.hp_max() then
    raise exception '체력은 0 ~ % 사이여야 합니다.', app.hp_max();
  end if;

  update public.profiles
     set hp = p_hp,
         hp_at = now(),
         meals_at = now(),
         ward_until = case when p_hp > 0 then null else ward_until end
   where username = btrim(p_name);

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name); end if;
  return format('%s -> 체력 %s (%s)', btrim(p_name), p_hp, app.hp_status(p_hp));
end;
$$;

create or replace function public.admin_discharge(p_name text)
returns text
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_n integer;
begin
  update public.profiles
     set ward_until = null,
         hp = greatest(hp, app.discharge_hp()),
         hp_at = now(),
         meals_at = now()
   where username = btrim(p_name);

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name); end if;
  return format('%s 퇴원 처리 완료', btrim(p_name));
end;
$$;

create or replace function public.admin_give_item(p_name text, p_code text, p_qty integer default 1)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name); end if;
  if not exists (select 1 from public.item_defs where code = p_code) then
    raise exception '그런 아이템이 없습니다: %', p_code;
  end if;

  insert into public.inventories (user_id, item_code, qty)
  values (v_id, p_code, greatest(0, p_qty))
  on conflict (user_id, item_code)
    do update set qty = greatest(0, inventories.qty + p_qty);

  return format('%s -> %s %s개', btrim(p_name), p_code, p_qty);
end;
$$;


-- 빚 조정 (탕감 등)
create or replace function public.admin_set_debt(p_name text, p_debt integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_debt < 0 then
    raise exception '빚은 0 이상이어야 합니다.';
  end if;
  update public.profiles set debt = p_debt where username = btrim(p_name);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name);
  end if;
  return format('%s -> 빚 %s', btrim(p_name), p_debt);
end;
$$;


-- -------------------------------------------------------------
-- 코인 지급 / 회수
--   코인은 매일 보충되지 않으므로, 다 쓴 플레이어는 관리자가 채워줘야 한다.
--   지급:  select admin_give_coins('윤태강', 20);
--   설정:  select admin_set_coins('윤태강', 20);
-- -------------------------------------------------------------
create or replace function public.admin_give_coins(p_name text, p_amount integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins integer;
begin
  update public.profiles
     set coins = greatest(0, coins + p_amount)
   where username = btrim(p_name)
  returning coins into v_coins;

  if v_coins is null then
    raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name);
  end if;
  return format('%s -> 코인 %s (%s%s)', btrim(p_name), v_coins,
                case when p_amount >= 0 then '+' else '' end, p_amount);
end;
$$;

create or replace function public.admin_set_coins(p_name text, p_coins integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_coins < 0 then
    raise exception '코인은 0 이상이어야 합니다.';
  end if;

  update public.profiles set coins = p_coins where username = btrim(p_name);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name);
  end if;
  return format('%s -> 코인 %s', btrim(p_name), p_coins);
end;
$$;


-- -------------------------------------------------------------
-- 하루 횟수를 즉시 초기화하고 싶을 때 (테스트용)
--   전체:        select admin_reset_today(null);
--   특정 플레이어: select admin_reset_today('윤태강');
-- -------------------------------------------------------------
create or replace function public.admin_reset_today(p_name text default null)
returns text
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_n integer;
begin
  -- 코인은 건드리지 않는다. 코인을 채우려면 admin_give_coins() 를 쓴다.
  update public.profiles
     set plays_used = 0
   where p_name is null or username = btrim(p_name);

  get diagnostics v_n = row_count;
  return format('%s명 초기화 완료', v_n);
end;
$$;


-- -------------------------------------------------------------
-- 중요: 관리자 함수는 사이트(anon / authenticated)에서 호출할 수 없어야 한다.
--       SECURITY DEFINER 함수이므로 이 revoke 가 빠지면 누구나 계정을 만들거나
--       자기 플레이 횟수를 초기화할 수 있게 된다.
-- -------------------------------------------------------------
revoke all on function public.admin_create_player(text, text)       from public, anon, authenticated;
revoke all on function public.admin_reset_code(text, text)          from public, anon, authenticated;
revoke all on function public.admin_regen_code(text)                from public, anon, authenticated;
revoke all on function public.admin_delete_player(text)             from public, anon, authenticated;
revoke all on function public.admin_list_players()                  from public, anon, authenticated;
revoke all on function public.admin_reset_today(text)               from public, anon, authenticated;
revoke all on function public.admin_give_coins(text, integer)       from public, anon, authenticated;
revoke all on function public.admin_set_coins(text, integer)        from public, anon, authenticated;
revoke all on function public.admin_set_debt(text, integer)         from public, anon, authenticated;
revoke all on function public.admin_set_hp(text, integer)           from public, anon, authenticated;
revoke all on function public.admin_discharge(text)                 from public, anon, authenticated;
revoke all on function public.admin_give_item(text, text, integer)  from public, anon, authenticated;
revoke all on function public.admin_list_loans(text)                from public, anon, authenticated;
revoke all on function public.admin_approve_loan(bigint)            from public, anon, authenticated;
revoke all on function public.admin_reject_loan(bigint, text)       from public, anon, authenticated;
revoke all on function public.name_to_email(text)                   from public, anon, authenticated;


-- -------------------------------------------------------------
-- 복구: 이미 발급된 계정의 NULL 토큰 컬럼을 빈 문자열로 채운다.
--       (위 주의사항이 반영되기 전에 만든 계정을 로그인 가능하게 되돌린다)
--       이 파일을 다시 실행하면 매번 안전하게 재적용된다.
-- -------------------------------------------------------------
update auth.users
   set confirmation_token          = coalesce(confirmation_token, ''),
       recovery_token              = coalesce(recovery_token, ''),
       email_change                = coalesce(email_change, ''),
       email_change_token_new      = coalesce(email_change_token_new, ''),
       email_change_token_current  = coalesce(email_change_token_current, ''),
       phone_change                = coalesce(phone_change, ''),
       phone_change_token          = coalesce(phone_change_token, ''),
       reauthentication_token      = coalesce(reauthentication_token, ''),
       email_confirmed_at          = coalesce(email_confirmed_at, now())
 where email like '%@minicasino.local';


-- -------------------------------------------------------------
-- 관리자 단말 대기 알림 — 관계 신청·진정 두 큐를 한 번에 센다.
-- 헤더의 초록 점은 건수가 아니라 유무만 보므로 합계 하나면 충분하다.
-- loan_requests 는 세지 않는다 — 대출 기능 자체가 없어져(위 "15. (삭제됨)
-- 상점의 회원권 판매와 대출 기능" 참고) admin_list_loans 를 부르는 화면이
-- 없다. 예전에 쌓인 pending 행이 있으면 관리자가 확인할 방법도 없이
-- 점만 계속 켜지므로 애초에 안 센다.
-- -------------------------------------------------------------
create or replace function public.panel_pending()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
begin
  perform app.require_admin();

  return jsonb_build_object(
    'relations', (select count(*) from public.relations where status = 'pending'),
    'petitions', (select count(*) from public.petitions where status = 'open'));
end;
$$;

revoke all on function public.panel_pending() from public;
grant execute on function public.panel_pending() to authenticated;
