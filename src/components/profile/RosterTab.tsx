"use client";

import { identityOf } from "@/lib/identity";
import TabRail from "../ui/TabRail";
import MonoLabel from "../ui/MonoLabel";
import { action, approvedRelationsFor, ROSTER_SUBS } from "./shared";
import ProfileCard from "./ProfileCard";
import type { RecordModel } from "./useRecordModel";

/** 친구 탭 — 친구 피드와 플레이어 목록 · 상세. */
export default function RosterTab({ m }: { m: RecordModel }) {
  const {
    catFavorite,
    deleteRelation,
    openRelationEdit,
    picked,
    playerAvatarUrl,
    relBusy,
    relError,
    relations,
    roster,
    rosterSub,
    setConfirm,
    setOpenPlayer,
    setRelDesc,
    setRelError,
    setRelFormOpen,
    setRelLocked,
    setRelPartner,
    setRelRejectedView,
    setRelReplaceId,
    setRosterSub,
    state,
    tab,
  } = m;
  return (
    <>
      {/* ── 친구 ── */}
      {tab === "roster" && (
        <div className="flex flex-col gap-2">
          <TabRail
            items={ROSTER_SUBS}
            value={rosterSub}
            onChange={setRosterSub}
            marker="left"
            columns="grid-cols-2"
            height="h-9"
          />

          {rosterSub === "relations" && (
            <>
          {/* 반려된 친구 신청 — 내 신청 중 반려된 것만, 있을 때만 보인다 */}
          {relations.filter((r) => r.mine && r.status === "rejected").length >
            0 && (
              <section className="bg-bg-1 flex flex-col gap-2 p-4">
                <MonoLabel tone="low">반려된 친구 신청</MonoLabel>
                <ul className="flex flex-col gap-1.5">
                  {relations
                    .filter((r) => r.mine && r.status === "rejected")
                    .map((r) => (
                      <li
                        key={r.id}
                        className="bg-surface flex items-center gap-2 p-3"
                      >
                        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1.5">
                          <MonoLabel tone="low">
                            {identityOf(r.username).no} {r.username}
                          </MonoLabel>
                          {r.partner && (
                            <>
                              <span className="text-fg-low">↔</span>
                              <MonoLabel tone="low">
                                {identityOf(r.partner).no} {r.partner}
                              </MonoLabel>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setRelRejectedView(r)}
                          className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi"
                        >
                          보기
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            )}

          {/* 친구 피드 — 관리자가 승인한 것만, 모두에게 보인다 */}
          <section className="bg-bg-1 flex flex-col gap-2 p-4">
            <MonoLabel tone="low">친구 피드</MonoLabel>

            {relError && <p className="mono-13 text-loss">{relError}</p>}

            {relations.filter((r) => r.status === "approved").length === 0 ? (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-8 text-center">
                아직 등록된 친구가 없습니다
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {relations
                  .filter((r) => r.status === "approved")
                  .map((r) => {
                    const isPartner = !!r.partner && r.partner === state.username;
                    // 작성자·상대는 수정·삭제 모두, 관리자는 삭제만 가능하다.
                    const canEdit = (r.mine || isPartner) && !!r.partner;
                    const canDelete = r.mine || isPartner || state.is_admin;
                    return (
                      <li key={r.id} className="bg-surface flex flex-col gap-1 p-3">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                          <MonoLabel tone="low" className="min-w-0 truncate">
                            {`${identityOf(r.username).no} ${r.username}`}
                          </MonoLabel>
                          {r.partner && (
                            <>
                              <span className="text-fg-low">↔</span>
                              <MonoLabel tone="low" className="min-w-0 truncate">
                                {`${identityOf(r.partner).no} ${r.partner}`}
                              </MonoLabel>
                            </>
                          )}
                        </div>
                        <p className="body-15 text-fg whitespace-pre-wrap break-words">{r.body}</p>
                        {canDelete && (
                          <div className="mt-1 flex justify-end gap-1.5">
                            {canEdit && (
                              <button
                                type="button"
                                disabled={relBusy}
                                onClick={() => openRelationEdit(r)}
                                className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low"
                              >
                                수정
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={relBusy}
                              onClick={() =>
                                setConfirm({
                                  kind: "relation-delete",
                                  id: r.id,
                                  who: r.partner ? `${r.username} ↔ ${r.partner}` : r.username,
                                })
                              }
                              className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}

            {/* 내 신청 중 아직 심사 전인 것 */}
            {relations.filter((r) => r.mine && r.status === "pending").length >
              0 && (
                <div className="flex flex-col gap-1.5">
                  {relations
                    .filter((r) => r.mine && r.status === "pending")
                    .map((r) => (
                      <div
                        key={r.id}
                        className="mono-13 text-fg-mid border-line-soft flex items-center gap-2 border px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {r.partner && `${r.partner} · `}
                          {r.body}
                          <span className="text-fg-low"> · 관리자 승인 대기</span>
                        </span>
                        <button
                          type="button"
                          disabled={relBusy}
                          onClick={() => deleteRelation(r.id)}
                          className="label-11 text-fg-low hover:text-loss disabled:text-fg-low shrink-0"
                        >
                          취소
                        </button>
                      </div>
                    ))}
                </div>
              )}

            <button
              type="button"
              onClick={() => {
                setRelError(null);
                setRelPartner("");
                setRelDesc("");
                setRelLocked(false);
                setRelReplaceId(null);
                setRelFormOpen(true);
              }}
              className={action}
            >
              친구 등록
            </button>
          </section>
            </>
          )}

          {rosterSub === "list" && (
            <>
          {/* 플레이어 목록 — 번호·이름·상태. 이름을 누르면 바로 아래에 그 사람의 프로필이 펼쳐진다. */}
          <section className="bg-bg-1 flex flex-col gap-2 p-4">
            <MonoLabel tone="low">플레이어 {roster.length}명</MonoLabel>
            {roster.length === 0 ? (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
                플레이어 없음
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-3 tab:grid-cols-1">
                {roster.map((p) => {
                  const id = identityOf(p.username);
                  const sameCell =
                    p.cell_id != null &&
                    p.cell_id === state.cell_id &&
                    p.username !== state.username;
                  return (
                    <li
                      key={p.username}
                      className="mono-13 border-line-soft grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-2 border-b py-2 tab:grid-cols-[52px_minmax(0,1fr)] tab:gap-3"
                    >
                      <span className="text-fg-low tabular-nums">{id.no}</span>
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenPlayer((u) =>
                              u === p.username ? null : p.username,
                            )
                          }
                          className="min-w-0 truncate text-left text-fg hover:text-fg-hi"
                        >
                          {p.username}
                        </button>
                        {sameCell && (
                          <span className="label-11 border-line-soft text-fg-low shrink-0 border px-1 py-px">
                            같은 룸
                          </span>
                        )}
                        {p.in_ward && (
                          <span className="label-11 border-loss/40 text-loss shrink-0 border px-1 py-px">
                            휴식
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {picked && (
            <ProfileCard
              no={identityOf(picked.username).no}
              username={picked.username}
              avatarUrl={playerAvatarUrl(picked.avatar_path)}
              cell={picked.cell}
              status_message={picked.status_message}
              age={picked.age}
              heightCm={picked.height_cm}
              weightKg={picked.weight_kg}
              hp={picked.hp}
              hpMax={picked.hp_max}
              bio={picked.bio}
              flex={picked.flex.map((text) => ({ text }))}
              catLoved={catFavorite === picked.username}
              relations={approvedRelationsFor(picked.username, relations)}
            />
          )}
            </>
          )}
        </div>
      )}

    </>
  );
}
