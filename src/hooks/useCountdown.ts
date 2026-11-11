"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 서버가 준 남은 초(정수)를 화면에서 1초씩 깎는다.
 *
 * pvp_state 는 아레나 에서 1.5초, 밖에서는 5초마다 온다. 그 값을 그대로
 * 찍으면 숫자가 폴링 때만 바뀌어 1초·2초가 번갈아 빠진다(밖에서는 5초씩).
 * 그래서 서버 값은 마감 시각의 기준점으로만 쓰고, 표시는 로컬 시계로 센다.
 *
 * 다음 폴링 값이 기존 마감과 1초 안쪽으로 맞으면 정수 반올림 오차로 보고
 * 무시한다 — 기준을 매번 바꾸면 숫자가 다시 튄다. 1초 넘게 어긋나면
 * (턴이 넘어가 마감이 새로 잡힌 경우 등) 새 기준으로 갈아탄다.
 */
export function useCountdown(seconds: number | null | undefined): number {
  const deadline = useRef<number | null>(null);
  const [left, setLeft] = useState(() => Math.max(0, seconds ?? 0));

  useEffect(() => {
    if (seconds == null) {
      deadline.current = null;
      return;
    }
    const candidate = Date.now() + seconds * 1000;
    if (
      deadline.current === null ||
      Math.abs(candidate - deadline.current) > 1000
    ) {
      deadline.current = candidate;
    }

    const update = () => {
      if (deadline.current === null) return;
      const next = Math.max(
        0,
        Math.ceil((deadline.current - Date.now()) / 1000),
      );
      setLeft((prev) => (prev === next ? prev : next));
    };

    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [seconds]);

  return left;
}

/** 훅을 반복문 안에서 못 부르는 목록용 — 남은 초 숫자만 그린다. */
export function Countdown({ seconds }: { seconds: number }) {
  return useCountdown(seconds);
}
