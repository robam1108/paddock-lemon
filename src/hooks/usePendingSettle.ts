"use client";

import { useEffect, useRef } from "react";
import type { PlayResult } from "@/lib/game";

/**
 * 정산을 기다리는 판을 들고 있다가, 화면이 사라질 때 반드시 흘려보낸다.
 *
 * Casino 의 busy 는 onSettle 한 곳에서만 풀리고, onSettle 은 게임 컴포넌트의
 * setTimeout 안에서만 불린다. 그래서 언마운트 cleanup 이 그 타이머를 지우면
 * 판이 정산되지 않은 채 남아 화면 전체가 잠긴다(구역 탭까지 busy 로 막혀
 * 있어서 새로고침 말고는 빠져나갈 길이 없다).
 *
 * 애니메이션은 못 보여 주더라도 결과는 서버가 이미 확정해 둔 것이므로,
 * 늦게라도 반영하는 쪽이 옳다.
 */
export function usePendingSettle(onSettle: (result: PlayResult) => void) {
  const pending = useRef<PlayResult | null>(null);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;

  useEffect(
    () => () => {
      const left = pending.current;
      pending.current = null;
      if (left) settleRef.current(left);
    },
    [],
  );

  return {
    /** 애니메이션을 시작하면서 결과를 맡겨 둔다 */
    hold: (result: PlayResult) => {
      pending.current = result;
    },
    /** 애니메이션이 끝났다. 맡아 둔 결과가 있으면 한 번만 정산한다 */
    settle: () => {
      const result = pending.current;
      pending.current = null;
      if (result) settleRef.current(result);
    },
  };
}
