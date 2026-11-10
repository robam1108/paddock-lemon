"use client";

import Link from "next/link";
import { LIVE_NOTE, SITE_LINE, SITE_LINE_SHORT } from "@/lib/site";
import { LABEL } from "@/lib/copy";
import MonoLabel from "../ui/MonoLabel";
import { PLAIN } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 머리줄과 공용 안내 · 오류 배너. */
export default function AdminHeader({ m }: { m: AdminModel }) {
  const {
    error,
    notice,
    username,
  } = m;
  return (
    <>
      {/* ── 헤더 ── */}
      <header className="border-line border bg-bg-1">
        <div className="scanline border-line-soft flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-3.5 py-1.5">
          <MonoLabel tone="low">
            <span className="hidden tab:inline">{SITE_LINE}</span>
            <span className="tab:hidden">{SITE_LINE_SHORT}</span>
          </MonoLabel>
          <MonoLabel tone="low">{LIVE_NOTE}</MonoLabel>
        </div>
        <div className="flex items-center gap-3 px-3.5 py-3">
          <div className="min-w-0">
            <MonoLabel tone="low">{LABEL.admin}</MonoLabel>
            <div className="title-19 text-fg-hi mt-1">관리자</div>
          </div>
          <MonoLabel tone="mid" className="truncate">
            {username}
          </MonoLabel>
          <Link href="/play" className={`${PLAIN} ml-auto`}>
            게임으로
          </Link>
        </div>
      </header>

      {error && (
        <p className="mono-13 border border-loss/50 bg-bg-1 px-3.5 py-2.5 text-loss">
          {error}
        </p>
      )}
      {notice && (
        <p className="mono-13 border border-brass-line bg-brass-fill px-3.5 py-2.5 text-fg-hi">
          {notice}
        </p>
      )}

    </>
  );
}
