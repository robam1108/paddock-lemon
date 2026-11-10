"use client";

import { formatDuration } from "@/lib/game";
import { recordNotes } from "@/lib/copy";
import Panel from "../ui/Panel";
import MonoLabel from "../ui/MonoLabel";
import ProfileCard from "./ProfileCard";
import { approvedRelationsFor, smallAction } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 내 정보 탭 — 프로필 카드와 상태 표. */
export default function ProfileTab({ m }: { m: RecordModel }) {
  const {
    avatarBusy,
    avatarUrl,
    catFavorite,
    clearLongPress,
    fileInputRef,
    flexStatus,
    isMobile,
    me,
    onAvatarFileSelected,
    onPhotoClick,
    onPhotoPointerDown,
    openDetailsForm,
    relations,
    state,
    tab,
  } = m;
  return (
    <>
      {/* ── 내 정보 ──
          좌측은 프로필 카드, 우측은 헤더에 없는 항목만 남긴 표다.
          에너지 · 보유 코인 · 남은 판은 헤더가 담당하므로 여기서 다시 적지 않는다. */}
      {tab === "profile" && (
        <div className="flex flex-col gap-2">
          <ProfileCard
            catLoved={catFavorite === state.username}
            no={me.no}
            username={state.username}
            avatarUrl={avatarUrl}
            cell={state.cell}
            status_message={state.status_message}
            age={state.age}
            heightCm={state.height_cm}
            weightKg={state.weight_kg}
            hp={state.hp}
            hpMax={state.hp_max}
            bio={state.bio}
            flex={[
              ...flexStatus.map((f) =>
                f.expires_at !== null
                  ? {
                    text: f.text,
                    time: `${formatDuration(
                      Math.max(
                        0,
                        (new Date(f.expires_at).getTime() - Date.now()) / 1000,
                      ),
                    )} 남음`,
                  }
                  : { text: f.text },
              ),
            ]}
            relations={approvedRelationsFor(state.username, relations)}
            notes={recordNotes(state)}
            footer={
              <button type="button" onClick={openDetailsForm} className={smallAction}>
                수정
              </button>
            }
            photo={
              <>
                {/* 사진은 본인이 직접 올린다.
                    사진이 있으면 "수정"이 바꾸기/삭제하기 선택 팝업을 열고,
                    없으면 바로 파일을 고르게 한다. */}
                <button
                  type="button"
                  onClick={onPhotoClick}
                  onPointerDown={onPhotoPointerDown}
                  onPointerUp={clearLongPress}
                  onPointerLeave={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onContextMenu={(e) => {
                    if (isMobile && avatarUrl) e.preventDefault();
                  }}
                  disabled={avatarBusy}
                  style={
                    isMobile && avatarUrl
                      ? { WebkitTouchCallout: "none" }
                      : undefined
                  }
                  className="scanline-faint border-line group relative mx-auto flex h-[152px] w-[132px] select-none items-center justify-center overflow-hidden border border-dashed bg-bg-0 disabled:opacity-70"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="mono-13 text-fg-low">사진 없음</span>
                  )}
                  {/* 사진 없음 → 항상 보임. 사진 있음 · PC → 호버에만. 사진 있음 · 모바일 → 아예 안 그린다(길게 누르기로 대체). */}
                  {(!avatarUrl || !isMobile) && (
                    <span
                      className={`label-11 bg-bg-0/85 text-fg-hi absolute inset-x-0 bottom-0 py-1 ${avatarUrl
                        ? "opacity-0 transition-opacity group-hover:opacity-100"
                        : ""
                        }`}
                    >
                      수정
                    </span>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onAvatarFileSelected}
                />
              </>
            }
          />

          <Panel className="flex-1">
            <MonoLabel tone="low">에너지 안내</MonoLabel>
            <ul className="mt-2 flex flex-col gap-1">
              {[
                "에너지는 2시간마다 3, 1판마다 1씩 줄어듭니다.",
                "도시락은 08:00 · 12:00 · 19:00에 지급됩니다.",
                "회복 아이템은 소지품에서 직접 사용해야 반영됩니다.",
                "에너지가 0이 되면 휴식 쿨다운이 시작됩니다. 휴식 중에는 게임·미션·탐험을 할 수 없습니다.",
                "휴식이 끝나면 에너지 80으로 돌아옵니다.",
                "휴식 중에는 도시락이 지급되지 않습니다.",
              ].map((line, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[26px_minmax(0,1fr)] gap-2"
                >
                  <span className="mono-13 text-fg-low tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="body-15 text-fg-mid">{line}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

    </>
  );
}
