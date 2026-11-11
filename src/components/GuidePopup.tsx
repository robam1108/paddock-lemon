"use client";

import { createPortal } from "react-dom";
import { INTRO } from "@/lib/guide";
import { LABEL } from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";

/** `**강조**` 구간을 굵게 렌더링한다. 문안(guide.ts)에서만 쓰는 최소 마크업. */
function renderWithBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="text-fg-hi font-bold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/**
 * 소개 — 서비스를 한 장으로 설명하는 정적 팝업.
 * 첫 문단은 제목처럼 크게, 나머지는 본문으로 적는다.
 */
export default function GuidePopup({ onClose }: { onClose: () => void }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
          <MonoLabel>{LABEL.guide}</MonoLabel>
          <button
            type="button"
            onClick={onClose}
            className="label-11 text-fg-mid hover:text-fg-hi"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-col gap-2 p-4">
          {INTRO.map((p, i) =>
            i === 0 ? (
              <p key={i} className="text-fg-hi text-[20px] font-bold leading-snug">
                {p}
              </p>
            ) : (
              <p key={i} className="body-15 text-fg-mid">
                {renderWithBold(p)}
              </p>
            ),
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
