"use client";

import { useSyncExternalStore } from "react";

/**
 * 375 구간에서만 동작이 달라지는 것들 — 우측 3패널의 아코디언 접힘 —
 * 때문에 폭을 JS 로도 알아야 한다. 레이아웃 자체는 전부 CSS 미디어쿼리로
 * 처리하고, 여기서 재는 값은 "접을 수 있느냐"에만 쓴다.
 *
 * globals.css 의 --breakpoint-tab (700px) 과 짝을 이룬다. 한쪽만 바꾸면 어긋난다.
 */
const QUERY = "(max-width: 699px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** 서버 렌더 시점에는 폭을 알 수 없다. 데스크톱으로 가정해 패널을 펼쳐 둔다. */
function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
