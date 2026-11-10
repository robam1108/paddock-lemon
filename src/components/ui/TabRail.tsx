"use client";

/**
 * 탭 레일.
 *
 * 구역 탭 · 게임 선택 · 서브탭이 전부 이걸 쓴다. 예전에는 같은 마크업이
 * 다섯 군데 복제돼 있었고, 그중 구역 탭은 4개 항목을 3열 격자에 넣어
 * 마지막 하나가 둘째 줄로 떨어져 있었다(지금은 구역이 여섯으로 늘어
 * `grid-cols-3 tab:grid-cols-6` 을 쓴다 — 375px 에서 3열 2행).
 *
 * 활성 표시는 면 밝기(surface-hi) + 놋쇠 2px 선. 색만으로 구분하지 않는다.
 */
export default function TabRail<T extends string>({
  items,
  value,
  onChange,
  disabled = false,
  marker = "underline",
  columns = "grid-cols-4",
  height = "h-11",
}: {
  items: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  disabled?: boolean;
  /** underline = 구역 탭(밑줄), left = 게임 선택(좌측선) */
  marker?: "underline" | "left";
  columns?: string;
  height?: string;
}) {
  return (
    <nav className={`grid gap-0.5 bg-bg-1 ${columns}`}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            disabled={disabled || active}
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(it.id)}
            className={`state-fade title-19 ${height} px-2 text-center ${
              active
                ? `bg-surface-hi text-fg-hi ${
                    marker === "underline"
                      ? "border-b-2 border-brass"
                      : "border-l-2 border-brass"
                  }`
                : "bg-surface text-fg-mid hover:text-fg disabled:text-fg-low"
            }`}
          >
            <span className="block truncate">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
