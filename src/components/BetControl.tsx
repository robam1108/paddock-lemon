"use client";

import { useCallback, useEffect, useRef } from "react";
import { LABEL } from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";

/**
 * 베팅 금액 조절기. 숫자를 직접 입력할 수는 없고 ‹ › 로만 움직인다.
 * 버튼을 누르고 있으면 점점 빨라지며 연속 증감한다.
 */
export default function BetControl({
  value,
  min,
  max,
  disabled,
  onChange,
  wage,
  held,
}: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (next: number) => void;
  /** 이 판돈으로 걸었을 때 받는 참가 보상. 있으면 보유 코인 옆에 함께 보여준다. */
  wage?: number;
  /** 보유 코인 표기. 상한(max)이 보유 코인과 다를 때(경마 한도 등)만 준다. */
  held?: number;
}) {
  const timer = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, n)),
    [min, max],
  );

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const step = useCallback(
    (delta: number) => {
      const next = clamp(valueRef.current + delta);
      if (next !== valueRef.current) onChange(next);
    },
    [clamp, onChange],
  );

  /** 길게 누르면 600ms 후부터 가속하며 반복한다. */
  const startRepeat = useCallback(
    (delta: number) => {
      stop();
      step(delta);

      let interval = 220;
      const tick = () => {
        step(delta);
        interval = Math.max(45, interval * 0.82);
        timer.current = window.setTimeout(tick, interval);
      };
      timer.current = window.setTimeout(tick, 600);
    },
    [step, stop],
  );

  const canDown = !disabled && value > min;
  const canUp = !disabled && value < max;

  const holdProps = (delta: number, enabled: boolean) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      e.preventDefault();
      startRepeat(delta);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  });

  const quick = "label-11 state-fade border-line border bg-surface-hi px-3 h-10 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

  // 한 줄이다. 금액을 정하는 건 판 전체에서 가장 사소한 동작이라
  // 카드나 3버튼만큼의 자리를 내주지 않는다.
  return (
    <div className="bg-bg-1 flex flex-wrap items-center gap-1.5 p-2.5">
      <MonoLabel className="max-tab:w-full tab:mr-1">{LABEL.bet}</MonoLabel>

      <button
        type="button"
        disabled={!canDown}
        aria-label="베팅 줄이기"
        className="border-line state-fade h-10 w-11 shrink-0 border bg-surface-hi text-lg text-fg select-none disabled:text-fg-low"
        {...holdProps(-1, canDown)}
      >
        ＜
      </button>

      <div
        className={`flex h-10 min-w-28 flex-1 items-center justify-center gap-1.5 border bg-surface ${
          disabled ? "border-brass-line" : "border-line"
        }`}
      >
        <span className="num-md inline-block min-w-[3ch] text-fg-hi tabular-nums leading-none text-right">
          {value}
        </span>
        <span className="label-11 text-fg-mid">코인</span>
      </div>

      <button
        type="button"
        disabled={!canUp}
        aria-label="베팅 늘리기"
        className="border-line state-fade h-10 w-11 shrink-0 border bg-surface-hi text-lg text-fg select-none disabled:text-fg-low"
        {...holdProps(1, canUp)}
      >
        ＞
      </button>

      <div className="flex gap-0.5 max-tab:w-full">
        <button
          type="button"
          disabled={disabled || value === min}
          onClick={() => onChange(min)}
          className={`${quick} max-tab:flex-1`}
        >
          최소
        </button>
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 10))}
          className={`${quick} max-tab:flex-1`}
        >
          +10
        </button>
        <button
          type="button"
          disabled={disabled || value === max}
          onClick={() => onChange(max)}
          className={`${quick} max-tab:flex-1`}
        >
          최대
        </button>
      </div>

      <span className="mono-13 text-fg-low ml-auto hidden tab:inline">
        보유{" "}
        <span className="tabular-nums inline-block min-w-[4ch] text-right">
          {held ?? max}
        </span>{" "}
        코인
        <span className={wage && !disabled ? "" : "invisible"}>
          {" "}
          · 참가 보상{" "}
          <span className="tabular-nums inline-block min-w-[3ch] text-right">
            {wage ?? 0}
          </span>
        </span>
      </span>
    </div>
  );
}
