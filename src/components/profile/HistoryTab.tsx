"use client";

import { LEDGER_KIND_LABEL } from "@/lib/game";
import MonoLabel from "../ui/MonoLabel";
import { action, adminLine, gameLine, gameTitle } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 기록 탭 — 최근 코인 원장. */
export default function HistoryTab({ m }: { m: RecordModel }) {
  const {
    loadLog,
    log,
    tab,
  } = m;
  return (
    <>
      {/* ── 기록 ── */}
      {tab === "history" && (
        <section className="bg-bg-1 flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <MonoLabel tone="low">최근 30건</MonoLabel>
            <button type="button" onClick={loadLog} className={action}>
              다시 조회
            </button>
          </div>

          {log.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              기록 없음
            </p>
          ) : (
            <ul className="flex flex-col">
              {log.map((e) => {
                const line =
                  e.kind === "game"
                    ? gameLine(e.title, e.detail)
                    : e.kind === "admin"
                      ? adminLine(e.detail)
                      : null;
                const title = gameTitle(e.title);
                return (
                  <li
                    key={e.id}
                    className="mono-13 border-line-soft grid grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 border-b py-2 tab:grid-cols-[52px_minmax(0,1fr)_auto_auto]"
                  >
                    <span className="text-fg-low truncate">
                      {LEDGER_KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <span className="text-fg truncate">{title}</span>
                    <span
                      className={`text-right tabular-nums ${e.coin_delta < 0 ? "text-loss" : "text-fg-hi"
                        }`}
                    >
                      {e.coin_delta > 0 ? `+${e.coin_delta}` : e.coin_delta}
                    </span>
                    {/* 총 소유금액 — 태블릿 이상에서만. 모바일은 폭이 좁아 잘리므로 감춘다. */}
                    <span className="text-fg-low hidden text-right tabular-nums tab:block">
                      {e.coin_after}
                    </span>
                    {line && (
                      <span className="text-fg-low col-start-2 col-end-[-1] whitespace-normal">
                        {line}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

    </>
  );
}
