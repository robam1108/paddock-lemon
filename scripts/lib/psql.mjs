// 로컬 Supabase DB 에 SQL 한 줄을 보내고 결과 텍스트를 돌려준다(테스트 · 픽스처용).
// psql 이 있으면 DB_URL 로, 없으면(Windows 등) 로컬 DB 컨테이너 안의 psql 로 붙는다.
import { execFileSync, spawnSync } from "node:child_process";

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CONTAINER = process.env.DB_CONTAINER ?? "supabase_db_paddock";

let hasPsql;

/** @param {string} query @returns {string} */
export function psql(query) {
  hasPsql ??= spawnSync("psql", ["--version"]).status === 0;
  const [cmd, args] = hasPsql
    ? ["psql", [DB_URL, "-tAX", "-v", "ON_ERROR_STOP=1", "-c", query]]
    : ["docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-tAX", "-v", "ON_ERROR_STOP=1", "-c", query]];
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}
