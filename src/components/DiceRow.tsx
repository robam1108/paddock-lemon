"use client";

import { useEffect, useState } from "react";

/** 3x3 격자에서 눈이 찍히는 칸 (0 = 좌상단, 8 = 우하단) */
const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function randomFace() {
  return 1 + Math.floor(Math.random() * 6);
}

function Die({
  value,
  rolling,
  unknown,
  delay,
}: {
  value: number;
  rolling?: boolean;
  unknown?: boolean;
  delay: number;
}) {
  const pips = PIP_LAYOUT[value] ?? [];

  return (
    <span className="die-stage">
      <span
        className={`die ${rolling ? "die-rolling" : ""}`}
        style={rolling ? { animationDelay: `${delay}s` } : undefined}
      >
        {unknown && !rolling ? (
          <span className="die-unknown">?</span>
        ) : (
          <span className="die-face">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i}>{pips.includes(i) && <span className="pip" />}</span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * 주사위 두 개.
 * rolling 이면 눈이 빠르게 바뀌면서 정육면체가 구르는 것처럼 회전한다.
 * 멈출 때 튀어오르는 연출은 없앴다 — 결과가 나온 순간 그냥 놓여 있으면 된다.
 */
export default function DiceRow({
  values,
  rolling,
  hidden,
}: {
  values: number[] | null;
  rolling?: boolean;
  hidden?: boolean;
}) {
  const [faces, setFaces] = useState<number[]>([1, 2]);

  useEffect(() => {
    if (!rolling) return;
    const timer = window.setInterval(
      () => setFaces([randomFace(), randomFace()]),
      80,
    );
    return () => window.clearInterval(timer);
  }, [rolling]);

  const shown = rolling ? faces : (values ?? [1, 1]);

  return (
    <div className="flex items-center justify-center gap-2.5">
      {[0, 1].map((i) => (
        <Die
          key={i}
          value={shown[i]}
          rolling={rolling}
          unknown={hidden && !values}
          delay={i * 0.11}
        />
      ))}
    </div>
  );
}
