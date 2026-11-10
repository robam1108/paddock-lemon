-- 클라이언트를 믿지 않는다 — 직접 수정 차단, 입력 검증, 관리자 함수, 거래 이중 지출.
begin;
select plan(12);

-- ── 코인 · 판 수 · 원장 직접 수정 ─────────────────────────────────────
create temp table t_me on commit drop as
select coins, plays_used from public.profiles where username = 'demo01';

select tests.login('demo01');
update public.profiles set coins = 999999, plays_used = 0 where username = 'demo01';
select tests.logout();
select is((select coins from public.profiles where username = 'demo01'), (select coins from t_me),
          '로그인 사용자가 profiles.coins 를 직접 바꿀 수 없다(RLS)');
select is((select plays_used from public.profiles where username = 'demo01'), (select plays_used from t_me),
          '판 수(plays_used)도 직접 바꿀 수 없다');

select tests.as_anon();
update public.profiles set coins = 999999 where username = 'demo01';
select tests.logout();
select is((select coins from public.profiles where username = 'demo01'), (select coins from t_me),
          'anon 키로도 바꿀 수 없다');

select tests.login('demo01');
select throws_ok($$ insert into public.ledger (user_id, kind, title, coin_delta, coin_after)
                    values (auth.uid(), 'admin', 'x', 1000, 1000) $$,
                 '42501', null, '원장(ledger)에 직접 쓸 수 없다');
select tests.logout();

-- ── 입력 검증 회귀: 하이로우 null 선택(운영 중 실제로 뚫렸던 경로) ───
update public.profiles
   set coins = 100, hp = 100, plays_used = 0, ward_until = null, hl_bet = 0
 where username = 'demo01';
select tests.login('demo01');
select public.highlow_begin(1);
select throws_ok($$ select public.highlow_continue(null) $$, 'P0001', 'INVALID_CHOICE',
                 'highlow_continue(null) 은 INVALID_CHOICE');
select throws_ok($$ select public.play_game('keno', 1, '1,1,1,1,1') $$, 'P0001', 'INVALID_CHOICE',
                 '키노에 같은 수를 다섯 번 적을 수 없다');
select throws_ok($$ select public.play_game('roulette', 0, 'red') $$, 'P0001', 'INVALID_BET',
                 '판돈 0 은 받지 않는다');

-- ── 관리자 함수 ──────────────────────────────────────────────────────
select throws_ok($$ select public.panel_grant_coins('demo01', 1000) $$, 'P0001', 'NOT_ADMIN',
                 '일반 사용자는 panel_* 를 부를 수 없다');
select tests.as_anon();
select throws_ok($$ select public.panel_players() $$, 'P0001', 'AUTH_REQUIRED',
                 'anon 키로는 panel_* 가 로그인부터 요구한다');
select tests.logout();

-- ── 거래 이중 지출 ───────────────────────────────────────────────────
-- 제안 단계에서는 코인을 묶지 않는다. 같은 50코인으로 선물 두 건을 걸 수는 있지만,
-- 성사 순간 두 사람의 행을 잠그고 잔액을 다시 확인하므로 두 번째는 실패한다.
update public.profiles set coins = 50 where username = 'demo01';
update public.trades set status = 'cancelled' where status in ('offered', 'countered');
select tests.login('demo01');
select public.trade_offer('demo02', 50, '[]'::jsonb, true);
select public.trade_offer('demo03', 50, '[]'::jsonb, true);
select tests.logout();

create temp table t_trades on commit drop as
select id, to_name from public.trades
 where from_name = 'demo01' and status = 'offered' and to_name in ('demo02', 'demo03');
grant select on t_trades to authenticated;

select tests.login('demo02');
select public.trade_respond((select id from t_trades where to_name = 'demo02'), 'accept');
select tests.logout();
select throws_ok(
  format($f$ select tests.login('demo02'); select public.trade_respond(%s, 'accept') $f$,
         (select id from t_trades where to_name = 'demo02')),
  'P0001', 'TRADE_CLOSED', '같은 선물을 두 번 받을 수 없다');
select tests.logout();

select throws_ok(
  format($f$ select tests.login('demo03'); select public.trade_respond(%s, 'accept') $f$,
         (select id from t_trades where to_name = 'demo03')),
  'P0001', 'PARTNER_SHORT_COINS', '이미 넘긴 50코인으로 두 번째 선물은 성사되지 않는다');
select tests.logout();
select is((select coins from public.profiles where username = 'demo01'), 0,
          '보낸 사람 잔액은 0 — 음수가 되지 않았다');

select * from finish();
rollback;
