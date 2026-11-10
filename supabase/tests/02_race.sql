-- 경마 — 배당 기대값, 마감 전 결과 비노출, 정산 한 번.
begin;
select plan(12);

-- ── 배당 기대값 ≈ 1 − 공제율 ───────────────────────────────────────────
-- 공개 정보(능력치 + 무작위 컨디션)로 만든 몬테카를로 배당표에, 같은 모델로 4,000경주를
-- 따로 돌려 단승 · 연승 · 복승 한 장의 평균 환수를 잰다. 시드를 고정해 결과가 매번 같다.
select setseed(0.42);
create temp table ev (win numeric, place numeric, quin numeric) on commit drop;

do $$
declare
  ent  smallint[] := array[1, 2, 3, 4, 5, 6, 7, 8];
  st   double precision[] := app.race_stats(ent);
  o    jsonb := app.race_odds(st, 1400, 1::smallint, app.race_mc_runs());
  runs integer := 4000;
  n    integer := 8;
  c smallint[]; rk smallint[]; r integer; i integer; a integer; b integer;
  w numeric := 0; p numeric := 0; q numeric := 0;
begin
  for r in 1..runs loop
    c := '{}';
    for i in 1..n loop c := c || app.race_roll_cond(); end loop;
    rk := app.race_ranks(app.race_run(st, 1400, 1::smallint, c), n);
    for i in 1..n loop
      if rk[i] = 1 then w := w + (o -> 'win' ->> (i - 1))::numeric; a := i; end if;
      if rk[i] = 2 then b := i; end if;
      if rk[i] <= 3 then p := p + (o -> 'place' ->> (i - 1))::numeric; end if;
    end loop;
    q := q + (o -> 'quin' ->> (least(a, b) || '-' || greatest(a, b)))::numeric;
  end loop;
  insert into ev values (w / (runs * n), p / (runs * n), q / (runs * n * (n - 1) / 2));
end $$;

select cmp_ok(abs((select win   from ev) - (1 - app.race_take()))::numeric, '<', 0.03, '단승 기대값 ≈ 1 − 공제율');
select cmp_ok(abs((select place from ev) - (1 - app.race_take()))::numeric, '<', 0.03, '연승 기대값 ≈ 1 − 공제율');
select cmp_ok(abs((select quin  from ev) - (1 - app.race_take()))::numeric, '<', 0.04, '복승 기대값 ≈ 1 − 공제율');

-- ── 마감 전 결과 비노출 ────────────────────────────────────────────────
create temp table t_race on commit drop as
select app.race_create(current_date, 99::smallint, false, now() + interval '1 hour',
                       array[1, 2, 3, 4, 5, 6, 7, 8]::smallint[], 1400, 1::smallint,
                       array[0, 1, 2, 3, 4, 2, 2, 2]::smallint[],
                       array[0, 0, 0, 0, 0, 0, 0, 0]::smallint[], null) as id;
grant select on t_race to authenticated;

select ok((select result is null and ranks is null from public.races where id = (select id from t_race)),
          '마감 전 경주에는 결과 · 순위가 아직 만들어지지 않았다');
select ok((select app.race_json(r, null) -> 'cond' = 'null'::jsonb
             from public.races r where id = (select id from t_race)),
          '마감 전 화면 JSON 에 숨은 컨디션이 없다');

select tests.login('demo01');
select is((select count(*) from public.races)::int, 0, '로그인 사용자도 races 테이블은 직접 읽지 못한다(RPC 로만)');
select is((select count(*) from public.race_days)::int, 0, '하루 컨디션표(race_days)도 직접 읽지 못한다');
select tests.logout();

-- ── 정산은 두 번 불러도 한 번만 지급 ──────────────────────────────────
update public.profiles set coins = 1000, ward_until = null where username = 'demo01';
select tests.login('demo01');
select public.race_bet((select id from t_race), 'win', array[g], 20) from generate_series(1, 8) g;
select tests.logout();

update public.races set post_at = now() - interval '1 second' where id = (select id from t_race);
create temp table t_coins (step text, coins integer) on commit drop;
insert into t_coins select 'before', coins from public.profiles where username = 'demo01';

select app.race_settle((select id from t_race));
insert into t_coins select 'first', coins from public.profiles where username = 'demo01';
select app.race_settle((select id from t_race));
select app.race_settle_due();

select ok((select sum(payout) > 0 and count(*) filter (where payout > 0) = 1
             from public.race_bets where race_id = (select id from t_race)),
          '단승 여덟 장 중 정확히 한 장이 적중했다');
select is((select coins from t_coins where step = 'first') - (select coins from t_coins where step = 'before'),
          (select sum(payout)::int from public.race_bets where race_id = (select id from t_race)),
          '여덟 마리 모두 산 단승 중 적중한 한 장만큼 지급됐다');
select is((select coins from public.profiles where username = 'demo01'),
          (select coins from t_coins where step = 'first'),
          '정산을 다시 불러도 코인이 더 늘지 않는다');
select is((select count(*)::int from public.game_rounds
            where game = 'race' and (outcome ->> 'race_id')::bigint = (select id from t_race)), 1,
          '경주 기록도 한 줄만 남는다');
select ok((select app.race_json(r, null) -> 'cond' <> 'null'::jsonb
             from public.races r where id = (select id from t_race)),
          '정산 뒤에는 컨디션이 공개된다');

select * from finish();
rollback;
