"use client";

import { useSyncExternalStore } from "react";

/**
 * 탭이 지금 보이는가.
 *
 * 폴링은 화면을 보고 있을 때만 돈다. 창을 띄워 두기만 한 사람도 5초마다
 * pvp_state(= app.accrue 의 profiles 행 잠금)를 부르면 DB 에 상시 부하가
 * 걸린다. 숨겨지면 멈추고, 다시 보이면 각 폴링 effect 가 재실행되면서
 * 곧바로 한 번 읽어 온다 — 돌아온 순간 낡은 값이 남지 않는다.
 */
function subscribe(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function getSnapshot(): boolean {
  return document.visibilityState === "visible";
}

function getServerSnapshot(): boolean {
  return true;
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
