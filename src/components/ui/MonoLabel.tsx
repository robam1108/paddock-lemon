/**
 * 각인된 라벨. 자간이 넓고 절대 줄바꿈되지 않는다.
 * (nowrap 은 label-11 토큰 안에 박혀 있다.)
 */
export default function MonoLabel({
  children,
  tone = "dim",
  className = "",
}: {
  children: React.ReactNode;
  /** dim = 골드 라벨, low = 장식성 보조 표기 */
  tone?: "dim" | "low" | "mid";
  className?: string;
}) {
  const color =
    tone === "dim"
      ? "text-brass-dim"
      : tone === "low"
        ? "text-fg-low"
        : "text-fg-mid";

  return <span className={`label-11 ${color} ${className}`}>{children}</span>;
}
