"use client";

import Panel from "../ui/Panel";
import MonoLabel from "../ui/MonoLabel";
import PetitionPhoto from "../ui/PetitionPhoto";
import { PhotoAttachControl } from "../ui/PhotoAttach";
import { DANGER, FIELD, formatShort, PETITION_STATUS_LABEL, PLAIN, PRIMARY, SMALL } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 피드백 목록 · 스레드 · 답장과 삭제 확인 팝업. */
export default function PetitionSection({ m }: { m: AdminModel }) {
  const {
    allClosedSelected,
    busy,
    closePetition,
    closedPetitionIds,
    deletePetition,
    deletePetitions,
    error,
    loadPetitions,
    openPetitionThread,
    petitionBulkConfirm,
    petitionDeleteTarget,
    petitionReply,
    petitionReplyPhoto,
    petitionSelectMode,
    petitionSelected,
    petitionThread,
    petitions,
    petitionsListOpen,
    sendPetitionReply,
    setPetitionBulkConfirm,
    setPetitionDeleteTarget,
    setPetitionReply,
    setPetitionSelected,
    setPetitionThread,
    setPetitionsListOpen,
    supabase,
    togglePetitionSelectMode,
    togglePetitionSelected,
  } = m;
  return (
    <>
      {/* ── 피드백 ── */}
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="title-19 text-fg-hi">
            피드백{" "}
            {petitions.filter((p) => p.status === "open").length}건 미답변
          </h2>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {petitionSelectMode && petitionSelected.size > 0 && (
              <button
                disabled={busy}
                onClick={() => setPetitionBulkConfirm(true)}
                className={`${SMALL} text-loss`}
              >
                {petitionSelected.size}건 삭제
              </button>
            )}
            {petitionSelectMode && (
              <button
                disabled={closedPetitionIds.length === 0}
                onClick={() =>
                  setPetitionSelected(
                    allClosedSelected ? new Set() : new Set(closedPetitionIds),
                  )
                }
                className={SMALL}
              >
                {allClosedSelected ? "선택해제" : "전체선택"}
              </button>
            )}
            <button
              disabled={busy || petitions.length === 0}
              onClick={togglePetitionSelectMode}
              className={SMALL}
            >
              {petitionSelectMode ? "취소" : "선택삭제"}
            </button>
            <button onClick={loadPetitions} className={SMALL}>
              새로고침
            </button>
          </div>
        </div>
        {petitionSelectMode && (
          <p className="mono-13 text-fg-low">
            종료된 피드백만 선택할 수 있다.
          </p>
        )}

        {petitions.length === 0 ? (
          <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
            접수된 피드백이 없다.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {(petitionsListOpen ? petitions : petitions.slice(0, 3)).map(
                (p) => (
                  <li key={p.id} className="flex flex-col gap-1">
                    <button
                      disabled={petitionSelectMode && p.status !== "closed"}
                      onClick={() =>
                        petitionSelectMode
                          ? togglePetitionSelected(p.id)
                          : openPetitionThread(p.id)
                      }
                      className={`bg-surface state-fade flex w-full items-center gap-3 p-3 text-left hover:bg-surface-hi ${
                        petitionSelectMode && p.status !== "closed"
                          ? "cursor-not-allowed opacity-50"
                          : ""
                      }`}
                    >
                      {petitionSelectMode && p.status === "closed" && (
                        <input
                          type="checkbox"
                          readOnly
                          tabIndex={-1}
                          checked={petitionSelected.has(p.id)}
                          className="accent-brass pointer-events-none h-4 w-4 shrink-0"
                        />
                      )}
                      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
                        <span className="body-15 text-fg-hi">
                          {p.username}
                        </span>
                        <span className="text-fg-low">·</span>
                        <span
                          className={`body-15 ${p.status === "closed" ? "text-fg-low" : "text-fg"}`}
                        >
                          {p.subject}
                        </span>
                        <MonoLabel
                          tone={
                            p.status === "open"
                              ? "dim"
                              : p.status === "answered"
                                ? "mid"
                                : "low"
                          }
                        >
                          {PETITION_STATUS_LABEL[p.status]}
                        </MonoLabel>
                        <MonoLabel tone="low" className="ml-auto">
                          {formatShort(p.last_message_at)}
                        </MonoLabel>
                      </div>
                    </button>
                  </li>
                ),
              )}
            </ul>
            {petitions.length > 3 && (
              <button
                onClick={() => setPetitionsListOpen((v) => !v)}
                className={SMALL}
              >
                {petitionsListOpen
                  ? "접기"
                  : `나머지 ${petitions.length - 3}건 더 보기`}
              </button>
            )}
          </>
        )}

        {petitionThread && (
          <div className="border-line border bg-bg-0 p-3">
            <div className="mb-2 flex items-center gap-2">
              <h3
                className={`title-19 truncate ${petitionThread.status === "closed" ? "text-fg-low" : "text-fg-hi"}`}
              >
                {petitionThread.subject}
              </h3>
              <MonoLabel
                tone={
                  petitionThread.status === "open"
                    ? "dim"
                    : petitionThread.status === "answered"
                      ? "mid"
                      : "low"
                }
              >
                {PETITION_STATUS_LABEL[petitionThread.status]}
              </MonoLabel>
              {petitionThread.status !== "closed" && (
                <button
                  disabled={busy}
                  onClick={() => closePetition(petitionThread.id)}
                  className={`${SMALL} text-loss`}
                >
                  종결
                </button>
              )}
              <button
                onClick={() => setPetitionThread(null)}
                className={SMALL}
              >
                닫기
              </button>
              {petitionThread.status === "closed" && (
                <button
                  disabled={busy}
                  onClick={() => setPetitionDeleteTarget(petitionThread)}
                  className={`${SMALL} text-loss`}
                >
                  삭제
                </button>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {petitionThread.messages.map((m) => (
                <li
                  key={m.id}
                  className={`p-3 ${
                    m.is_admin_reply
                      ? "border-brass-line border bg-brass-fill"
                      : "bg-surface"
                  }`}
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span
                      className={`label-11 ${
                        m.is_admin_reply ? "text-brass" : "text-fg-mid"
                      }`}
                    >
                      {m.author}
                    </span>
                    <MonoLabel tone="low" className="ml-auto">
                      {formatShort(m.created_at)}
                    </MonoLabel>
                  </div>
                  <p className="body-15 text-fg whitespace-pre-wrap">
                    {m.body}
                  </p>
                  {m.image_path && (
                    <PetitionPhoto supabase={supabase} path={m.image_path} />
                  )}
                </li>
              ))}
            </ul>

            {petitionThread.status === "closed" ? (
              <p className="mono-13 text-fg-low mt-2 text-center">
                종료된 피드백이라 답변을 더 달 수 없다.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <textarea
                  value={petitionReply}
                  onChange={(e) => setPetitionReply(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="답변을 적어 주세요. 작성자에게는 '관리자'로만 표시됩니다."
                  className={`${FIELD} min-h-20 resize-none`}
                />
                <div className="flex items-end justify-end gap-2">
                  <PhotoAttachControl attach={petitionReplyPhoto} disabled={busy} />
                  <button
                    disabled={busy || !petitionReply.trim()}
                    onClick={sendPetitionReply}
                    className={PRIMARY}
                  >
                    답변 등록
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ── 피드백 삭제 확인 팝업 ── */}
      {petitionDeleteTarget && (
        <div
          className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setPetitionDeleteTarget(null)}
        >
          <div
            className="border-line w-full max-w-xs border bg-bg-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
              <MonoLabel>삭제 확인</MonoLabel>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <p className="body-15 text-fg">
                {petitionDeleteTarget.username} 의 &quot;
                {petitionDeleteTarget.subject}&quot; 을(를) 삭제한다.
                되돌릴 수 없다.
              </p>
              {error && <p className="mono-13 text-loss">{error}</p>}
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => deletePetition(petitionDeleteTarget.id)}
                  className={`${DANGER} flex-1`}
                >
                  삭제 확정
                </button>
                <button
                  disabled={busy}
                  onClick={() => setPetitionDeleteTarget(null)}
                  className={`${PLAIN} flex-1`}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 피드백 일괄 삭제 확인 팝업 ── */}
      {petitionBulkConfirm && (
        <div
          className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setPetitionBulkConfirm(false)}
        >
          <div
            className="border-line w-full max-w-xs border bg-bg-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
              <MonoLabel>삭제 확인</MonoLabel>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <p className="body-15 text-fg">
                종료된 피드백 {petitionSelected.size}건을 삭제한다. 되돌릴 수
                없다.
              </p>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() =>
                    // 새로고침으로 사라진 건은 빼고 보낸다.
                    deletePetitions(
                      closedPetitionIds.filter((id) =>
                        petitionSelected.has(id),
                      ),
                    )
                  }
                  className={`${DANGER} flex-1`}
                >
                  {busy ? "삭제 중…" : "삭제 확정"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setPetitionBulkConfirm(false)}
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
