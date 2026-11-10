"use client";

import { createPortal } from "react-dom";
import MonoLabel from "../ui/MonoLabel";
import AvatarCropper from "../AvatarCropper";
import { action } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 사진 수정(바꾸기 · 지우기) 팝업과 자르기 팝업. */
export default function AvatarPopups({ m }: { m: RecordModel }) {
  const {
    avatarActionOpen,
    avatarBusy,
    avatarError,
    fileInputRef,
    pendingFile,
    removeAvatar,
    setAvatarActionOpen,
    setAvatarError,
    setPendingFile,
    uploadAvatar,
  } = m;
  return (
    <>
      {/* 사진 수정 선택 팝업 — 바꾸기 / 삭제하기 */}
      {avatarActionOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !avatarBusy && setAvatarActionOpen(false)}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>사진 수정</MonoLabel>
                <button
                  type="button"
                  onClick={() => setAvatarActionOpen(false)}
                  disabled={avatarBusy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                {avatarError && (
                  <p className="mono-13 text-loss">{avatarError}</p>
                )}
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={() => {
                    setAvatarActionOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className={action}
                >
                  사진 바꾸기
                </button>
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={async () => {
                    const ok = await removeAvatar();
                    if (ok) setAvatarActionOpen(false);
                  }}
                  className="label-11 state-fade border-line border bg-surface-hi px-3 py-2.5 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                >
                  사진 삭제하기
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 사진 자르기 팝업 */}
      {pendingFile && (
        <AvatarCropper
          file={pendingFile}
          busy={avatarBusy}
          error={avatarError}
          onCancel={() => {
            if (avatarBusy) return;
            setPendingFile(null);
            setAvatarError(null);
          }}
          onConfirm={uploadAvatar}
        />
      )}

    </>
  );
}
