// 서버 get_rules() 스냅숏(tests/fixtures/rules.json)을 규칙 저장소에 넣는다.
// 픽스처가 서버와 같은지는 CI 의 `node scripts/fixtures.mjs --check` 가 본다.
import rules from "../fixtures/rules.json";
import { setRules, type Rules } from "@/lib/server-rules";

export const RULES = rules as Rules;
setRules(RULES);
