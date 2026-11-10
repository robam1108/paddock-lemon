import type { Blocked } from "@/lib/copy";

/**
 * 판에 앉을 수 없을 때 3버튼 자리에 들어가는 한 줄.
 *
 * 배너를 따로 띄우지 않는다 — 배너는 "곧 치울 것"처럼 보이고, 이건 오늘 안 치워진다.
 * 버튼과 같은 높이를 차지해서 레이아웃이 흔들리지 않는다. 테두리를 파선으로 둔 건
 * 이 자리가 원래 비어 있을 자리가 아니라는 표시다.
 * (화면 전체를 한 톤 죽이는 처리는 Casino 루트에서 한다.)
 */
export default function BlockedRow({
  blocked,
  actions,
  disabled,
}: {
  blocked: Blocked;
  /** 휴식 중일 때의 휴식 단축 아이템처럼, 실제로 가진 만큼만 버튼으로 뜬다. */
  actions?: { label: string; onClick: () => void }[];
  disabled?: boolean;
}) {
  return (
    <div
      role="status"
      className="scanline-faint border-line flex min-h-[60px] flex-col items-center justify-center gap-1.5 border border-dashed bg-bg-2 p-3 text-center desk:min-h-23"
    >
      <span className="body-15 text-fg">{blocked.line}</span>
      <span className="mono-13 text-fg-low">{blocked.sub}</span>
      {actions && actions.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-1.5">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={disabled}
              onClick={a.onClick}
              className="label-11 border-line state-fade border bg-surface px-4 py-2.5 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
