"use client";

import { formatDaysLeft, formatDuration, ITEM_GRADE_LABEL, LEDGER_KIND_LABEL } from "@/lib/game";
import Panel from "../ui/Panel";
import MonoLabel from "../ui/MonoLabel";
import { DANGER, formatShort, ledgerState, SMALL, Stat } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 플레이어 상세 — 상태 · 소지품 · 거래 기록. */
export default function PlayerDetailSection({ m }: { m: AdminModel }) {
  const {
    detail,
    openDetail,
    openLedgerPopup,
    openTakeItem,
    setDetail,
    setSuspendDays,
    setSuspendPopup,
    setSuspendReason,
    setTradeLedgerOpen,
    tradeLedger,
    tradeLedgerOpen,
  } = m;
  return (
    <>
      {/* ── 플레이어 상세 ── */}
      {detail && (
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="title-19 text-fg-hi">{detail.username}</h2>
            <span
              className={`mono-13 ${detail.in_ward ? "text-loss" : "text-fg-mid"}`}
            >
              {detail.hp_status}
            </span>
            <button
              onClick={() => openDetail(detail.username)}
              className={`${SMALL} ml-auto`}
            >
              새로고침
            </button>
            <button
              onClick={() => {
                if (detail.suspended_until) {
                  setSuspendPopup("unsuspend");
                } else {
                  setSuspendDays(7);
                  setSuspendReason("");
                  setSuspendPopup("suspend");
                }
              }}
              className={detail.suspended_until ? DANGER : SMALL}
            >
              {detail.suspended_until ? "정지 해제" : "일시중지"}
            </button>
            <button onClick={() => setDetail(null)} className={SMALL}>
              닫기
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="코인" value={detail.coins} brass />
            <Stat label="에너지" value={`${detail.hp} / ${detail.hp_max}`} />
            <Stat
              label="남은 게임"
              value={`${detail.plays_left} (보너스 ${detail.bonus_plays})`}
            />
            <Stat
              label="휴식"
              value={
                detail.in_ward
                  ? formatDuration(detail.ward_left) + " 남음"
                  : "-"
              }
            />
            <Stat label="빚" value={detail.debt} />
            <Stat label="판돈 2배" value={`${detail.win_double}회`} />
            <Stat label="오늘 사용" value={`${detail.plays_used}판`} />
            <Stat
              label="발급일"
              value={new Date(detail.created_at).toLocaleDateString("ko-KR")}
            />
            <Stat
              label="정지"
              value={
                detail.suspended_until
                  ? formatDaysLeft(
                      Math.max(
                        0,
                        (new Date(detail.suspended_until).getTime() -
                          Date.now()) /
                          1000,
                      ),
                    ) + " 남음"
                  : "-"
              }
            />
          </div>

          {detail.suspended_until && (
            <p className="mono-13 border-loss/40 border bg-bg-0 px-3 py-2 text-loss">
              정지 사유: {detail.suspend_reason || "미기재"}
            </p>
          )}

          <div>
            <MonoLabel tone="low">소지품 {detail.items.length}종</MonoLabel>
            {detail.items.length === 0 ? (
              <p className="mono-13 text-fg-low mt-2">가진 아이템이 없다.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.items.map((it) => (
                  <button
                    key={it.code}
                    type="button"
                    disabled={it.qty === 0}
                    onClick={() => openTakeItem(it)}
                    className="mono-13 bg-surface state-fade flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-hi disabled:opacity-50"
                  >
                    <span>{it.emoji}</span>
                    <span className="text-fg-hi">{it.name}</span>
                    <MonoLabel tone="low">
                      {ITEM_GRADE_LABEL[it.grade]}
                    </MonoLabel>
                    <span className="text-fg-mid tabular-nums">
                      ×{it.qty}
                      {/* 봉인된 갑은 회수 대상이지만, 개봉한 갑에 남은 개비는
                          panel_take_item 이 손대지 않는다 — 그대로 안내만 한다. */}
                      {!!it.open_left && ` (+${it.open_left}개비)`}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="mono-13 text-fg-low mt-1.5">
              소지품을 누르면 회수할 수 있다.
            </p>
          </div>

          <div>
            <MonoLabel tone="low">최근 기록</MonoLabel>
            {detail.ledger.length === 0 ? (
              <p className="mono-13 text-fg-low mt-2">기록이 없다.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {detail.ledger.map((e) => {
                  // 거래 기록은 눌러서 상세를 연다.
                  const trade =
                    e.kind === "trade"
                      ? tradeLedger.find((t) => t.id === e.id)
                      : undefined;
                  return (
                    <li
                      key={e.id}
                      onClick={trade ? () => openLedgerPopup(trade) : undefined}
                      className={`mono-13 border-line-soft grid grid-cols-[46px_minmax(0,1fr)_54px] items-baseline gap-2 border-b py-1.5 ${
                        trade ? "state-fade cursor-pointer hover:bg-surface" : ""
                      }`}
                    >
                      <span className="text-fg-low truncate">
                        {LEDGER_KIND_LABEL[e.kind] ?? e.kind}
                      </span>
                      <span className="text-fg truncate">
                        {e.title}
                      </span>
                      <span
                        className={`text-right tabular-nums ${
                          e.coin_delta < 0 ? "text-loss" : "text-fg-hi"
                        }`}
                      >
                        {e.coin_delta > 0 ? `+${e.coin_delta}` : e.coin_delta}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <MonoLabel tone="low">거래 기록 {tradeLedger.length}건</MonoLabel>
            {tradeLedger.length === 0 ? (
              <p className="mono-13 text-fg-low mt-2">거래한 적이 없다.</p>
            ) : (
              <>
                <ul className="mt-2 flex flex-col">
                  {(tradeLedgerOpen ? tradeLedger : tradeLedger.slice(0, 5)).map(
                    (e) => {
                      const st = ledgerState(e);
                      return (
                        <li
                          key={e.id}
                          onClick={() => openLedgerPopup(e)}
                          className="mono-13 border-line-soft state-fade flex cursor-pointer items-baseline gap-2 border-b py-1.5 hover:bg-surface"
                        >
                          <span className="text-fg-low shrink-0">
                            {formatShort(e.created_at)}
                          </span>
                          <span className="text-fg truncate">{e.title}</span>
                          {e.partner_deleted && (
                            <MonoLabel tone="low">삭제됨</MonoLabel>
                          )}
                          <MonoLabel
                            tone={st.actionable ? "dim" : "low"}
                            className="ml-auto shrink-0"
                          >
                            {st.label}
                          </MonoLabel>
                        </li>
                      );
                    },
                  )}
                </ul>
                {tradeLedger.length > 5 && (
                  <button
                    onClick={() => setTradeLedgerOpen((v) => !v)}
                    className={`${SMALL} mt-1.5`}
                  >
                    {tradeLedgerOpen
                      ? "접기"
                      : `나머지 ${tradeLedger.length - 5}건 더 보기`}
                  </button>
                )}
              </>
            )}
            <p className="mono-13 text-fg-low mt-1.5">
              거래를 누르면 내용을 보고 회수할 수 있다. 상대가 삭제된
              거래는 이 사람이 받은 것만 거둔다.
            </p>
          </div>
        </Panel>
      )}

    </>
  );
}
