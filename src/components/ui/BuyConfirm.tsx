"use client";

import { createPortal } from "react-dom";
import { itemEffect, type ItemDef, type StealResult } from "@/lib/game";
import { stealLines, type StealWatcher } from "@/lib/copy";
import ItemMark from "./ItemMark";
import MonoLabel from "./MonoLabel";

/**
 * 구매 확인 팝업 — 배급소와 밀거래가 함께 쓴다.
 *
 * 원래 거래소(배급소) 안에 있던 마크업을 그대로 뽑아낸 것이라 클래스 이름도
 * 그때 쓰던 것과 같다(primary/plain 문자열은 Exchange.tsx 것과 동일하게 맞춤).
 *
 * 두 얼굴을 갖는다. outcome 이 없으면 지금까지의 구매 확인이고, 훔치기를 눌러
 * 결과가 오면 그 자리에서 결과 화면으로 갈아 끼운다(버튼은 닫기 하나만 남는다).
 * 상태는 부모가 쥔다 — 여기는 받은 대로 그릴 뿐이다.
 */

const primary =
  "state-fade label-11 border-brass-line border bg-brass-fill px-4 py-3 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";
const plain =
  "state-fade label-11 border-line border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";
// 훔치기는 사는 것과 같은 무게로 보이면 안 된다. 값 대신 위험을 띄운다.
const risky =
  "state-fade label-11 border-loss/40 border bg-surface px-4 py-3 text-loss enabled:hover:text-fg-hi disabled:border-line-soft disabled:text-fg-low";

export default function BuyConfirm({
  item,
  price,
  original,
  busy,
  buyDisabled = false,
  canSteal = false,
  stealSure = false,
  who = "배급관",
  outcome = null,
  onConfirm,
  onSteal,
  onCancel,
}: {
  item: ItemDef;
  /** buy_price 와 다를 수 있다 (밀거래 특별 상품 할인가) */
  price: number;
  /** 할인가일 때만: 원래 값(배급소 네잎클로버) */
  original?: number;
  busy: boolean;
  /** 코인이 모자란다 — 산다만 죽이고 훔치기는 살려 둔다 */
  buyDisabled?: boolean;
  /** 오늘 훔치기가 남아 있고, 훔칠 수 있는 물건일 때만 */
  canSteal?: boolean;
  /** 절도비법을 장착해 둔 상태 — 이번 훔치기는 확정 성공한다 */
  stealSure?: boolean;
  /** 걸렸을 때 등장하는 사람 */
  who?: StealWatcher;
  /** 오면 결과 화면으로 바뀐다 */
  outcome?: StealResult | null;
  onConfirm: () => void;
  onSteal?: () => void;
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
          <MonoLabel>{outcome ? "절도" : "구매 확인"}</MonoLabel>
          <button
            type="button"
            onClick={onCancel}
            className="label-11 text-fg-mid hover:text-fg-hi"
          >
            닫기
          </button>
        </div>

        {outcome ? (
          <div className="flex flex-col gap-3 p-4">
            {stealLines(outcome, who).map((line, i) => (
              <p
                key={i}
                className={`body-15 ${
                  i === 0 ? "text-fg-hi" : outcome.ok ? "text-brass" : "text-loss"
                }`}
              >
                {line}
              </p>
            ))}
            <button type="button" onClick={onCancel} className={`${plain} w-full`}>
              닫기
            </button>
          </div>
        ) : (
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
              <span className="text-brass">{price} 코인</span>에 사겠는가?
            </p>
            {/* 훔치기가 붙으면 셋이 한 줄에 안 들어간다 — 그만둔다를 아래로 내린다 */}
            {canSteal ? (
              <div className="flex flex-col gap-2">
                {stealSure && (
                  <p className="mono-13 text-brass">
                    손에 익은 요령이 있다. 이번엔 실패하지 않는다.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy || buyDisabled}
                    onClick={onConfirm}
                    className={primary}
                  >
                    산다
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onSteal}
                    className={risky}
                  >
                    훔치기
                  </button>
                </div>
                <button type="button" onClick={onCancel} className={plain}>
                  그만둔다
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || buyDisabled}
                  onClick={onConfirm}
                  className={`${primary} flex-1`}
                >
                  산다
                </button>
                <button type="button" onClick={onCancel} className={plain}>
                  그만둔다
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
