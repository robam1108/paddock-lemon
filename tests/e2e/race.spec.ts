// 경마 한 경주를 처음부터 끝까지 — 발급 계정(demo01)과 게스트(로그인 없이 체험) 두 가지로.
//
// 정식 경주는 하루 두 번(10:00 · 22:00 KST)이라, 테스트마다 SQL 로 몇 분 뒤 발주하는 경주를
// 하나 편성한다(경마 함수 app.race_create 그대로). 베팅 뒤에는 발주 시각을 지금으로 당겨 두고,
// 화면이 race_card 를 다시 읽을 때 서버가 정산(lazy 정산)하는 흐름을 그대로 본다.
import { expect, test, type Page } from "@playwright/test";
import { psql } from "../../scripts/lib/psql.mjs";

const USER = process.env.E2E_USER ?? "demo01";
// seed.sql 의 로컬 전용 데모 비밀번호
const PASS = process.env.E2E_PASS ?? "paddock-demo";

const created: string[] = [];

/** 지금부터 몇 분 뒤 발주하는 정식 경주를 편성하고 id 를 돌려준다. */
function scheduleRace(no: number): string {
  psql(`delete from public.races where day = app.today_kst() and no = ${no} and not is_test`);
  const id = psql(`
    with c as (select array_agg(app.race_roll_cond()) as cond from generate_series(1, 8))
    select app.race_create(app.today_kst(), ${no}::smallint, false, now() + interval '10 minutes',
                           app.pick_shuffled(1, 20, 8)::smallint[], 1400, 1::smallint, c.cond,
                           (select array_agg(app.race_wdelta(x)) from unnest(c.cond) x), null)
      from c`);
  expect(id).toMatch(/^\d+$/);
  created.push(id);
  return id;
}

/** 경마장을 열고 1번 말 단승을 최소 금액으로 산 뒤, 발주를 당겨 성적표가 뜰 때까지 본다. */
async function betAndWatch(page: Page, raceId: string) {
  await page.getByRole("button", { name: "Arena", exact: true }).click();
  await page.getByRole("button", { name: "경마장", exact: true }).click();

  // 가장 이른 경주(방금 편성한 것)가 기본으로 열린다.
  const firstHorse = page.locator('[role="button"][aria-pressed]').first();
  await firstHorse.click();
  await expect(firstHorse).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "마권 구매" }).click();
  await expect(page.getByText(/단승 1 · \d+코인 베팅했습니다/)).toBeVisible();

  expect(psql(`select count(*) from public.race_bets where race_id = ${raceId}`)).toBe("1");

  psql(`update public.races set post_at = now() - interval '1 second' where id = ${raceId}`);

  await expect(page.getByText("성적", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/^단승 1 · \d+ × [\d.]+/)).toBeVisible();
  await expect(page.getByText(/^(적중 \+\d+|낙첨)$/)).toBeVisible();
  expect(psql(`select status from public.races where id = ${raceId}`)).toBe("done");
}

test.afterAll(() => {
  for (const id of created) psql(`delete from public.races where id = ${id}`);
});

test("발급 계정: 로그인 → 경마 단승 베팅 → 정산 결과", async ({ page }) => {
  psql(`update public.profiles
           set coins = greatest(coins, 500), hp = 100, ward_until = null, suspended_until = null
         where username = '${USER}'`);
  const raceId = scheduleRace(90);

  await page.goto("/login");
  await page.getByPlaceholder("예: demo01").fill(USER);
  await page.getByPlaceholder("비밀번호").fill(PASS);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/play/);

  await betAndWatch(page, raceId);
});

test("게스트: 로그인 없이 체험 → 경마 1경주를 끝까지", async ({ page }) => {
  const raceId = scheduleRace(91);

  await page.goto("/login");
  await page.getByRole("button", { name: "로그인 없이 체험하기" }).click();
  await expect(page).toHaveURL(/\/play/);
  await expect(page.getByText(/게스트 체험 중입니다/)).toBeVisible();

  // 게스트 아이디는 서버가 정한다. 화면 머리줄에 그 아이디가 보인다.
  await expect(page.getByText(/^guest\d{6}$/).first()).toBeVisible();

  await betAndWatch(page, raceId);

  // 게스트 계정은 테스트가 끝나면 바로 지운다(평소에는 cron 이 기한 뒤에 지운다).
  psql(`delete from auth.users where is_anonymous and id in
          (select user_id from public.race_bets where race_id = ${raceId})`);
});
