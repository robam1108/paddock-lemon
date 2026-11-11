"use client";

import { createPortal } from "react-dom";
import MonoLabel from "../ui/MonoLabel";
import { action } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 친구 등록 · 수정 신청 팝업과 반려된 신청 상세 팝업. */
export default function RelationPopups({ m }: { m: RecordModel }) {
  const {
    openRelationEdit,
    relBusy,
    relDesc,
    relError,
    relFormOpen,
    relLocked,
    relPartner,
    relRejectedView,
    relatedPartners,
    roster,
    setConfirm,
    setRelDesc,
    setRelFormOpen,
    setRelPartner,
    setRelRejectedView,
    state,
    submitRelation,
  } = m;
  return (
    <>
      {/* 친구 등록 팝업 — body 로 포탈. 상위에 filter/transform 이 걸려도
          뷰포트 기준으로 뜨게 해서 모바일에서 화면 밖으로 새지 않는다. */}
      {relFormOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => setRelFormOpen(false)}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>{relLocked ? "수정 신청" : "친구 등록"}</MonoLabel>
                <button
                  type="button"
                  onClick={() => setRelFormOpen(false)}
                  className="label-11 text-fg-mid hover:text-fg-hi"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                {!relLocked && (
                  <p className="body-15 text-fg-mid">
                    상대를 고르고 어떤 사이인지 적어 주세요. 관리자가 확인하면 친구 피드에 올라갑니다.
                  </p>
                )}

                <MonoLabel tone="low">상대</MonoLabel>
                {relLocked ? (
                  <p className="mono-13 border-line-soft bg-surface text-fg-hi border px-3 py-2.5">
                    {relPartner}
                  </p>
                ) : (
                  <select
                    value={relPartner}
                    onChange={(e) => setRelPartner(e.target.value)}
                    className="mono-13 border-line bg-surface text-fg-hi focus:border-brass-line w-full border px-3 py-2.5 outline-none"
                  >
                    <option value="">상대 선택…</option>
                    {roster
                      .filter(
                        (r) =>
                          r.username !== state.username &&
                          !relatedPartners.has(r.username),
                      )
                      .map((r) => (
                        <option key={r.username} value={r.username}>
                          {r.username}
                        </option>
                      ))}
                  </select>
                )}

                <MonoLabel tone="low">관계</MonoLabel>
                <textarea
                  value={relDesc}
                  onChange={(e) => setRelDesc(e.target.value)}
                  rows={5}
                  placeholder="예: 형제 / 함께 들어온 사이 / 앙숙"
                  className="mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line min-h-32 w-full resize-none border px-3 py-2.5 outline-none"
                />

                {relError && <p className="mono-13 text-loss">{relError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={relBusy || !relPartner || relDesc.trim().length < 1}
                    onClick={submitRelation}
                    className="label-11 state-fade flex-1 border border-brass-line bg-brass-fill px-3 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                  >
                    신청
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelFormOpen(false)}
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

      {/* 반려된 관계신청 상세 팝업 — 사유를 보여주고 수정·삭제를 연다 */}
      {relRejectedView &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => setRelRejectedView(null)}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>반려된 관계신청</MonoLabel>
                <button
                  type="button"
                  onClick={() => setRelRejectedView(null)}
                  className="label-11 text-fg-mid hover:text-fg-hi"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                  <MonoLabel tone="low" className="min-w-0 truncate">
                    {relRejectedView.username}
                  </MonoLabel>
                  {relRejectedView.partner && (
                    <>
                      <span className="text-fg-low">↔</span>
                      <MonoLabel tone="low" className="min-w-0 truncate">
                        {relRejectedView.partner}
                      </MonoLabel>
                    </>
                  )}
                </div>
                <p className="body-15 text-fg whitespace-pre-wrap break-words">{relRejectedView.body}</p>

                <MonoLabel tone="low">반려 사유</MonoLabel>
                <p className="body-15 text-fg-mid border-line-soft bg-surface border px-3 py-2.5">
                  {relRejectedView.reject_reason || "사유 없음"}
                </p>

                {relError && <p className="mono-13 text-loss">{relError}</p>}
                <div className="mt-1 flex justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={relBusy}
                    onClick={() => {
                      const target = relRejectedView;
                      setRelRejectedView(null);
                      openRelationEdit(target, true);
                    }}
                    className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={relBusy}
                    onClick={() =>
                      setConfirm({
                        kind: "relation-delete",
                        id: relRejectedView.id,
                        who: relRejectedView.partner
                          ? `${relRejectedView.username} ↔ ${relRejectedView.partner}`
                          : relRejectedView.username,
                      })
                    }
                    className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                  >
                    삭제
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
