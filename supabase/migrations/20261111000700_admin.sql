-- admin — 관리자 패널 RPC · 대출
--
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다(같은 함수가 두 곳에 보이면 버그다).

set check_function_bodies = false;

-- ════════ 테이블 ════════

CREATE TABLE public.loan_requests (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    username text NOT NULL,
    amount integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT loan_requests_amount_check CHECK ((amount > 0)),
    CONSTRAINT loan_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

ALTER TABLE public.loan_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.loan_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.loan_requests
    ADD CONSTRAINT loan_requests_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX loan_requests_one_pending ON public.loan_requests USING btree (user_id) WHERE (status = 'pending'::text);

CREATE INDEX loan_requests_user_idx ON public.loan_requests USING btree (user_id, created_at DESC);

ALTER TABLE ONLY public.loan_requests
    ADD CONSTRAINT loan_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.loan_requests ENABLE ROW LEVEL SECURITY;

-- ════════ 함수 ════════

CREATE FUNCTION app.admin_reason(p_category text, p_note text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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

CREATE FUNCTION app.max_loan_amount() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 500 $$;

CREATE FUNCTION public.admin_approve_loan(p_id bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- 계정 발급. SQL Editor(service_role)나 panel_add_player 가 부른다.
-- 아이디는 영문 소문자·숫자 3~20자. 비밀번호 평문은 저장하지 않는다.
CREATE FUNCTION public.admin_create_player(p_username text, p_password text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions', 'app'
    AS $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_email    text;
  v_id       uuid := gen_random_uuid();
begin
  if not app.username_valid(v_username) then raise exception 'INVALID_NAME'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'INVALID_PASSWORD'; end if;

  v_email := public.username_to_email(v_username);
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'NAME_TAKEN';
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
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_username),
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

  return v_username;
end;
$$;

CREATE FUNCTION public.admin_delete_player(p_name text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
declare
  v_n integer;
begin
  delete from auth.users where email = public.username_to_email(p_name);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NO_SUCH_PLAYER'; end if;
  return format('삭제 완료 — %s', lower(btrim(p_name)));
end;
$$;

CREATE FUNCTION public.admin_discharge(p_name text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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
  return format('%s 휴식 해제 완료', btrim(p_name));
end;
$$;

CREATE FUNCTION public.admin_give_coins(p_name text, p_amount integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

CREATE FUNCTION public.admin_give_item(p_name text, p_code text, p_qty integer DEFAULT 1) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

CREATE FUNCTION public.admin_list_loans(p_status text DEFAULT 'pending'::text) RETURNS TABLE("번호" bigint, "이름" text, "금액" integer, "상태" text, "신청일" timestamp with time zone, "처리일" timestamp with time zone, "메모" text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select l.id, l.username, l.amount, l.status, l.created_at, l.decided_at, l.note
    from public.loan_requests l
   where p_status is null or l.status = p_status
   order by l.created_at;
$$;

CREATE FUNCTION public.admin_list_players() RETURNS TABLE("이름" text, "코인" integer, "에너지" integer, "상태" text, "빚" integer, "남은횟수" integer, "발급일" timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

-- 비밀번호를 새로 만들어 바꾸고, 새 비밀번호를 한 번만 돌려준다(SQL Editor 전용).
CREATE FUNCTION public.admin_reset_password(p_name text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions', 'app'
    AS $$
declare
  v_pw text := app.gen_password();
begin
  perform public.admin_set_password(p_name, v_pw);
  return v_pw;
end;
$$;

CREATE FUNCTION public.admin_reject_loan(p_id bigint, p_note text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- 비밀번호를 지정한 값으로 바꾼다(SQL Editor 전용). 평문은 저장하지 않는다.
CREATE FUNCTION public.admin_set_password(p_name text, p_password text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
declare
  v_n integer;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'INVALID_PASSWORD'; end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where email = public.username_to_email(p_name);

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NO_SUCH_PLAYER'; end if;

  return format('비밀번호 변경 완료 — %s', lower(btrim(p_name)));
end;
$$;

CREATE FUNCTION public.admin_reset_today(p_name text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.admin_set_coins(p_name text, p_coins integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

CREATE FUNCTION public.admin_set_debt(p_name text, p_debt integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

CREATE FUNCTION public.admin_set_hp(p_name text, p_hp integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_n integer;
begin
  if p_hp < 0 or p_hp > app.hp_max() then
    raise exception '에너지는 0 ~ % 사이여야 합니다.', app.hp_max();
  end if;

  update public.profiles
     set hp = p_hp,
         hp_at = now(),
         meals_at = now(),
         ward_until = case when p_hp > 0 then null else ward_until end
   where username = btrim(p_name);

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception '그런 이름의 플레이어가 없습니다: %', btrim(p_name); end if;
  return format('%s -> 에너지 %s (%s)', btrim(p_name), p_hp, app.hp_status(p_hp));
end;
$$;

-- 관리자 화면의 플레이어 추가. 초기 비밀번호는 응답으로 한 번만 보여 준다.
CREATE FUNCTION public.panel_add_player(p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_name text := lower(btrim(coalesce(p_name, '')));
  v_pw   text;
begin
  perform app.require_admin();
  if not app.username_valid(v_name) then raise exception 'INVALID_NAME'; end if;
  if exists (select 1 from public.profiles where username = v_name) then
    raise exception 'NAME_TAKEN';
  end if;

  v_pw := app.gen_password();
  perform public.admin_create_player(v_name, v_pw);

  return jsonb_build_object('name', v_name, 'password', v_pw);
end;
$$;

CREATE FUNCTION public.panel_confiscate_ledger_trade(p_ledger_id bigint, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  l        public.ledger;
  v_reason jsonb;
  v_got    jsonb;
  v_coins  integer;
  v_name   text;
begin
  perform app.require_admin();
  v_reason := app.admin_reason(p_category, p_note);

  select * into l from public.ledger where id = p_ledger_id for update;
  if not found or l.kind <> 'trade' then raise exception 'NO_TRADE'; end if;
  if l.detail ? 'confiscated' then raise exception 'ALREADY_CONFISCATED'; end if;
  if app.ledger_trade_id(l.user_id, l.created_at, l.detail) is not null then
    raise exception 'TRADE_LINKED';
  end if;

  select username into v_name from public.profiles where id = l.user_id for update;
  if v_name is null then raise exception 'NO_SUCH_PLAYER'; end if;

  -- got_items 는 describe_items 형식(code · qty 포함)이라 그대로 넘긴다.
  v_got := app.confiscate_trade_side(l.user_id,
             coalesce((l.detail->>'got_coins')::int, 0),
             coalesce(l.detail->'got_items', '[]'::jsonb));

  update public.ledger
     set detail = detail || jsonb_build_object('confiscated', v_got || jsonb_build_object('at', now()))
   where id = l.id;

  select coins into v_coins from public.profiles where id = l.user_id;
  perform app.log(l.user_id, 'admin',
    format('%s 와의 거래 회수', l.detail->>'partner'),
    -(v_got->>'coins')::int, v_coins,
    v_reason || jsonb_build_object('ledger_id', l.id,
                                   'coins', (v_got->>'coins')::int,
                                   'items', app.describe_items(v_got->'items')));

  return jsonb_build_object(
    'name',    v_name,
    'partner', l.detail->>'partner',
    'coins',   (v_got->>'coins')::int,
    'items',   app.describe_items(v_got->'items'));
end;
$$;

-- 관리자 화면의 플레이어 삭제. 실수를 막으려고 아이디를 한 번 더 입력받는다.
CREATE FUNCTION public.panel_delete_player(p_name text, p_confirm text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_name text := lower(btrim(coalesce(p_name, '')));
  v_id   uuid;
begin
  perform app.require_admin();

  if v_name = '' or v_name <> lower(btrim(coalesce(p_confirm, ''))) then
    raise exception 'NAME_CONFIRM_MISMATCH';
  end if;

  select id into v_id from public.profiles where username = v_name;
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;
  if v_id = auth.uid() then raise exception 'CANNOT_DELETE_SELF'; end if;

  perform public.admin_delete_player(v_name);

  return jsonb_build_object('name', v_name);
end;
$$;

CREATE FUNCTION public.panel_give_item(p_name text, p_code text, p_qty integer DEFAULT 1, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.panel_give_plays(p_name text, p_amount integer, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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
    format('플레이 횟수 %s회 %s', abs(p_amount),
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

CREATE FUNCTION public.panel_grant_coins(p_name text, p_amount integer, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.panel_items() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.panel_pending() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  perform app.require_admin();

  return jsonb_build_object(
    'relations', (select count(*) from public.relations where status = 'pending'),
    'petitions', (select count(*) from public.petitions where status = 'open'));
end;
$$;

CREATE FUNCTION public.panel_petition_close(p_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  perform app.require_admin();

  update public.petitions
     set status = 'closed', updated_at = now()
   where id = p_id;
  if not found then raise exception 'NO_PETITION'; end if;

  return public.panel_petitions();
end;
$$;

CREATE FUNCTION public.panel_petition_delete(p_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_status text;
  v_paths  jsonb;
begin
  perform app.require_admin();

  select status into v_status from public.petitions where id = p_id;
  if v_status is null then raise exception 'NO_PETITION'; end if;
  if v_status <> 'closed' then raise exception 'PETITION_NOT_CLOSED'; end if;

  select coalesce(jsonb_agg(image_path), '[]'::jsonb) into v_paths
    from public.petition_messages
   where petition_id = p_id and image_path is not null;

  delete from public.petitions where id = p_id;

  return jsonb_build_object('petitions', public.panel_petitions(),
                            'image_paths', v_paths);
end;
$$;

CREATE FUNCTION public.panel_petitions() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_out jsonb;
begin
  perform app.require_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'username', username, 'subject', subject,
           'status', status, 'created_at', created_at,
           'last_message_at', last_message_at
         ) order by case when status = 'open' then 0
                          when status = 'answered' then 1
                          else 2 end, last_message_at desc), '[]'::jsonb)
    into v_out
    from public.petitions;

  return v_out;
end;
$$;

CREATE FUNCTION public.panel_player(p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.panel_players() RETURNS TABLE(username text, coins integer, hp integer, hp_status text, in_ward boolean, plays_used integer, bonus_plays integer, plays_left integer, items jsonb, is_admin boolean, created_at timestamp with time zone, suspended_until timestamp with time zone, suspend_reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  perform app.require_admin();
  return query
    select p.username, p.coins,
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
     order by p.created_at;
end;
$$;

CREATE FUNCTION public.panel_relation_decide(p_id bigint, p_approve boolean, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  r        public.relations;
begin
  perform app.require_admin();

  if not p_approve then
    if v_reason = ''       then raise exception 'NO_REASON'; end if;
    if length(v_reason) > 300 then raise exception 'REASON_TOO_LONG'; end if;
  end if;

  update public.relations
     set status        = case when p_approve then 'approved' else 'rejected' end,
         decided_at     = now(),
         reject_reason  = case when p_approve then null else v_reason end
   where id = p_id
  returning * into r;

  if not found then raise exception 'NO_RELATION'; end if;

  if p_approve and r.kind = 'user' then
    delete from public.relations
     where kind = 'user' and status = 'approved' and id <> r.id
       and ((username = r.username and partner = r.partner)
         or (username = r.partner and partner = r.username));
  end if;

  return public.panel_relations();
end;
$$;

CREATE FUNCTION public.panel_relation_delete(p_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  perform app.require_admin();

  delete from public.relations where id = p_id;
  if not found then raise exception 'NO_RELATION'; end if;

  return public.panel_relations();
end;
$$;

CREATE FUNCTION public.panel_relations() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_out jsonb;
begin
  perform app.require_admin();

  -- 빈 표에서도 jsonb_agg 는 NULL 한 행을 돌려줄 뿐 실패하지 않는다.
  -- coalesce 로 그 NULL 을 '[]' 로 바꿔서 클라이언트가 항상 배열을 받게 한다.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'username', username, 'partner', partner, 'body', body,
           'status', status, 'created_at', created_at,
           'reject_reason', reject_reason
         ) order by case when status = 'pending' then 0 else 1 end, created_at desc), '[]'::jsonb)
    into v_out
    from public.relations;

  return v_out;
end;
$$;

CREATE FUNCTION public.panel_reset_plays(p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

CREATE FUNCTION public.panel_revert_trade(p_id bigint, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  t        public.trades;
  v_reason jsonb;
  v_from   jsonb;   -- 제안자에게서 거둔 것(제안자가 받았던 to_*)
  v_to     jsonb;   -- 상대에게서 거둔 것(상대가 받았던 from_*)
  v_coins  integer;
begin
  perform app.require_admin();
  v_reason := app.admin_reason(p_category, p_note);

  select * into t from public.trades where id = p_id for update;
  if not found then raise exception 'NO_TRADE'; end if;
  if t.status <> 'done' then raise exception 'TRADE_NOT_DONE'; end if;

  -- 두 사람의 잔액을 항상 같은 순서로 잠근다(exec_trade 와 같다)
  perform 1 from public.profiles
   where id in (t.from_id, t.to_id) order by id for update;

  -- 삭제된 사람(id 가 null)은 거둘 것도, 기록을 남길 곳도 없어 건너뛴다.
  v_from := case when t.from_id is null then '{"coins":0,"items":[]}'::jsonb
                 else app.confiscate_trade_side(t.from_id, t.to_coins, t.to_items) end;
  v_to   := case when t.to_id is null then '{"coins":0,"items":[]}'::jsonb
                 else app.confiscate_trade_side(t.to_id, t.from_coins, t.from_items) end;

  -- 성립 기록 두 줄에 거래 번호를 박아 둔다. 아래에서 updated_at 이 바뀌면
  -- app.ledger_trade_id 의 시각 대조로는 더 이상 이 거래를 찾지 못한다.
  update public.ledger
     set detail = detail || jsonb_build_object('trade_id', t.id)
   where kind = 'trade'
     and user_id in (t.from_id, t.to_id)
     and created_at = t.updated_at;

  update public.trades
     set status = 'reverted', reverted_at = now(), updated_at = now(),
         reverted_detail = jsonb_build_object('from_side', v_from, 'to_side', v_to)
   where id = t.id;

  if t.from_id is not null then
    select coins into v_coins from public.profiles where id = t.from_id;
    perform app.log(t.from_id, 'admin',
      format('%s 와의 거래 취소 — 회수', t.to_name),
      -(v_from->>'coins')::int, v_coins,
      v_reason || jsonb_build_object('trade_id', t.id,
                                     'coins', (v_from->>'coins')::int,
                                     'items', app.describe_items(v_from->'items')));
  end if;

  if t.to_id is not null then
    select coins into v_coins from public.profiles where id = t.to_id;
    perform app.log(t.to_id, 'admin',
      format('%s 와의 거래 취소 — 회수', t.from_name),
      -(v_to->>'coins')::int, v_coins,
      v_reason || jsonb_build_object('trade_id', t.id,
                                     'coins', (v_to->>'coins')::int,
                                     'items', app.describe_items(v_to->'items')));
  end if;

  return jsonb_build_object(
    'id',   t.id,
    'from', jsonb_build_object('name', t.from_name, 'deleted', t.from_id is null,
                               'coins', (v_from->>'coins')::int,
                               'items', app.describe_items(v_from->'items')),
    'to',   jsonb_build_object('name', t.to_name, 'deleted', t.to_id is null,
                               'coins', (v_to->>'coins')::int,
                               'items', app.describe_items(v_to->'items'))
  );
end;
$$;

CREATE FUNCTION public.panel_suspend(p_name text, p_days integer, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

  -- 정지 전까지의 에너지·식사를 먼저 정산한다. 정지 중에는 둘 다 멈춘다(app.accrue).
  perform app.accrue(v_id);

  update public.profiles
     set suspended_until = v_until, suspend_reason = v_reason
   where id = v_id
  returning coins into v_coins;

  perform app.log(
    v_id, 'admin', format('이용 정지 %s일', p_days), 0, v_coins,
    jsonb_build_object('days', p_days, 'reason', v_reason, 'until', v_until)
  );

  return jsonb_build_object(
    'name', btrim(p_name),
    'suspended_until', v_until,
    'suspend_reason', v_reason
  );
end;
$$;

CREATE FUNCTION public.panel_take_item(p_name text, p_code text, p_qty integer, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
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

  -- 선물 받은 몫도 남는 수량까지 함께 자른다(inventories_gifted_check).
  -- app.confiscate_trade_side 와 같은 규칙.
  v_left := v_had - p_qty;
  update public.inventories
     set qty        = v_left,
         gifted_qty = greatest(0, least(gifted_qty, v_left))
   where user_id = v_id and item_code = p_code;

  -- 겹쳐 장착한 수가 남는 수량보다 많으면 남는 만큼으로 줄인다.
  update public.player_flex set stack = v_left
   where user_id = v_id and item_code = p_code and expires_at is null
     and v_left > 0 and stack > v_left;

  if v_left <= 0 then
    -- 장착분(잠금)까지 거둬 남는 게 없으면 장착을 푼다(flex_unequip 과 같은 규칙).
    delete from public.player_flex
     where user_id = v_id and item_code = p_code and expires_at is null;

    -- 개봉한 물건의 남은 횟수(open_left)가 있으면, 봉인된 것을 전부 회수해도
    -- 남은 횟수는 살아 있어야 하므로 행을 지우지 않는다.
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

CREATE FUNCTION public.panel_trade_ledger(p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_id uuid;
begin
  perform app.require_admin();

  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',          x.id,
             'created_at',  x.created_at,
             'title',       x.title,
             'coin_delta',  x.coin_delta,
             'partner',     x.detail->>'partner',
             'partner_deleted', not exists (select 1 from public.profiles p
                                             where p.username = x.detail->>'partner'),
             'gave_coins',  coalesce((x.detail->>'gave_coins')::int, 0),
             'gave_items',  coalesce(x.detail->'gave_items', '[]'::jsonb),
             'got_coins',   coalesce((x.detail->>'got_coins')::int, 0),
             'got_items',   coalesce(x.detail->'got_items', '[]'::jsonb),
             'confiscated', case when x.detail ? 'confiscated' then
                              jsonb_build_object(
                                'coins', (x.detail->'confiscated'->>'coins')::int,
                                'items', app.describe_items(x.detail->'confiscated'->'items'),
                                'at',    x.detail->'confiscated'->'at')
                            end,
             -- 연결이 끊긴 옛 기록인데 같은 상대와의 관리자 거래 취소가 뒤에 있으면
             -- 이미 처리된 거래일 수 있다 — 화면에서 경고만 한다.
             'maybe_reverted', x.tid is null and exists (
                                 select 1 from public.ledger a
                                  where a.user_id = v_id and a.kind = 'admin'
                                    and a.title = format('%s 와의 거래 취소 — 회수', x.detail->>'partner')
                                    and a.created_at > x.created_at),
             'trade', case when t.id is not null then jsonb_build_object(
                        'id', t.id, 'status', t.status,
                        'from', t.from_name, 'to', t.to_name,
                        'from_deleted', t.from_id is null,
                        'to_deleted',   t.to_id is null)
                      end
           ) order by x.created_at desc)
      from (select l.*, app.ledger_trade_id(l.user_id, l.created_at, l.detail) as tid
              from public.ledger l
             where l.user_id = v_id and l.kind = 'trade') x
      left join public.trades t on t.id = x.tid), '[]'::jsonb);
end;
$$;

CREATE FUNCTION public.panel_trades(p_limit integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
begin
  perform app.require_admin();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',         t.id,
             'from',       t.from_name,
             'to',         t.to_name,
             'from_deleted', t.from_id is null,
             'to_deleted',   t.to_id is null,
             'is_gift',    t.is_gift,
             'status',     t.status,
             'from_coins', t.from_coins,
             'from_items', app.describe_items(t.from_items),
             'to_coins',   t.to_coins,
             'to_items',   app.describe_items(t.to_items),
             'created_at', t.created_at,
             'updated_at', t.updated_at,
             'reverted_at', t.reverted_at,
             'reverted_detail', case when t.reverted_detail is not null then
               jsonb_build_object(
                 'from_coins', coalesce((t.reverted_detail->'from_side'->>'coins')::int, 0),
                 'from_items', app.describe_items(coalesce(t.reverted_detail->'from_side'->'items', '[]'::jsonb)),
                 'to_coins',   coalesce((t.reverted_detail->'to_side'->>'coins')::int, 0),
                 'to_items',   app.describe_items(coalesce(t.reverted_detail->'to_side'->'items', '[]'::jsonb)))
             end
           ) order by t.created_at desc)
      from (select * from public.trades
             order by created_at desc
             limit case when p_limit is null then null
                        else greatest(p_limit, 1) end) t), '[]'::jsonb);
end;
$$;

CREATE FUNCTION public.panel_unsuspend(p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_id    uuid;
  v_coins integer;
begin
  perform app.require_admin();

  select id into v_id from public.profiles where username = btrim(p_name);
  if v_id is null then raise exception 'NO_SUCH_PLAYER'; end if;

  -- 정지 칸을 지우기 전에 정산해 에너지·식사 시계를 지금으로 당겨 둔다 —
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

-- ════════ 정책 ════════

CREATE POLICY "own loan requests are readable" ON public.loan_requests FOR SELECT TO authenticated USING ((user_id = auth.uid()));

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.admin_reason(p_category text, p_note text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.admin_approve_loan(p_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_approve_loan(p_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.admin_create_player(p_username text, p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_create_player(p_username text, p_password text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_delete_player(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_player(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_discharge(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_discharge(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_give_coins(p_name text, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_give_coins(p_name text, p_amount integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_give_item(p_name text, p_code text, p_qty integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_give_item(p_name text, p_code text, p_qty integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_list_loans(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_loans(p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_list_players() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_players() TO service_role;

REVOKE ALL ON FUNCTION public.admin_reset_password(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reset_password(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_reject_loan(p_id bigint, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reject_loan(p_id bigint, p_note text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_set_password(p_name text, p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_password(p_name text, p_password text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_reset_today(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reset_today(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_set_coins(p_name text, p_coins integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_coins(p_name text, p_coins integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_set_debt(p_name text, p_debt integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_debt(p_name text, p_debt integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_set_hp(p_name text, p_hp integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_hp(p_name text, p_hp integer) TO service_role;

REVOKE ALL ON FUNCTION public.panel_add_player(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_add_player(p_name text) TO anon;
GRANT ALL ON FUNCTION public.panel_add_player(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_add_player(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_confiscate_ledger_trade(p_ledger_id bigint, p_category text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_confiscate_ledger_trade(p_ledger_id bigint, p_category text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.panel_confiscate_ledger_trade(p_ledger_id bigint, p_category text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_confiscate_ledger_trade(p_ledger_id bigint, p_category text, p_note text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_delete_player(p_name text, p_confirm text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_delete_player(p_name text, p_confirm text) TO anon;
GRANT ALL ON FUNCTION public.panel_delete_player(p_name text, p_confirm text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_delete_player(p_name text, p_confirm text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_give_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_give_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.panel_give_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_give_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_give_plays(p_name text, p_amount integer, p_category text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_give_plays(p_name text, p_amount integer, p_category text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.panel_give_plays(p_name text, p_amount integer, p_category text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_give_plays(p_name text, p_amount integer, p_category text, p_note text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_grant_coins(p_name text, p_amount integer, p_category text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_grant_coins(p_name text, p_amount integer, p_category text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.panel_grant_coins(p_name text, p_amount integer, p_category text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_grant_coins(p_name text, p_amount integer, p_category text, p_note text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_items() FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_items() TO anon;
GRANT ALL ON FUNCTION public.panel_items() TO authenticated;
GRANT ALL ON FUNCTION public.panel_items() TO service_role;

REVOKE ALL ON FUNCTION public.panel_pending() FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_pending() TO anon;
GRANT ALL ON FUNCTION public.panel_pending() TO authenticated;
GRANT ALL ON FUNCTION public.panel_pending() TO service_role;

REVOKE ALL ON FUNCTION public.panel_petition_close(p_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_petition_close(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.panel_petition_close(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.panel_petition_close(p_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.panel_petition_delete(p_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_petition_delete(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.panel_petition_delete(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.panel_petition_delete(p_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.panel_petitions() FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_petitions() TO anon;
GRANT ALL ON FUNCTION public.panel_petitions() TO authenticated;
GRANT ALL ON FUNCTION public.panel_petitions() TO service_role;

REVOKE ALL ON FUNCTION public.panel_player(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_player(p_name text) TO anon;
GRANT ALL ON FUNCTION public.panel_player(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_player(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_players() FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_players() TO anon;
GRANT ALL ON FUNCTION public.panel_players() TO authenticated;
GRANT ALL ON FUNCTION public.panel_players() TO service_role;

REVOKE ALL ON FUNCTION public.panel_relation_decide(p_id bigint, p_approve boolean, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_relation_decide(p_id bigint, p_approve boolean, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.panel_relation_decide(p_id bigint, p_approve boolean, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_relation_decide(p_id bigint, p_approve boolean, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_relation_delete(p_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_relation_delete(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.panel_relation_delete(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.panel_relation_delete(p_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.panel_relations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_relations() TO anon;
GRANT ALL ON FUNCTION public.panel_relations() TO authenticated;
GRANT ALL ON FUNCTION public.panel_relations() TO service_role;

REVOKE ALL ON FUNCTION public.panel_reset_plays(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_reset_plays(p_name text) TO anon;
GRANT ALL ON FUNCTION public.panel_reset_plays(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_reset_plays(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_revert_trade(p_id bigint, p_category text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_revert_trade(p_id bigint, p_category text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.panel_revert_trade(p_id bigint, p_category text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_revert_trade(p_id bigint, p_category text, p_note text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_suspend(p_name text, p_days integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_suspend(p_name text, p_days integer, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.panel_suspend(p_name text, p_days integer, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_suspend(p_name text, p_days integer, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_take_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_take_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.panel_take_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_take_item(p_name text, p_code text, p_qty integer, p_category text, p_note text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_trade_ledger(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_trade_ledger(p_name text) TO anon;
GRANT ALL ON FUNCTION public.panel_trade_ledger(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_trade_ledger(p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.panel_trades(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_trades(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.panel_trades(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.panel_trades(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.panel_unsuspend(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.panel_unsuspend(p_name text) TO anon;
GRANT ALL ON FUNCTION public.panel_unsuspend(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.panel_unsuspend(p_name text) TO service_role;

GRANT ALL ON TABLE public.loan_requests TO anon;
GRANT ALL ON TABLE public.loan_requests TO authenticated;
GRANT ALL ON TABLE public.loan_requests TO service_role;

GRANT ALL ON SEQUENCE public.loan_requests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.loan_requests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.loan_requests_id_seq TO service_role;
