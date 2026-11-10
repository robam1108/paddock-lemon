"use client";

import { createPortal } from "react-dom";
import { itemEffect, type ItemDef } from "@/lib/game";
import ItemMark from "./ItemMark";
import MonoLabel from "./MonoLabel";

/**
 * 상점 구매 확인 팝업. 상태는 부모가 쥔다 — 여기는 받은 대로 그릴 뿐이다.
 */

const primary =
  "state-fade label-11 border-brass-line border bg-brass-fill px-4 py-3 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";
const plain =
  "state-fade label-11 border-line border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

export default function BuyConfirm({
  item,
  price,
  original,
  busy,
  buyDisabled = false,
  onConfirm,
  onCancel,
}: {
  item: ItemDef;
  price: number;
  /** 할인가일 때만: 원래 값(네잎클로버) */
  original?: number;
  busy: boolean;
  /** 코인이 모자라면 구매 버튼을 끈다 */
  buyDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="border-line w-full max-w-xs border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
          <MonoLabel>구매 확인</MonoLabel>
          <button
            type="button"
            onClick={onCancel}
            className="label-11 text-fg-mid hover:text-fg-hi"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2.5">
            <ItemMark kind={item.kind} grade={item.grade} emoji={item.emoji} />
            <div className="min-w-0 flex-1">
              <span className="body-15 text-fg-hi">{item.name}</span>
              <p className="mono-13 text-fg-mid">{itemEffect(item)}</p>
            </div>
          </div>
          <p className="body-15 text-fg">
            {original != null && (
              <span className="text-fg-low mr-1.5 line-through">{original}</span>
            )}
            <span className="text-brass">{price} 코인</span>에 구매할까요?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || buyDisabled}
              onClick={onConfirm}
              className={`${primary} flex-1`}
            >
              구매
            </button>
            <button type="button" onClick={onCancel} className={plain}>
              취소
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
