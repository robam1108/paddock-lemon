// 규칙 값(get_rules 스냅숏)만으로 계산하는 하우스 엣지.
// 키노는 재추첨 확률(app.keno_*_keep)이 화면에 내려오지 않아 pgTAP(supabase/tests)에서 본다.
import { describe, expect, it } from "vitest";
import { RULES } from "./setup-rules";
import { kenoMult, kenoTiers, rouletteColor, slotTripleMult, type SlotSymbol } from "@/lib/game";

describe("룰렛", () => {
  const slots = Array.from({ length: RULES.roulette.slots }, (_, i) => rouletteColor(i));
  const count = (c: string) => slots.filter((s) => s === c).length;

  it("15칸 = 초록 1 · 빨강 7 · 검정 7", () => {
    expect(RULES.roulette.slots).toBe(15);
    expect([count("green"), count("red"), count("black")]).toEqual([1, 7, 7]);
  });

  it("색 베팅 하우스 엣지 2.00%", () => {
    const rtp = (count("red") / RULES.roulette.slots) * RULES.roulette.color_mult;
    expect(1 - rtp).toBeCloseTo(0.02, 10);
  });

  it("숫자(초록 포함) 베팅 하우스 엣지 2.00%", () => {
    const rtp = (1 / RULES.roulette.slots) * RULES.roulette.number_mult;
    expect(1 - rtp).toBeCloseTo(0.02, 10);
  });
});

describe("슬롯", () => {
  const pool = RULES.slots.pool;
  const n = pool.length;
  const freq = new Map<string, number>();
  for (const s of pool) freq.set(s, (freq.get(s) ?? 0) + 1);

  it("릴 하나 21칸", () => {
    expect(n).toBe(21);
  });

  it("하우스 엣지 1.91% (세 칸 일치 + 두 칸 일치, 릴 세 개 전수)", () => {
    let rtp = 0;
    for (const a of pool)
      for (const b of pool)
        for (const c of pool) {
          if (a === b && b === c) rtp += slotTripleMult(a as SlotSymbol);
          else if (a === b || b === c || a === c) rtp += RULES.slots.pair_mult;
        }
    rtp /= n ** 3;
    expect(1 - rtp).toBeCloseTo(0.0191, 4);
  });
});

describe("키노 배당표", () => {
  it("1개 이하는 0, 높은 적중부터 정렬", () => {
    expect(kenoMult(0)).toBe(0);
    expect(kenoMult(1)).toBe(0);
    expect(kenoTiers()).toEqual([5, 4, 3, 2]);
    expect(kenoMult(5)).toBeGreaterThan(kenoMult(4));
  });
});
