"use client";

import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import MonoLabel from "./MonoLabel";

/**
 * 우측 3패널의 공통 껍데기. 규칙 → 실시간 결과 → 코인 순위 순서로 쌓인다.
 *
 * 데스크톱에서는 접히지 않는다. `maxHeight`를 넘기면 본문 높이를 고정하고
 * 안에서 스크롤시킨다(실시간 결과·순위 패널이 여기 해당). 규칙 패널은
 * `maxHeight`를 넘기지 않아 스크롤 없이 내용 전체가 보인다. 375 에서만
 * 아코디언이 된다.
 */
export default function SidePanel({
  title,
  meta,
  maxHeight,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** 우측 끝의 부속 표기 — "12항", "최근 5건", "실시간" */
  meta?: string;
  /** 본문 고정 높이(px). 넘치면 안에서 스크롤한다. */
  maxHeight?: number;
  /** 모바일에서 기본으로 펼쳐 둘지. 규칙만 true. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(defaultOpen);
  const collapsed = isMobile && !open;

  return (
    <section className={defaultOpen ? "bg-bg-2" : "bg-bg-1"}>
      <button
        type="button"
        disabled={!isMobile}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isMobile ? open : undefined}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
      >
        <span className="title-19 text-fg-hi">{title}</span>
        <span className="flex items-center gap-2">
          {meta && <MonoLabel tone="low">{meta}</MonoLabel>}
          {isMobile && (
            <span aria-hidden className="text-fg-low text-xs">
              {open ? "▾" : "▸"}
            </span>
          )}
        </span>
      </button>

      {!collapsed && (
        <div
          className="overflow-y-auto px-3.5 pb-3.5"
          style={maxHeight ? { maxHeight } : undefined}
        >
          {children}
        </div>
      )}
    </section>
  );
}
