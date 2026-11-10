"use client";

import type { HpStatus } from "@/lib/game";
import { healthNote, LABEL } from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";

const CELLS = 20;

/**
 * 에너지 게이지.
 *
 * 연속된 막대가 아니라 20칸으로 끊는다. 에너지는 매끄럽게 흐르는 수치가 아니라
 * 칸 단위로 쓰는 몫이고, 칸이 하나씩 꺼지는 편이 그렇게 읽힌다.
 * 색은 면이 아니라 이 게이지에만 얹는다.
 */
export default function HpBar({
  hp,
  max,
  status,
  compact,
}: {
  hp: number;
  max: number;
  status: HpStatus;
  /** 헤더 밖(팝업 등)에서 라벨 줄 없이 게이지만 쓸 때 */
  compact?: boolean;
}) {
  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, max)));
  const filled = Math.round(ratio * CELLS);

  const gauge = (
    <div className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: CELLS }, (_, i) => (
        <span
          key={i}
          className={`h-[7px] flex-1 ${i < filled ? "bg-hp" : "bg-hp-empty"}`}
        />
      ))}
    </div>
  );

  if (compact) {
    return (
      <div
        className="flex flex-col gap-1"
        role="meter"
        aria-valuenow={hp}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`${LABEL.health} ${hp}/${max} ${status}`}
      >
        {gauge}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1"
      role="meter"
      aria-valuenow={hp}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={`${LABEL.health} ${hp}/${max} ${status}`}
    >
      <div className="flex items-center justify-between gap-2">
        <MonoLabel>{LABEL.health}</MonoLabel>
        <MonoLabel tone="low">{healthNote(hp, max)}</MonoLabel>
      </div>
      <div className="num-md text-fg-hi tabular-nums">
        {hp}
        <span className="text-fg-mid text-[15px] font-normal"> / {max}</span>
      </div>
      {gauge}
    </div>
  );
}
