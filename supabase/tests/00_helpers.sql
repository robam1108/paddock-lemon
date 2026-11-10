-- 테스트 공용 도우미. 파일 이름 순서상 맨 먼저 돈다.
-- 도우미 정의는 tests 스키마에 남는다(각 테스트 파일은 begin … rollback 이라 데이터는 남기지 않는다).
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- 시드 계정(demo01 등)으로 로그인한 것처럼 만든다. 트랜잭션 안에서만 쓴다.
create or replace function tests.login(p_name text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from public.profiles where username = p_name),
                      'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- anon 키로 붙은 것처럼 만든다.
create or replace function tests.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- postgres 로 돌아온다.
create or replace function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

begin;
select plan(1);
select ok(exists (select 1 from public.profiles where username = 'demo01'), '시드 계정 demo01 이 있다');
select * from finish();
rollback;
