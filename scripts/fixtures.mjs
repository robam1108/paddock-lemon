// 서버 규칙 값을 테스트 픽스처로 뽑는다.
//
//   node scripts/fixtures.mjs          tests/fixtures/*.json 을 다시 쓴다
//   node scripts/fixtures.mjs --check  다시 뽑은 값이 커밋된 픽스처와 같은지만 본다(CI)
//
// 로컬 Supabase(supabase start)가 떠 있어야 한다.
import { readFileSync, writeFileSync } from "node:fs";

import { psql } from "./lib/psql.mjs";

const sql = (query) => JSON.parse(psql(query));

const fixtures = {
  // 화면이 받는 규칙 묶음 그대로
  "tests/fixtures/rules.json": sql("select public.get_rules()"),
  // 하이로우 배율 전체 표 — 서버 app.hl_mult(numeric 반올림)가 정본이다
  "tests/fixtures/hl_mult.json": sql(`
    select jsonb_agg(jsonb_build_object('card', c, 'choice', ch, 'stage', s,
                                        'mult', app.hl_mult(c, ch, s))
                     order by s, c, ch)
      from generate_series(1, 13) c,
           unnest(array['high', 'low', 'same']) ch,
           generate_series(1, app.hl_max_stage()) s`),
};

const check = process.argv.includes("--check");
let stale = 0;
for (const [path, value] of Object.entries(fixtures)) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (check) {
    let old = "";
    try {
      old = readFileSync(path, "utf8");
    } catch {}
    if (old.replace(/\r\n/g, "\n") !== text) {
      console.error(`${path}: 서버 값과 다릅니다. node scripts/fixtures.mjs 로 다시 뽑으세요.`);
      stale++;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}
if (stale) process.exit(1);
if (check) console.log("fixtures: OK");
