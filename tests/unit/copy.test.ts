import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eulReul, iGa, settleLine, waGwa } from "@/lib/copy";
import { formatDaysLeft, formatDuration } from "@/lib/game";
import { ERROR_MESSAGES, toKoreanError } from "@/lib/errors";

describe("조사", () => {
  it("받침 유무로 고른다", () => {
    expect(eulReul("빵")).toBe("을");
    expect(eulReul("우유")).toBe("를");
    expect(waGwa("빵")).toBe("과");
    expect(waGwa("우유")).toBe("와");
    expect(iGa("말")).toBe("이");
    expect(iGa("나비")).toBe("가");
  });

  it("한글로 끝나지 않으면 둘 다 적는다", () => {
    expect(eulReul("Paddock")).toBe("을(를)");
    expect(iGa("A7")).toBe("이(가)");
  });
});

describe("시간 · 결과 표기", () => {
  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("0분");
    expect(formatDuration(59 * 60)).toBe("59분");
    expect(formatDuration(3600 * 12 + 34 * 60)).toBe("12시간 34분");
  });

  it("formatDaysLeft", () => {
    expect(formatDaysLeft(-1)).toBe("0시간");
    expect(formatDaysLeft(86400 * 2 + 3600 * 5)).toBe("2일 5시간");
  });

  it("settleLine", () => {
    expect(settleLine(5, 10)).toBe("10 코인 수령 · 순이익 +5");
    expect(settleLine(-3, 0)).toBe("3 코인 손실");
    expect(settleLine(0, 5)).toMatch(/^본전/);
  });

});

describe("서버 오류 코드 → 화면 문구", () => {
  it("코드마다 자기 문구로 바뀐다(앞선 코드에 가려지지 않는다)", () => {
    for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
      expect(toKoreanError(`ERROR: ${code}`), code).toBe(text);
    }
  });

  it("모르는 메시지는 그대로, 빈 값은 일반 문구", () => {
    expect(toKoreanError("boom")).toBe("boom");
    expect(toKoreanError(undefined)).toBe("알 수 없는 오류가 발생했습니다.");
  });

  it("마이그레이션이 던지는 오류 코드는 모두 화면 문구가 있다", () => {
    const dir = "supabase/migrations";
    const codes = new Set<string>();
    for (const f of readdirSync(dir)) {
      const sql = readFileSync(join(dir, f), "utf8");
      for (const m of sql.matchAll(/raise exception '([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]);
    }
    const missing = [...codes].filter((c) => !(c in ERROR_MESSAGES));
    expect(missing).toEqual([]);
  });
});
