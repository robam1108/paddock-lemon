// 로그인 → 경마 베팅 → 결과 확인.
//
// 정식 경주는 하루 두 번(10:00 · 22:00 KST)이라, 준비 단계에서 SQL 로 몇 분 뒤 발주하는
// 경주를 하나 편성한다(경마 함수 app.race_create 그대로). 베팅 뒤에는 발주 시각을 지금으로
// 당겨 두고, 화면이 race_card 를 다시 읽을 때 서버가 정산(lazy 정산)하는 흐름을 그대로 본다.
import { expect, test } from "@playwright/test";
import { psql } from "../../scripts/lib/psql.mjs";

const USER = process.env.E2E_USER ?? "demo01";
// seed.sql 의 로컬 전용 데모 비밀번호
const PASS = process.env.E2E_PASS ?? "paddock-demo";
const RACE_NO = 90;

let raceId = "";

test.beforeAll(() => {
  psql(`update public.profiles
           set coins = greatest(coins, 500), hp = 100, ward_until = null, suspended_until = null
         where username = '${USER}'`);
  psql(`delete from public.races where day = app.today_kst() and no = ${RACE_NO} and not is_test`);
  raceId = psql(`
    with c as (select array_agg(app.race_roll_cond()) as cond from generate_series(1, 8))
    select app.race_create(app.today_kst(), ${RACE_NO}::smallint, false, now() + interval '10 minutes',
                           app.pick_shuffled(1, 20, 8)::smallint[], 1400, 1::smallint, c.cond,
                           (select array_agg(app.race_wdelta(x)) from unnest(c.cond) x), null)
      from c`);
  expect(raceId).toMatch(/^\d+$/);
});

test.afterAll(() => {
  if (raceId) psql(`delete from public.races where id = ${raceId}`);
});

test("로그인 → 경마 단승 베팅 → 정산 결과", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("예: demo01").fill(USER);
  await page.getByPlaceholder("비밀번호").fill(PASS);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/play/);

  await page.getByRole("button", { name: "Arena", exact: true }).click();
  await page.getByRole("button", { name: "경마장", exact: true }).click();

  // 가장 이른 경주(준비 단계에서 편성한 것)가 기본으로 열린다. 1번 말을 단승으로 산다.
  const firstHorse = page.locator('[role="button"][aria-pressed]').first();
  await firstHorse.click();
  await expect(firstHorse).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "마권 구매" }).click();
  await expect(page.getByText(/단승 1 · \d+코인 베팅했습니다/)).toBeVisible();

  const tickets = psql(`select count(*) from public.race_bets b join public.profiles p on p.id = b.user_id
                         where b.race_id = ${raceId} and p.username = '${USER}'`);
  expect(tickets).toBe("1");

  // 발주 시각을 지금으로 당긴다 → 화면의 다음 race_card 호출에서 정산되고 실황이 돈 뒤 성적표가 뜬다.
  psql(`update public.races set post_at = now() - interval '1 second' where id = ${raceId}`);

  await expect(page.getByText("성적", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/^단승 1 · \d+ × [\d.]+/)).toBeVisible();
  await expect(page.getByText(/^(적중 \+\d+|낙첨)$/)).toBeVisible();

  const settled = psql(`select status from public.races where id = ${raceId}`);
  expect(settled).toBe("done");
});
