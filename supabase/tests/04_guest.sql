-- 게스트 체험 — 서버가 아이디를 정하고, 파일 업로드는 막히고, 기한이 지나면 지워진다.
begin;
select plan(10);

-- 익명 로그인이 만드는 것과 같은 auth.users 행. 클라이언트가 이름을 'admin' 으로 보냈다고 치자.
create temp table t_guest on commit drop as select gen_random_uuid() as id;
grant select on t_guest to authenticated;
insert into auth.users (id, aud, role, is_anonymous, raw_user_meta_data, created_at, updated_at)
select id, 'authenticated', 'authenticated', true, '{"username": "admin"}', now(), now() from t_guest;

select matches((select username from public.profiles where id = (select id from t_guest)), '^guest[0-9]{6}$',
               '게스트 아이디는 서버가 guest + 숫자 6자리로 정한다(클라이언트가 보낸 이름은 무시)');
select ok(not (select hidden from public.profiles where id = (select id from t_guest)),
          '운영자 숨김 이름(admin)을 보내도 숨김 계정이 되지 않는다');
select is((select coins from public.profiles where id = (select id from t_guest)), app.initial_coins(),
          '게스트도 일반 계정과 같은 시작 코인');
select ok(app.is_guest((select id from t_guest)) and not app.is_guest((select id from public.profiles where username = 'demo01')),
          'app.is_guest 는 익명 계정만 참');

-- ── 게스트 화면 정보 ────────────────────────────────────────────────
select tests.login('demo01');
select is((public.guest_status() ->> 'is_guest')::boolean, false, '일반 계정은 게스트가 아니다');
select tests.logout();
select set_config('request.jwt.claims', json_build_object('sub', (select id from t_guest), 'role', 'authenticated')::text, true);
select set_config('role', 'authenticated', true);
select is((public.guest_status() ->> 'is_guest')::boolean, true, '게스트에게는 지워지는 시각을 알려 준다');

-- ── 파일 업로드 차단 ────────────────────────────────────────────────
select throws_ok(
  format($f$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', '%s/avatar.jpg', '%s') $f$,
         (select id from t_guest), (select id from t_guest)),
  '42501', null, '게스트는 프로필 사진을 올릴 수 없다');
select tests.logout();

select tests.login('demo01');
select lives_ok(
  format($f$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', '%s/avatar.jpg', '%s') $f$,
         auth.uid(), auth.uid()),
  '일반 계정은 그대로 올릴 수 있다');
select tests.logout();

-- ── 기한이 지나면 계정째 지운다 ─────────────────────────────────────
update auth.users set created_at = now() - app.guest_ttl() - interval '1 minute'
 where id = (select id from t_guest);
select app.guest_cleanup();
select ok(not exists (select 1 from public.profiles where id = (select id from t_guest)),
          '기한이 지난 게스트는 프로필까지 지워진다');
select ok(exists (select 1 from public.profiles where username = 'demo01'),
          '일반 계정은 지워지지 않는다');

select * from finish();
rollback;
