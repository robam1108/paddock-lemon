// 시연 자료 만들기 — README · 포트폴리오에 쓰는 스크린샷과 경주 중계 GIF.
// 로컬 Supabase + seed 위에서 demo01 로 한 바퀴 돈다(로컬 DB 를 실제로 바꾼다).
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { PNG } from "pngjs";
import { psql } from "../../scripts/lib/psql.mjs";

const OUT = "docs/media";
const USER = "demo01";
const PASS = "paddock-demo"; // seed.sql 의 로컬 전용 데모 비밀번호

test("시연 자료", async ({ page }) => {
  test.setTimeout(240_000);
  psql(`update public.profiles set coins = greatest(coins, 500), hp = 100, ward_until = null
         where username = '${USER}'`);
  psql(`delete from public.races where day = app.today_kst() and no = 92 and not is_test`);
  const raceId = psql(`
    with c as (select array_agg(app.race_roll_cond()) as cond from generate_series(1, 8))
    select app.race_create(app.today_kst(), 92::smallint, false, now() + interval '10 minutes',
                           app.pick_shuffled(1, 20, 8)::smallint[], 1400, 1::smallint, c.cond,
                           (select array_agg(app.race_wdelta(x)) from unnest(c.cond) x), null)
      from c`);

  // 개발 서버 표시(Next.js 아이콘)는 시연 자료에서 뺀다.
  const hideDevUi = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const top = () => page.evaluate(() => window.scrollTo(0, 0));

  // 1. 로그인 화면(게스트 체험 버튼 포함)
  await page.goto("/login");
  await hideDevUi();
  await expect(page.getByRole("button", { name: "로그인 없이 체험하기" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/login.png` });

  await page.getByPlaceholder("예: demo01").fill(USER);
  await page.getByPlaceholder("비밀번호").fill(PASS);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/play/);

  // 2. 캐주얼 룰렛 한 판
  await page.getByRole("button", { name: "캐주얼", exact: true }).click();
  await page.getByRole("button", { name: /^빨강에 \d+ 코인/ }).click();
  await expect(page.getByText(/코인 손실|코인 수령|본전/)).toBeVisible({ timeout: 15_000 });
  await top();
  await page.screenshot({ path: `${OUT}/casual-roulette.png` });

  // 3. 경마장 출전표 · 배당
  await page.getByRole("button", { name: "아레나", exact: true }).click();
  await page.getByRole("button", { name: "경마장", exact: true }).click();
  const firstHorse = page.locator('[role="button"][aria-pressed]').first();
  await firstHorse.click();
  await page.getByRole("button", { name: "마권 구매" }).click();
  await expect(page.getByText(/단승 1 · \d+코인 베팅했습니다/)).toBeVisible();
  await top();
  await page.screenshot({ path: `${OUT}/race-card.png` });

  // 4. 실황 중계 GIF — 발주를 당기고, 중계 패널만 잘라 프레임을 모은다.
  psql(`update public.races set post_at = now() - interval '1 second' where id = ${raceId}`);
  const live = page.getByText("● 실황 중계").locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
  await expect(live).toBeVisible({ timeout: 30_000 });
  await live.scrollIntoViewIfNeeded();

  const frames: { png: Buffer; at: number }[] = [];
  const result = page.getByText("성적", { exact: true });
  while (!(await result.isVisible())) {
    try {
      frames.push({ png: await live.screenshot({ animations: "allow" }), at: Date.now() });
    } catch {
      break; // 중계가 끝나 패널이 사라졌다
    }
  }
  console.log(`race-replay.gif: ${frames.length} frames, ${((frames.at(-1)!.at - frames[0].at) / 1000).toFixed(1)}s`);
  writeGif(`${OUT}/race-replay.gif`, frames);

  // 5. 성적표 · 내 마권
  await expect(result).toBeVisible({ timeout: 30_000 });
  const panel = result.locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
  await panel.screenshot({ path: `${OUT}/race-result.png` });

  psql(`delete from public.races where id = ${raceId}`);
});

/** PNG 프레임들을 GIF 로. 프레임 크기가 조금씩 달라도 첫 프레임 크기에 맞춰 자른다. */
function writeGif(path: string, frames: { png: Buffer; at: number }[]) {
  expect(frames.length).toBeGreaterThan(20);
  const first = PNG.sync.read(frames[0].png);
  // 너비 720 으로 줄인다(2배수 간격으로 건너뛰는 최근접 축소).
  const step = Math.max(1, Math.ceil(first.width / 720));
  const w = Math.floor(first.width / step);
  const h = Math.floor(first.height / step);
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const src = PNG.sync.read(frames[i].png);
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(src.width - 1, x * step);
        const sy = Math.min(src.height - 1, y * step);
        const s = (sy * src.width + sx) * 4;
        rgba.set(src.data.subarray(s, s + 4), (y * w + x) * 4);
      }
    }
    const palette = quantize(rgba, 128);
    const index = applyPalette(rgba, palette);
    const delay = i + 1 < frames.length ? frames[i + 1].at - frames[i].at : 1500;
    gif.writeFrame(index, w, h, { palette, delay });
  }
  gif.finish();
  writeFileSync(path, gif.bytes());
}
