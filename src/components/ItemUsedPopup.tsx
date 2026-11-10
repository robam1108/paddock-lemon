"use client";

import MonoLabel from "./ui/MonoLabel";

/**
 * 소지품에서 쓰거나 착용한 직후 뜨는 팝업. 무엇을 했고 에너지·횟수가 어떻게
 * 바뀌었는지(lines), 이번에 붙은 특이사항(notes)을 보여준다.
 * 문장은 copy.ts 의 usedItemLines 가 만든다.
 */
export default function ItemUsedPopup({
  lines,
  notes,
  onClose,
}: {
  lines: string[];
  notes: string[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/80 p-4"
      onClick={onClose}
    >
      <div
        className="border-line w-full max-w-md border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">소지품</MonoLabel>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            {lines.map((line, i) => (
              <p
                key={i}
                className={i === 0 ? "body-15 text-fg-hi" : "mono-13 text-fg-mid tabular-nums"}
              >
                {line}
              </p>
            ))}
          </div>

          {notes.length > 0 && (
            <div className="border-line-soft flex flex-col gap-1 border-t pt-3">
              <MonoLabel tone="low">특이사항</MonoLabel>
              {notes.map((note, i) => (
                <p key={i} className="body-15 text-fg-mid">
                  {note}
                </p>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
