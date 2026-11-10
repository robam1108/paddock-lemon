"use client";

import { PVP_GAMES, type PvpInvite } from "@/lib/game";
import { identityOf } from "@/lib/identity";
import { useCountdown } from "@/hooks/useCountdown";
import MonoLabel from "./ui/MonoLabel";

/**
 * 어느 화면에 있든 뜨는 대전 초대 알림.
 * 게임 중이거나 다른 요청을 처리하는 동안에는 띄우지 않고,
 * 그게 끝난 뒤에 나타난다.
 */
export default function InvitePopup({
  invite,
  busy,
  onAccept,
  onDecline,
}: {
  invite: PvpInvite;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const gameName = PVP_GAMES.find((g) => g.id === invite.game)?.name ?? "대전";
  const left = useCountdown(invite.expires_in);

  // 초대는 시설이 보내는 게 아니라 사람이 부르는 것이라 서식 번호가 없다.
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg-0/80 p-4 tab:items-center">
      <div className="border-line w-full max-w-sm border bg-bg-1">
        <div className="border-line-soft border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">대전 신청</MonoLabel>
        </div>
        <div className="flex flex-col gap-1 p-4">
          <p className="title-19 text-fg-hi">
            {identityOf(invite.from).no} {invite.from}
          </p>
          <p className="body-15 text-fg-mid">
            <span className="text-fg-hi font-bold">{gameName}</span>에 판돈{" "}
            <span className="text-fg-hi font-bold">{invite.bet} 코인</span>을
            걸고 초대함
          </p>
          <p className="mono-13 text-fg-low">
            {left}초 안에 답하지 않으면 사라진다
          </p>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
            >
              수락
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid disabled:text-fg-low"
            >
              거절
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
