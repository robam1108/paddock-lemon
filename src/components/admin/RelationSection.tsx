"use client";

import Panel from "../ui/Panel";
import MonoLabel from "../ui/MonoLabel";
import { FIELD, PLAIN, PRIMARY, RELATION_STATUS_LABEL, SMALL } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 친구 신청 심사와 반려 사유 팝업. */
export default function RelationSection({ m }: { m: AdminModel }) {
  const {
    approveRelation,
    busy,
    confirmReject,
    deleteRelation,
    error,
    loadRelations,
    rejectReason,
    rejectTarget,
    relations,
    setRejectReason,
    setRejectTarget,
  } = m;
  return (
    <>
      {/* ── 관계 심사 ── */}
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="title-19 text-fg-hi">
            관계 신청 {relations.filter((r) => r.status === "pending").length}건
            대기
          </h2>
          <button onClick={loadRelations} className={`${SMALL} ml-auto`}>
            새로고침
          </button>
        </div>

        {relations.filter((r) => r.status === "pending").length === 0 ? (
          <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
            대기 중인 신청이 없다.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {relations
              .filter((r) => r.status === "pending")
              .map((r) => (
              <li key={r.id} className="bg-surface flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="body-15 text-fg-hi">{r.username}</span>
                  {r.partner && (
                    <>
                      <span className="text-fg-low">↔</span>
                      <span className="body-15 text-fg-hi">{r.partner}</span>
                    </>
                  )}
                  <MonoLabel
                    tone={r.status === "pending" ? "dim" : "low"}
                  >
                    {RELATION_STATUS_LABEL[r.status] ?? r.status}
                  </MonoLabel>
                  <MonoLabel tone="low" className="ml-auto">
                    {new Date(r.created_at).toLocaleString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </MonoLabel>
                </div>
                <p className="body-15 text-fg whitespace-pre-wrap break-words">{r.body}</p>
                {r.status === "rejected" && r.reject_reason && (
                  <p className="mono-13 text-fg-mid border-line-soft bg-bg-1 border px-3 py-2">
                    반려 사유: {r.reject_reason}
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  {r.status === "pending" && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        disabled={busy}
                        onClick={() => approveRelation(r.id)}
                        className={PRIMARY}
                      >
                        수락
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setRejectTarget(r);
                          setRejectReason("");
                        }}
                        className={PLAIN}
                      >
                        반려
                      </button>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      disabled={busy}
                      onClick={() => deleteRelation(r.id)}
                      className={`${SMALL} text-loss`}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── 반려 사유 입력 팝업 ── */}
      {rejectTarget && (
        <div
          className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setRejectTarget(null)}
        >
          <div
            className="border-line w-full max-w-md border bg-bg-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
              <MonoLabel>반려 사유</MonoLabel>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                disabled={busy}
                className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
              >
                닫기
              </button>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="body-15 text-fg-hi">
                  {rejectTarget.username}
                </span>
                {rejectTarget.partner && (
                  <>
                    <span className="text-fg-low">↔</span>
                    <span className="body-15 text-fg-hi">
                      {rejectTarget.partner}
                    </span>
                  </>
                )}
              </div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={300}
                rows={4}
                placeholder="반려 사유를 적어 주세요. 신청자에게 그대로 보입니다."
                className={`${FIELD} min-h-24 resize-none`}
              />
              {error && <p className="mono-13 text-loss">{error}</p>}
              <div className="flex gap-2">
                <button
                  disabled={busy || rejectReason.trim().length === 0}
                  onClick={confirmReject}
                  className={`${PRIMARY} flex-1`}
                >
                  반려 확정
                </button>
                <button
                  disabled={busy}
                  onClick={() => setRejectTarget(null)}
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
