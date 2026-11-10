"use client";

import { TRADE_STATUS_LABEL, formatDuration, type PlayerState, type Trade } from "@/lib/game";
import MonoLabel from "../ui/MonoLabel";
import { OfferLine, Picker, PLAIN, PRIMARY, toPayload } from "./parts";

/** 거래 기록 한 건 — 상태 표시와, 내 차례일 때의 수락 · 되보내기 · 거절 버튼. */
export default function TradeCard({
  t,
  myItems,
  maxCoins,
  busy,
  call,
  countering,
  cCoins,
  cPicked,
  onCCoins,
  onCPicked,
  onCounterOpen,
  onCounterSent,
  onCounterCancel,
}: {
  t: Trade;
  myItems: PlayerState["items"];
  maxCoins: number;
  busy: boolean;
  call: (fn: string, args: Record<string, unknown>) => Promise<boolean>;
  /** 이 거래에 되보내기 작성 칸이 열려 있는지 (한 번에 한 건만 연다) */
  countering: boolean;
  cCoins: number;
  cPicked: Record<string, number>;
  onCCoins: (n: number) => void;
  onCPicked: (p: Record<string, number>) => void;
  onCounterOpen: () => void;
  onCounterSent: () => void;
  onCounterCancel: () => void;
}) {
  const open =
    t.status === "offered" || t.status === "countered";
  // 끝난 건은 끝난 종이다. 바닥보다 더 어두운 면으로 내려
  // 앉히고 글자도 한 단 죽여서, 아직 굴러가는 건과 갈라 놓는다.
  const done = t.status === "done";
  const closed = done || t.status === "cancelled";
  return (
    <li
      key={t.id}
      className={`flex flex-col gap-1.5 border p-3 ${
        closed
          ? "border-line-soft/50 bg-bg-0 text-fg-mid"
          : "border-line-soft bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`body-15 ${closed ? "text-fg-mid" : "text-fg-hi"}`}
        >
          {t.partner}
        </span>
        {t.is_gift && <MonoLabel>선물</MonoLabel>}
        <span
          className={`label-11 ml-auto ${
            t.my_turn ? "text-brass" : "text-fg-low"
          }`}
        >
          {t.my_turn
            ? "내 차례"
            : done
              ? `✓ ${TRADE_STATUS_LABEL[t.status]}`
              : TRADE_STATUS_LABEL[t.status]}
        </span>
      </div>

      <div
        className={`mono-13 flex flex-col gap-0.5 ${
          closed ? "opacity-65" : ""
        }`}
      >
        <p>
          <span className="text-fg-low">줄 것 </span>
          <OfferLine coins={t.my_coins} items={t.my_items} />
        </p>
        <p>
          <span className="text-fg-low">받을 것 </span>
          <OfferLine
            coins={t.their_coins}
            items={t.their_items}
            empty={t.is_gift ? "선물" : "아직 미정"}
          />
        </p>
      </div>

      {open && (
        <MonoLabel tone="low">
          {formatDuration(t.expires_in)} 후 만료
        </MonoLabel>
      )}

      {/* 받은 쪽: 수락(선물) / 되보내기 / 거절 */}
      {t.my_turn && t.status === "offered" && (
        <div className="flex flex-col gap-1.5">
          {t.is_gift ? (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  call("trade_respond", {
                    p_id: t.id,
                    p_action: "accept",
                  })
                }
                className={PRIMARY}
              >
                받기
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  call("trade_respond", {
                    p_id: t.id,
                    p_action: "decline",
                  })
                }
                className={PLAIN}
              >
                거절
              </button>
            </div>
          ) : countering ? (
            <div className="bg-bg-2 flex flex-col gap-2 p-2.5">
              <MonoLabel>내가 내놓을 것</MonoLabel>
              <Picker
                items={myItems}
                coins={cCoins}
                maxCoins={maxCoins}
                picked={cPicked}
                onCoins={onCCoins}
                onPick={onCPicked}
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await call("trade_respond", {
                      p_id: t.id,
                      p_action: "counter",
                      p_coins: cCoins,
                      p_items: toPayload(cPicked),
                    });
                    if (ok) onCounterSent();
                  }}
                  className={`${PRIMARY} flex-1`}
                >
                  보내기
                </button>
                <button
                  type="button"
                  onClick={onCounterCancel}
                  className={PLAIN}
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={onCounterOpen}
                className={PRIMARY}
              >
                조건 붙여 되보내기
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  call("trade_respond", {
                    p_id: t.id,
                    p_action: "decline",
                  })
                }
                className={PLAIN}
              >
                거절
              </button>
            </div>
          )}
        </div>
      )}

      {/* 제안자: 최종 수락 / 거절 */}
      {t.my_turn && t.status === "countered" && (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call("trade_finalize", {
                p_id: t.id,
                p_accept: true,
              })
            }
            className={PRIMARY}
          >
            성사
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call("trade_finalize", {
                p_id: t.id,
                p_accept: false,
              })
            }
            className={PLAIN}
          >
            거절
          </button>
        </div>
      )}

      {open && !t.my_turn && (
        <button
          type="button"
          disabled={busy}
          onClick={() => call("trade_cancel", { p_id: t.id })}
          className={PLAIN}
        >
          거래 물리기
        </button>
      )}
    </li>
  );
}
