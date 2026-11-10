"use client";

import { useEffect, useRef, useState } from "react";
import {
  ROULETTE_BETS,
  ROULETTE_NUMBER_MULT,
  ROULETTE_SLOTS,
  isNumberBet,
  rouletteChoiceLabel,
  rouletteColor,
  type PlayResult,
} from "@/lib/game";
import { LABEL } from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";
import { usePendingSettle } from "@/hooks/usePendingSettle";

/**
 * 룰렛 — 어디선가 뜯어 온 원판에 페인트를 다시 칠한 물건이다.
 * 그래서 색이 선명하지 않고, 시설 화면 톤보다 조금 탁하다.
 *
 * 하이로우와 같은 골격을 쓴다: 배당 레일 | 게임 존 | 건 코인.
 */

const SEG = 360 / ROULETTE_SLOTS; // 24도
const SPIN_MS = 4200;

// 물감 색. 강조색이 아니라 원판에 칠해진 도료다.
const SEGMENT_FILL: Record<string, string> = {
  green: "oklch(0.40 0.050 155)",
  red: "oklch(0.42 0.075 25)",
  black: "oklch(0.24 0.006 210)",
};

function wheelGradient() {
  const stops = Array.from({ length: ROULETTE_SLOTS }, (_, i) => {
    const fill = SEGMENT_FILL[rouletteColor(i)];
    return `${fill} ${i * SEG}deg ${(i + 1) * SEG}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

const COLOR_LABEL: Record<string, string> = {
  red: "빨강",
  black: "검정",
  green: "초록",
};

export default function Roulette({
  bet,
  disabled,
  blockedRow,
  betSlot,
  onPlay,
  onSettle,
}: {
  bet: number;
  disabled: boolean;
  blockedRow: React.ReactNode | null;
  betSlot: React.ReactNode;
  onPlay: (game: "roulette", choice: string) => Promise<PlayResult | null>;
  onSettle: (result: PlayResult) => void;
}) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);
  const [choice, setChoice] = useState<string>("red");
  const rotationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const { hold, settle } = usePendingSettle(onSettle);

  // 판이 도는 중에 화면을 떠나면 타이머를 치운다. 정산은 usePendingSettle 이
  // 대신 흘려보내므로 잠금은 남지 않는다.
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const numberBet = isNumberBet(choice);
  const payoutMult = numberBet
    ? ROULETTE_NUMBER_MULT
    : (ROULETTE_BETS.find((b) => b.id === choice)?.mult ?? 2);

  async function spin() {
    if (disabled || spinning) return;

    const result = await onPlay("roulette", choice);
    if (!result) return;

    const slot = (result.outcome as { slot: number }).slot;
    hold(result);
    setSpinning(true);
    setLanded(null);

    // 항상 시계방향으로 최소 5바퀴 이상 돌면서 slot 이 위쪽 포인터에 오도록 한다.
    const target = -(slot * SEG + SEG / 2);
    const next =
      target + 360 * Math.ceil((rotationRef.current + 360 * 5 - target) / 360);
    rotationRef.current = next;
    setRotation(next);

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setSpinning(false);
      setLanded(slot);
      settle();
    }, SPIN_MS);
  }

  const locked = disabled || spinning;

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-bg-1 grid grid-cols-1 gap-2 p-2 desk:grid-cols-[minmax(0,1fr)_244px] desk:gap-4 desk:p-4">
        {/* [2] 원판 */}
        <div className="flex min-h-0 flex-col items-center justify-center gap-2.5 desk:min-h-[340px]">
          <div className="relative aspect-square w-[min(66vw,15rem)] desk:w-[268px]">
            <div className="absolute left-1/2 top-[-6px] z-20 -translate-x-1/2">
              <div className="border-t-brass h-0 w-0 border-x-[8px] border-t-[14px] border-x-transparent" />
            </div>

            <div className="border-line absolute inset-0 rounded-full border-2" />

            <div
              className="roulette-wheel absolute inset-1 rounded-full"
              style={{
                background: wheelGradient(),
                transform: `rotate(${rotation}deg)`,
                transitionDuration: spinning ? `${SPIN_MS}ms` : "0ms",
              }}
            >
              {/* 라벨: 바깥 div 를 휠 중심 기준으로 돌리고, 안쪽 글자를 되돌려 세운다.
                  이렇게 하면 휠 지름이 바뀌어도 위치가 그대로 유지된다. */}
              {Array.from({ length: ROULETTE_SLOTS }, (_, i) => {
                const angle = i * SEG + SEG / 2;
                return (
                  <div
                    key={i}
                    className="pointer-events-none absolute inset-0"
                    style={{ transform: `rotate(${angle}deg)` }}
                  >
                    <span
                      className="absolute left-1/2 top-[7%] font-mono text-[11px] font-semibold text-fg-hi"
                      style={{
                        transform: `translateX(-50%) rotate(${-angle}deg)`,
                      }}
                    >
                      {i}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="border-line bg-bg-0 absolute left-1/2 top-1/2 z-10 flex h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border">
              {landed === null ? (
                <MonoLabel tone="low">{spinning ? "회전" : "대기"}</MonoLabel>
              ) : (
                <>
                  <span className="num-md text-fg-hi tabular-nums">
                    {landed}
                  </span>
                  <MonoLabel tone="low">
                    {COLOR_LABEL[rouletteColor(landed)]}
                  </MonoLabel>
                </>
              )}
            </div>
          </div>
        </div>

        {/* [3] 건 코인 · 선택 — 모바일에서는 감춰 판이 한눈에 들어오게 한다 */}
        <div className="hidden grid-cols-2 gap-2 tab:grid desk:flex desk:flex-col">
          <div className="bg-surface flex flex-col gap-1 p-3">
            <MonoLabel>{LABEL.stake}</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">{bet}</span>
          </div>
          <div className="border-brass-line flex flex-col gap-1 border bg-brass-fill p-3">
            <MonoLabel>배당</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">
              ×{payoutMult}
            </span>
          </div>
          <div className="bg-surface col-span-2 hidden flex-1 flex-col justify-end gap-1.5 p-3 desk:flex">
            <span className="body-15 text-fg-mid">
              지금 건 것은 {rouletteChoiceLabel(choice)}다.
            </span>
            <span className="body-15 text-fg">
              한 번 돌아가면 되돌릴 수 없다.
            </span>
          </div>
        </div>
      </div>

      {betSlot}

      {blockedRow ?? (
        <>
          {/* 색에 걸기 — 베팅 금액 아래, 숫자 위 */}
          <div className="bg-bg-1 flex flex-col gap-2 p-2.5">
            <MonoLabel>색에 걸기</MonoLabel>
            <div className="grid grid-cols-3 gap-1">
              {ROULETTE_BETS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  disabled={locked}
                  onClick={() => setChoice(b.id)}
                  className={`state-fade flex min-h-11 flex-col items-center justify-center gap-0.5 border-t-2 pt-1 ${
                    choice === b.id
                      ? "bg-surface-hi text-fg-hi"
                      : "bg-surface text-fg-mid"
                  }`}
                  style={{ borderTopColor: SEGMENT_FILL[b.id] }}
                >
                  <span className="title-19">{b.label}</span>
                  <span className="mono-13 text-fg-mid tabular-nums">
                    ×{b.mult}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 숫자에 걸기 */}
          <div className="bg-bg-1 flex flex-col gap-2 p-2.5">
            <MonoLabel>숫자에 걸기 ×{ROULETTE_NUMBER_MULT}</MonoLabel>
            <div className="grid grid-cols-5 gap-1 tab:grid-cols-8 desk:grid-cols-15">
              {Array.from({ length: ROULETTE_SLOTS }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  disabled={locked}
                  onClick={() => setChoice(String(n))}
                  className={`state-fade border-t-2 py-2.5 font-mono text-sm font-bold ${
                    choice === String(n)
                      ? "bg-surface-hi text-fg-hi"
                      : "bg-surface text-fg-mid"
                  }`}
                  style={{ borderTopColor: SEGMENT_FILL[rouletteColor(n)] }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        disabled={locked || !!blockedRow}
        onClick={spin}
        className={`state-fade title-19 min-h-12 border ${
          locked || blockedRow
            ? "border-line-soft bg-bg-1 text-fg-low"
            : "border-brass-line bg-brass-fill text-fg-hi"
        }`}
      >
        {spinning
          ? "도는 중"
          : `${rouletteChoiceLabel(choice)}에 ${bet} 코인 · ×${payoutMult}`}
      </button>
    </div>
  );
}
