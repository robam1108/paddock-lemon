"use client";

import { formatDaysLeft, type PlayerState } from "@/lib/game";
import MonoLabel from "./ui/MonoLabel";

/**
 * 관리자가 계정을 정지시켰을 때 뜨는 통보.
 *
 * 서버가 이미 게임·거래·상점·대전을 전부 막고 있으므로 이 창은 자물쇠가
 * 아니라 통보다 — 닫을 수 있다. 진정함만은 열려 있어 이의를 제기할 수 있다.
 */
export default function SuspendPopup({
  state,
  onOpenPetitions,
  onClose,
}: {
  state: PlayerState;
  onOpenPetitions: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg-0/80 p-4 tab:items-center">
      <div className="border-line w-full max-w-sm border bg-bg-1">
        <div className="border-line-soft border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">수감 정지 통보</MonoLabel>
        </div>

        <div className="flex flex-col gap-1 p-4">
          <p className="title-19 text-loss">수감 정지 중이다.</p>
          <p className="body-15 text-fg-mid">
            해제까지 {formatDaysLeft(state.suspended_left)} 남았다. 그동안
            게임·거래·상점·대전을 할 수 없다.
          </p>

          <div className="mt-3 border-line-soft flex flex-col gap-1 border bg-bg-2 px-3 py-3">
            <MonoLabel tone="low">사유</MonoLabel>
            <p className="body-15 text-fg">
              {state.suspend_reason || "미기재"}
            </p>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenPetitions();
                onClose();
              }}
              className="label-11 border-brass-line state-fade shrink-0 border bg-brass-fill px-4 py-3 text-fg-hi"
            >
              진정함으로 이의 제기
            </button>
            <button
              type="button"
              onClick={onClose}
              className="label-11 border-line state-fade shrink-0 border bg-surface px-4 py-3 text-fg-mid hover:text-fg-hi"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
