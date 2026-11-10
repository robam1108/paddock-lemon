"use client";

import { createPortal } from "react-dom";
import { MIX_NAME, MIX_TO } from "@/lib/game";
import { CAT_GIFT_ACTIVE_LINE, catGiftUseInfo } from "@/lib/copy";
import MonoLabel from "../ui/MonoLabel";
import { action } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 되묻기 팝업 — 관계 삭제 · 소지품 판매 · 고양이 선물 사용 · 우유 섞기. */
export default function ConfirmPopup({ m }: { m: RecordModel }) {
  const {
    confirm,
    busy,
    catGiftActive,
    catStatus,
    items,
    mixDrinks,
    onMix,
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
                  {confirm.kind === "relation-delete"
                    ? "친구 삭제"
                    : confirm.kind === "cat-use"
                      ? confirm.name
                      : confirm.kind === "mix"
                        ? "우유에 섞기"
                        : "소지품 판매"}
                </MonoLabel>
              </div>
              {confirm.kind === "mix" ? (
                <div className="flex flex-col gap-2 p-4">
                  <p className="body-15 text-fg">무엇을 섞을까요?</p>
                  {mixDrinks.map((d) => {
                    const to = items.find((i) => i.code === MIX_TO[d.code])?.name ?? MIX_NAME[d.code];
                    return (
                      <button
                        key={d.code}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirm(null);
                          onMix(d.code);
                        }}
                        className={action}
                      >
                        {d.name} → {to}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm(null)}
                    className={action}
                  >
                    취소
                  </button>
                </div>
              ) : confirm.kind === "cat-use" ? (
                (() => {
                  const info = catGiftUseInfo(confirm.code, catStatus?.cat_name ?? null);
                  const active = catGiftActive(confirm.code);
                  return (
                    <div className="flex flex-col gap-2 p-4">
                      {info.lines.map((l) => (
                        <p key={l} className="body-15 text-fg">
                          {l}
                        </p>
                      ))}
                      {active && <p className="mono-13 text-fg-low">{CAT_GIFT_ACTIVE_LINE}</p>}
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          disabled={busy || active}
                          onClick={runConfirm}
                          className={`${action} flex-1`}
                        >
                          사용
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm(null)}
                          className={action}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : (
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
              )}
            </div>
          </div>,
          document.body,
        )}

    </>
  );
}
