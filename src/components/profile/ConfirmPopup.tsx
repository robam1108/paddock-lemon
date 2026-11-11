"use client";

import { createPortal } from "react-dom";
import MonoLabel from "../ui/MonoLabel";
import { action } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 되묻기 팝업 — 관계 삭제 · 소지품 판매. */
export default function ConfirmPopup({ m }: { m: RecordModel }) {
  const {
    confirm,
    busy,
    relBusy,
    runConfirm,
    setConfirm,
  } = m;
  return (
    <>
      {/* 되묻기 팝업 — 관계 삭제 · 소지품 판매 공용 */}
      {confirm &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => {
              if (!relBusy && !busy) setConfirm(null);
            }}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>
                  {confirm.kind === "relation-delete" ? "친구 삭제" : "소지품 판매"}
                </MonoLabel>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg">
                  {confirm.kind === "relation-delete"
                    ? `${confirm.who} 친구 기록을 삭제합니다. 되돌릴 수 없습니다.`
                    : `${confirm.name} ${confirm.qty}개를 ${confirm.total} 코인에 판매합니다. 되돌릴 수 없습니다.`}
                </p>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    disabled={confirm.kind === "relation-delete" ? relBusy : busy}
                    onClick={runConfirm}
                    className="label-11 state-fade flex-1 border border-loss/60 bg-surface-hi px-3 py-2.5 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                  >
                    {confirm.kind === "relation-delete" ? "삭제" : "판매"}
                  </button>
                  <button
                    type="button"
                    disabled={confirm.kind === "relation-delete" ? relBusy : busy}
                    onClick={() => setConfirm(null)}
                    className={action}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

    </>
  );
}
