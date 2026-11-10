"use client";

import { TRADE_STATUS_LABEL } from "@/lib/game";
import Panel from "../ui/Panel";
import MonoLabel from "../ui/MonoLabel";
import { DANGER, Offer, PLAIN, ReasonPicker, SMALL } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 유저 간 거래 내역과 거래 취소(압수). */
export default function TradeSection({ m }: { m: AdminModel }) {
  const {
    busy,
    confirmRevertTrade,
    loadTrades,
    openRevert,
    revertId,
    revertNote,
    revertReason,
    setRevertId,
    setRevertNote,
    setRevertReason,
    setTradesListOpen,
    trades,
    tradesListOpen,
  } = m;
  return (
    <>
      {/* ── 거래 내역 ── */}
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="title-19 text-fg-hi">
            유저 간 거래 {trades.length}건
          </h2>
          <button onClick={loadTrades} className={`${SMALL} ml-auto`}>
            새로고침
          </button>
        </div>

        {trades.length === 0 ? (
          <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
            아직 거래가 없다.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {(tradesListOpen ? trades : trades.slice(0, 5)).map((t) => (
                <li
                  key={t.id}
                  className="bg-surface flex flex-col gap-1.5 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="body-15 text-fg-hi">{t.from}</span>
                    {t.from_deleted && <MonoLabel tone="low">삭제됨</MonoLabel>}
                    <span className="text-fg-low">→</span>
                    <span className="body-15 text-fg-hi">{t.to}</span>
                    {t.to_deleted && <MonoLabel tone="low">삭제됨</MonoLabel>}
                    {t.is_gift && <MonoLabel>선물</MonoLabel>}
                    <MonoLabel tone="low" className="ml-auto">
                      {TRADE_STATUS_LABEL[t.status]}
                    </MonoLabel>
                    <MonoLabel tone="low">
                      {new Date(t.created_at).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </MonoLabel>
                  </div>
                  <div className="mono-13 flex flex-col gap-0.5">
                    <p>
                      <span className="text-fg-low">보냄 </span>
                      <Offer coins={t.from_coins} items={t.from_items} />
                    </p>
                    <p>
                      <span className="text-fg-low">받음 </span>
                      <Offer coins={t.to_coins} items={t.to_items} />
                    </p>
                    {t.reverted_detail && (
                      <>
                        <p>
                          <span className="text-loss">회수 </span>
                          <span className="text-fg-low">{t.from} </span>
                          <Offer
                            coins={t.reverted_detail.from_coins}
                            items={t.reverted_detail.from_items}
                          />
                        </p>
                        <p>
                          <span className="text-loss">회수 </span>
                          <span className="text-fg-low">{t.to} </span>
                          <Offer
                            coins={t.reverted_detail.to_coins}
                            items={t.reverted_detail.to_items}
                          />
                        </p>
                      </>
                    )}
                  </div>

                  {t.status === "done" && revertId !== t.id && (
                    <button
                      onClick={() => openRevert(t.id)}
                      disabled={busy}
                      className={`${SMALL} self-end`}
                    >
                      거래 취소
                    </button>
                  )}

                  {t.status === "done" && revertId === t.id && (
                    <div className="border-loss/60 flex flex-col gap-2 border border-dashed p-3">
                      <p className="body-15 text-fg">
                        양쪽이 이 거래로 받은 것을 각자에게서 압수한다.
                        돌려주지 않으며, 이미 쓴 몫은 건너뛰고 지금 가진
                        만큼만(코인은 잔액까지, 장착 중이면 해제 후) 거둔다.
                        되돌릴 수 없다.
                      </p>
                      {(t.from_deleted || t.to_deleted) && (
                        <p className="mono-13 text-fg-mid">
                          삭제된 사람(
                          {[t.from_deleted && t.from, t.to_deleted && t.to]
                            .filter(Boolean)
                            .join(", ")}
                          ) 몫은 거둘 것이 없어 건너뛴다.
                        </p>
                      )}
                      <ReasonPicker
                        category={revertReason}
                        note={revertNote}
                        onCategory={setRevertReason}
                        onNote={setRevertNote}
                        disabled={busy}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => setRevertId(null)}
                          disabled={busy}
                          className={PLAIN}
                        >
                          닫기
                        </button>
                        <button
                          onClick={confirmRevertTrade}
                          disabled={busy}
                          className={DANGER}
                        >
                          취소 확정
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {trades.length > 5 && (
              <button
                onClick={() => setTradesListOpen((v) => !v)}
                className={SMALL}
              >
                {tradesListOpen
                  ? "접기"
                  : `나머지 ${trades.length - 5}건 더 보기`}
              </button>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
