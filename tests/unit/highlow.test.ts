import { describe, expect, it } from "vitest";
import { RULES } from "./setup-rules";
import hlTable from "../fixtures/hl_mult.json";
import { hlMult, hlNextPot, hlWinCards, type HighLowChoice } from "@/lib/game";

type Row = { card: number; choice: HighLowChoice; stage: number; mult: number };
const rows = hlTable as Row[];

describe("하이로우 배율 — 화면 계산이 서버 app.hl_mult 와 같다", () => {
  it("서버 표가 모든 카드 · 선택 · 단계를 담고 있다", () => {
    expect(rows).toHaveLength(13 * 3 * RULES.highlow.max_stage);
  });

  it.each(rows)("카드 $card · $choice · $stage단계 = ×$mult", ({ card, choice, stage, mult }) => {
    expect(hlMult(card, choice, stage)).toBe(mult);
  });

  it("적중 카드 수는 13장 기준", () => {
    expect(hlWinCards(1, "low")).toBe(0);
    expect(hlWinCards(13, "high")).toBe(0);
    expect(hlWinCards(7, "high")).toBe(6);
    expect(hlWinCards(7, "same")).toBe(1);
  });
});

describe("하이로우 적립금 — 서버의 round(base × mult) 와 같다", () => {
  // 서버는 numeric 으로 정확히 곱한 뒤 반올림한다(양수라 0.5 는 올림).
  const serverPot = (base: number, mult: number) =>
    Math.floor((base * Math.round(mult * 100) + 50) / 100);

  it("판돈 1~300, 모든 배율에서 한 코인도 어긋나지 않는다", () => {
    for (const { card, choice, stage, mult } of rows) {
      if (mult === 0) continue;
      for (let base = 1; base <= 300; base++) {
        expect(hlNextPot(base, card, choice, stage)).toBe(serverPot(base, mult));
      }
    }
  });
});

describe("하이로우 단계별 기대값", () => {
  it("상한에 걸리지 않는 선택은 기대값이 (1 − 단계 엣지) ± 반올림 오차", () => {
    for (const { card, choice, stage, mult } of rows) {
      const p = hlWinCards(card, choice) / 13;
      if (p === 0 || mult >= RULES.highlow.max_mult) continue;
      expect(Math.abs(p * mult - (1 - RULES.highlow.edge[stage - 1]))).toBeLessThanOrEqual(0.005);
    }
  });
});
