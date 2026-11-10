-- 하우스 엣지 — 서버 규칙 함수(app.roulette_* · app.slot_* · app.keno_*)로 정확히 계산한다.
-- 배당은 판돈에 곱한 뒤 내림하므로 실제 환수율은 판돈이 작을수록 조금 더 낮다. 여기서는 배율 기준이다.
begin;
select plan(6);

select is(round(1 - 7.0 / app.roulette_slots() * app.roulette_color_mult(), 4), 0.0200,
          '룰렛 색 베팅 하우스 엣지 2.00%');
select is(round(1 - 1.0 / app.roulette_slots() * app.roulette_number_mult(), 4), 0.0200,
          '룰렛 숫자 베팅 하우스 엣지 2.00%');

-- 슬롯: 릴 세 개를 전수로 센다(21³ = 9,261 조합).
select is(round(1 - (
  select avg(case when a = b and b = c then app.slot_triple_mult(a)
                  when a = b or b = c or a = c then app.slot_pair_mult()
                  else 0 end)
    from unnest(app.slot_pool()) a, unnest(app.slot_pool()) b, unnest(app.slot_pool()) c), 4),
  0.0191, '슬롯 하우스 엣지 1.91%');

-- 키노: 1~40 중 5개를 고르고 10개를 뽑는 초기하분포에, 3·4·5개 적중 판을
-- app.keno_*_keep() 확률로만 남기는 재추첨을 반영한다.
create temp table keno on commit drop as
with nat as (
  select k, (factorial(5) / (factorial(k) * factorial(5 - k)))
          * (factorial(35) / (factorial(10 - k) * factorial(25 + k)))
          / (factorial(40) / (factorial(10) * factorial(30))) as p
    from generate_series(0, 5) k)
select k, p * case k when 3 then app.keno_three_keep() when 4 then app.keno_four_keep()
                     when 5 then app.keno_five_keep() else 1 end as w
  from nat;

select is(round((select sum(w * app.keno_mult(k)) / sum(w) from keno), 2), 0.98,
          '키노 RTP ≈ 0.98');
select is(round((select sum(w) / sum(w) filter (where k = 3) from keno), 1), 28.5,
          '키노 3개 적중은 28.5판에 한 번');
select is(round((select sum(w) / sum(w) filter (where k = 5) from keno)), 9261::numeric,
          '키노 5개 적중은 9,261판에 한 번(슬롯 다이아 트리플과 같은 급)');

select * from finish();
rollback;
