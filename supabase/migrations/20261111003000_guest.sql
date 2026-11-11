-- guest — 로그인 없이 체험하는 게스트 계정
--
-- 게스트는 Supabase 익명 로그인(auth.signInAnonymously)으로 들어온다. SQL 함수는 인증 세션을
-- 만들 수 없으므로 "게스트 발급 RPC" 대신, 익명 사용자가 auth.users 에 생기는 순간을 잡는다.
--   1. BEFORE INSERT 트리거가 아이디를 서버에서 정한다(guest + 숫자 6자리). 클라이언트가
--      보낸 메타데이터는 믿지 않는다. 그다음 기존 AFTER 트리거(handle_new_user)가 그 아이디로
--      평소와 같은 프로필을 만든다 — 게스트도 게임 · 경마 규칙은 똑같다.
--   2. 게스트 계정은 app.guest_ttl() 뒤 cron 이 계정째 지운다(관련 행은 FK 로 함께 지워진다).
--      그래서 코인을 주기적으로 되돌리는 작업이 따로 필요 없다.
--   3. 저장소에 파일을 올리는 기능(프로필 사진 · 피드백 사진)은 게스트에게 막는다.
--
-- 켜고 끄는 곳은 두 군데다: 이 파일의 app.guest_open() 과 Auth 설정의 Anonymous sign-ins.
-- 여기 정의된 함수의 몸통은 저장소 전체에서 이 파일에만 있다.

set check_function_bodies = false;

-- ════════ 규칙 ════════

CREATE FUNCTION app.guest_open() RETURNS boolean
    LANGUAGE sql IMMUTABLE AS $$ select true $$;

-- 게스트 계정이 남아 있는 시간
CREATE FUNCTION app.guest_ttl() RETURNS interval
    LANGUAGE sql IMMUTABLE AS $$ select interval '24 hours' $$;

CREATE FUNCTION app.is_guest(p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'auth'
    AS $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = p_uid), false)
$$;

-- ════════ 발급 ════════

CREATE FUNCTION app.guest_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_name text;
  i      integer;
begin
  if not coalesce(new.is_anonymous, false) then return new; end if;
  if not app.guest_open() then raise exception 'GUEST_CLOSED'; end if;

  for i in 1..20 loop
    v_name := 'guest' || lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.profiles where username = v_name);
    v_name := null;
  end loop;
  if v_name is null then raise exception 'GUEST_FULL'; end if;

  -- handle_new_user 는 raw_user_meta_data.username 을 읽는다. 클라이언트 값은 덮어쓴다.
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
                            || jsonb_build_object('username', v_name, 'guest', true);
  return new;
end;
$$;

drop trigger if exists on_auth_guest_before on auth.users;
create trigger on_auth_guest_before
  before insert on auth.users
  for each row execute function app.guest_before_insert();

-- 로그인 화면이 체험 버튼을 띄울지, 게스트 화면에 무엇을 안내할지 알려 준다.
CREATE FUNCTION public.guest_status() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
  select jsonb_build_object(
    'open',      app.guest_open(),
    'ttl_hours', (extract(epoch from app.guest_ttl()) / 3600)::integer,
    'is_guest',  app.is_guest(auth.uid()),
    'expires_at', (select u.created_at + app.guest_ttl()
                     from auth.users u where u.id = auth.uid() and u.is_anonymous)
  )
$$;

-- ════════ 정리 ════════

CREATE FUNCTION app.guest_cleanup() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'app'
    AS $$
declare
  v_n integer;
begin
  delete from auth.users
   where is_anonymous and created_at < now() - app.guest_ttl();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

select cron.schedule('guest-cleanup', '17 * * * *', 'select app.guest_cleanup();');

-- ════════ 파일 업로드 차단 ════════
-- 기존 허용 정책과 AND 로 묶이는 제한 정책이다(기존 정책은 그대로 둔다).

create policy "guests cannot upload files"
  on storage.objects as restrictive for insert to authenticated
  with check (not app.is_guest(auth.uid()));

create policy "guests cannot replace files"
  on storage.objects as restrictive for update to authenticated
  using (not app.is_guest(auth.uid()));

-- ════════ 권한 ════════

REVOKE ALL ON FUNCTION app.guest_before_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.guest_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_guest(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_guest(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.guest_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_status() TO anon, authenticated, service_role;
