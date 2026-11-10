"use client";

import MonoLabel from "../ui/MonoLabel";
import { DANGER, FIELD, ledgerState, Offer, PLAIN, Presets, PRIMARY, ReasonPicker } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 상세에서 여는 팝업 — 거래 기록 회수 · 소지품 회수 · 정지/해제. */
export default function DetailPopups({ m }: { m: AdminModel }) {
  const {
    busy,
    confirmLedgerConfiscate,
    confirmLedgerRevert,
    confirmSuspend,
    confirmTakeItem,
    confirmUnsuspend,
    detail,
    error,
    ledgerNote,
    ledgerPopup,
    ledgerReason,
    setLedgerNote,
    setLedgerPopup,
    setLedgerReason,
    setSuspendDays,
    setSuspendPopup,
    setSuspendReason,
    setTakeNote,
    setTakeQty,
    setTakeReason,
    setTakeTarget,
    suspendDays,
    suspendPopup,
    suspendReason,
    takeNote,
    takeQty,
    takeReason,
    takeTarget,
  } = m;
  return (
    <>
      {/* ── 거래 기록 상세 팝업 ── */}
      {detail && ledgerPopup && (() => {
        const e = ledgerPopup;
        const st = ledgerState(e);
        return (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setLedgerPopup(null)}
          >
            <div
              className="border-line max-h-[90dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>거래 기록</MonoLabel>
                <button
                  type="button"
                  onClick={() => setLedgerPopup(null)}
                  disabled={busy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="body-15 text-fg-hi">{detail.username}</span>
                  <span className="text-fg-low">↔</span>
                  <span className="body-15 text-fg-hi">{e.partner}</span>
                  {e.partner_deleted && <MonoLabel tone="low">삭제됨</MonoLabel>}
                  <MonoLabel tone="low" className="ml-auto">
                    {new Date(e.created_at).toLocaleString("ko-KR")}
                  </MonoLabel>
                </div>
                <p className="body-15 text-fg">{e.title}</p>
                <div className="mono-13 bg-surface flex flex-col gap-0.5 p-3">
                  <p>
                    <span className="text-fg-low">준 것 </span>
                    <Offer coins={e.gave_coins} items={e.gave_items} />
                  </p>
                  <p>
                    <span className="text-fg-low">받은 것 </span>
                    <Offer coins={e.got_coins} items={e.got_items} />
                  </p>
                  {e.confiscated && (
                    <p>
                      <span className="text-loss">회수 </span>
                      <Offer
                        coins={e.confiscated.coins}
                        items={e.confiscated.items}
                      />
                    </p>
                  )}
                </div>
                <p className="mono-13 text-fg-mid">
                  상태: {st.label}
                  {e.trade && ` · 거래 #${e.trade.id}`}
                </p>
                {e.maybe_reverted && !e.trade && !e.confiscated && (
                  <p className="mono-13 border-loss/40 border bg-bg-0 px-3 py-2 text-loss">
                    이 기록 뒤에 같은 상대와의 &quot;거래 취소 — 회수&quot;
                    기록이 있다. 이미 처리된 거래일 수 있으니 확인하고 진행하세요.
                  </p>
                )}

                {st.kind === "revert" && (
                  <p className="body-15 text-fg">
                    거래 목록에 남아 있는 거래라 양쪽이 받은 것을 각자에게서
                    압수한다
                    {(e.trade?.from_deleted || e.trade?.to_deleted) &&
                      " (삭제된 사람 몫은 건너뛴다)"}
                    . 되돌릴 수 없다.
                  </p>
                )}
                {st.kind === "confiscate" && (
                  <p className="body-15 text-fg">
                    {detail.username} 이(가) 이 거래로 받은 것을 거둔다.
                    이미 쓴 몫은 건너뛰고 지금 가진 만큼만(코인은 잔액까지,
                    장착 중이면 해제 후) 거둔다. 되돌릴 수 없다.
                  </p>
                )}

                {st.actionable && (
                  <>
                    <ReasonPicker
                      category={ledgerReason}
                      note={ledgerNote}
                      onCategory={setLedgerReason}
                      onNote={setLedgerNote}
                      disabled={busy}
                    />
                    {error && <p className="mono-13 text-loss">{error}</p>}
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        onClick={
                          st.kind === "revert"
                            ? confirmLedgerRevert
                            : confirmLedgerConfiscate
                        }
                        className={`${DANGER} flex-1`}
                      >
                        {st.kind === "revert" ? "거래 취소(양쪽)" : "받은 것 회수"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setLedgerPopup(null)}
                        className={`${PLAIN} flex-1`}
                      >
                        취소
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 소지품 회수 팝업 ── */}
      {detail && takeTarget && (
        <div
          className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setTakeTarget(null)}
        >
          <div
            className="border-line w-full max-w-md border bg-bg-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
              <MonoLabel>소지품 회수</MonoLabel>
              <button
                type="button"
                onClick={() => setTakeTarget(null)}
                disabled={busy}
                className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
              >
                닫기
              </button>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <div className="flex items-baseline gap-2">
                <span>{takeTarget.emoji}</span>
                <span className="body-15 text-fg-hi">{takeTarget.name}</span>
                <MonoLabel tone="low" className="ml-auto">
                  보유 {takeTarget.held}개
                </MonoLabel>
              </div>
              <input
                type="number"
                min={1}
                max={takeTarget.held}
                value={takeQty}
                onChange={(e) =>
                  setTakeQty(
                    Math.max(
                      1,
                      Math.min(takeTarget.held, Number(e.target.value)),
                    ),
                  )
                }
                className={FIELD}
              />
              <ReasonPicker
                category={takeReason}
                note={takeNote}
                onCategory={setTakeReason}
                onNote={setTakeNote}
                disabled={busy}
                placeholder="회수 사유 — 예: 부정 수급 조사"
              />
              {error && <p className="mono-13 text-loss">{error}</p>}
              <div className="flex gap-2">
                <button
                  disabled={
                    busy || takeQty < 1 || takeQty > takeTarget.held
                  }
                  onClick={confirmTakeItem}
                  className={`${DANGER} flex-1`}
                >
                  회수
                </button>
                <button
                  disabled={busy}
                  onClick={() => setTakeTarget(null)}
                  className={`${PLAIN} flex-1`}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 정지 / 정지 해제 팝업 ── */}
      {detail && suspendPopup === "suspend" && (
        <div
          className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setSuspendPopup(null)}
        >
          <div
            className="border-line w-full max-w-sm border bg-bg-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
              <MonoLabel>{detail.username} 일시중지</MonoLabel>
              <button
                type="button"
                onClick={() => setSuspendPopup(null)}
                disabled={busy}
                className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
              >
                닫기
              </button>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <MonoLabel tone="low">정지 일수</MonoLabel>
              <input
                type="number"
                min={1}
                max={365}
                value={suspendDays}
                onChange={(e) =>
                  setSuspendDays(
                    Math.max(1, Math.min(365, Number(e.target.value))),
                  )
                }
                className={FIELD}
              />
              <Presets
                values={[1, 3, 7, 14, 30]}
                value={suspendDays}
                onPick={setSuspendDays}
              />
              <input
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                maxLength={200}
                placeholder="정지 사유 (예: 부정 수급 조사)"
                className={FIELD}
              />
              {error && <p className="mono-13 text-loss">{error}</p>}
              <div className="flex gap-2">
                <button
                  disabled={busy || suspendDays < 1 || suspendDays > 365}
                  onClick={confirmSuspend}
                  className={`${DANGER} flex-1`}
                >
                  정지
                </button>
                <button
                  disabled={busy}
                  onClick={() => setSuspendPopup(null)}
                  className={`${PLAIN} flex-1`}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {detail && suspendPopup === "unsuspend" && (
        <div
          className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setSuspendPopup(null)}
        >
          <div
            className="border-line w-full max-w-xs border bg-bg-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
              <MonoLabel>정지 해제 확인</MonoLabel>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <p className="body-15 text-fg">
                {detail.username} 의 정지를 지금 해제한다. 정말 해제할까요?
              </p>
              {error && <p className="mono-13 text-loss">{error}</p>}
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={confirmUnsuspend}
                  className={`${PRIMARY} flex-1`}
                >
                  해제 확정
                </button>
                <button
                  disabled={busy}
                  onClick={() => setSuspendPopup(null)}
                  className={`${PLAIN} flex-1`}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
