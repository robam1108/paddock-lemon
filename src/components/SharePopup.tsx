"use client";

import { useState } from "react";
import { itemEffect, type InventoryItem } from "@/lib/game";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";

/**
 * 술·약물·젤·구운 고구마·구운 생선 중 함께 쓸 수 있는 것(item.shareable)을 쓰기 전에 뜨는 창.
 * 혼자 쓰거나, 수감자 한 명을 골라 함께 쓴다 — 함께 쓰면 고른 사람에게도
 * 특이사항이 붙는다. 병동에 있는 사람과 본인은 목록에 아예 나오지 않는다
 * (mates 를 넘기는 쪽이 이미 걸러 준다).
 */
export default function SharePopup({
  item,
  mates,
  busy,
  onAlone,
  onTogether,
  onCancel,
}: {
  item: InventoryItem;
  mates: string[];
  busy: boolean;
  onAlone: () => void;
  onTogether: (username: string) => void;
  onCancel: () => void;
}) {
  const [mate, setMate] = useState("");
  const picked = mates.includes(mate) ? mate : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg-0/80 p-4 tab:items-center"
      onClick={onCancel}
    >
      <div
        className="border-line w-full max-w-sm border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">누구와 쓸까</MonoLabel>
          <button
            type="button"
            onClick={onCancel}
            aria-label="닫기"
            className="mono-13 text-fg-mid ml-auto"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-2.5">
            <ItemMark kind={item.kind} grade={item.grade} emoji={item.emoji} size="lg" />
            <div className="min-w-0">
              <p className="title-19 text-fg-hi truncate">{item.name}</p>
              <p className="mono-13 text-fg-mid truncate">{itemEffect(item)}</p>
            </div>
          </div>

          <p className="body-15 text-fg-mid mt-2">
            {item.kind === "food"
              ? "함께 먹으면 고른 사람도 같은 효과를 받는다. 물건은 내 것 하나만 쓴다."
              : "함께 쓰면 고른 사람에게도 특이사항이 붙는다. 물건은 내 것 하나만 쓴다."}
          </p>

          {mates.length === 0 ? (
            <p className="body-15 text-fg mt-2">지금 함께할 사람이 없다.</p>
          ) : (
            <select
              value={picked}
              disabled={busy}
              onChange={(e) => setMate(e.target.value)}
              className="mono-13 border-line mt-2 min-h-12 w-full border bg-surface px-3 text-fg-hi"
            >
              <option value="">— 선택 —</option>
              {mates.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onAlone}
              className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid disabled:text-fg-low"
            >
              혼자
            </button>
            <button
              type="button"
              disabled={busy || !picked}
              onClick={() => onTogether(picked)}
              className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
            >
              함께
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
