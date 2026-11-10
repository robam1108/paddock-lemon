"use client";

import { createPortal } from "react-dom";
import MonoLabel from "./MonoLabel";

/**
 * 결과 팝업 — 작업장 · 탐색이 함께 쓴다.
 *
 * BuyConfirm(배급소·밀거래)의 결과 화면과 같은 뼈대(포털 · 헤더 ·
 * 첫 줄만 밝게, 나머지는 톤 색 · 닫기 하나)를 확인 단계 없이 결과만
 * 보여주는 쪽으로 뽑아냈다. 산다/훔친다처럼 구매 흐름에 얽힌 것이
 * 없어 여기엔 확인 버튼이 없다 — 결과가 곧 화면이다.
 */
export default function ResultPopup({
  title,
  icon,
  lines,
  tone = "ok",
  onClose,
}: {
  title: string;
  /** 탐색에서 얻은 물건처럼, 문장 위에 붙일 것(ItemMark + 이름 등) */
  icon?: React.ReactNode;
  lines: string[];
  /** ok = 놋쇠(성과). 지금은 작업·탐색 둘 다 손실이 없어 항상 ok 지만,
   *  나중에 실패가 생길 경우를 대비해 남겨 둔다. */
  tone?: "ok" | "bad";
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="border-line w-full max-w-xs border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
          <MonoLabel>{title}</MonoLabel>
          <button
            type="button"
            onClick={onClose}
            className="label-11 text-fg-mid hover:text-fg-hi"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {icon}
          {lines.map((line, i) => (
            <p
              key={i}
              className={`body-15 ${
                i === 0 ? "text-fg-hi" : tone === "ok" ? "text-brass" : "text-loss"
              }`}
            >
              {line}
            </p>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="state-fade label-11 border-line w-full border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi"
          >
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
