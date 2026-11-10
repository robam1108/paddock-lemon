"use client";

import type { CatTestAction, SearchBoard } from "@/lib/game";
import { SEARCH_PLACES } from "@/lib/labor";
import MonoLabel from "./ui/MonoLabel";

/**
 * 고양이 테스트 패널 — 시험 계정(board.tester)에게만 탐색 탭 아래에 뜬다.
 *
 * 다섯 곳을 돌며 고양이 자리를 찾거나 보은 3시간을 기다리지 않고 흐름을 끝까지
 * 확인하려고 둔다(public.cat_test). "죽은 것 셋"은 죽은 새 · 쥐 · 벌레를 하나씩 소지품에
 * 넣는다 — 사용 팝업과 효과를 확인할 때 쓴다. "초기화"는 내 이름 · 친밀도 · 보은 아이템 ·
 * 켜 둔 보은 효과를 지운다.
 */

const ACTIONS: { id: CatTestAction; label: string }[] = [
  { id: "here", label: "고양이 만나기" },
  { id: "churu", label: "츄르 +3" },
  { id: "fish", label: "고등어·전갱이·우유 +1" },
  { id: "friend", label: "친밀도 채우기" },
  { id: "gifts_now", label: "보은 바로 도착" },
  { id: "deads", label: "죽은 것 셋" },
  { id: "reset", label: "초기화" },
];

export default function CatTestPanel({
  board,
  disabled,
  onAction,
}: {
  board: SearchBoard;
  disabled: boolean;
  onAction: (action: CatTestAction) => void;
}) {
  const place = SEARCH_PLACES.find((p) => p.id === board.cat_place)?.label ?? "-";

  return (
    <section className="border-brass-line flex flex-col gap-2 border border-dashed bg-bg-1 p-4">
      <div className="flex items-center justify-between">
        <MonoLabel>고양이 테스트</MonoLabel>
        <MonoLabel tone="low">관리자 전용</MonoLabel>
      </div>

      <dl className="mono-13 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        <dt className="text-fg-low">오늘 자리</dt>
        <dd className="text-fg-hi">{place}</dd>
        <dt className="text-fg-low">내 이름</dt>
        <dd className="text-fg-hi truncate">{board.cat_name ?? "없음"}</dd>
        <dt className="text-fg-low">친밀도</dt>
        <dd className="text-fg-hi">{board.churu_given ?? 0}/3</dd>
        <dt className="text-fg-low">가진 츄르</dt>
        <dd className="text-fg-hi">{board.churu_held ?? 0}개</dd>
        <dt className="text-fg-low">남은 보은</dt>
        <dd className="text-fg-hi">{board.gifts_waiting ?? 0}개 · 소지품 탭에서 받는다</dd>
        <dt className="text-fg-low">죽은 새</dt>
        <dd className="text-fg-hi">남은 {board.bless_left ?? 0}판</dd>
      </dl>

      <div className="grid grid-cols-2 gap-1.5 tab:grid-cols-3">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (a.id === "reset" && !confirm("내 고양이 이름·친밀도·보은 아이템을 모두 지울까요?")) return;
              onAction(a.id);
            }}
            className={`state-fade label-11 border px-2 py-2.5 disabled:opacity-50 ${
              a.id === "reset"
                ? "border-loss/40 text-loss bg-surface"
                : "border-line text-fg-mid bg-surface enabled:hover:text-fg-hi"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </section>
  );
}
