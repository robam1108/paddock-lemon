/**
 * 패널 바닥.
 *
 * 테두리는 두 겹을 넘지 않는다 — 그래서 이 컴포넌트는 기본적으로 선을 안 긋고,
 * 구획은 배경 밝기 한 단 차이로만 낸다. 패널 안에 패널을 넣지 말 것.
 * 내부 구획이 필요하면 bg-surface 블록을 직접 쓴다. 그건 패널이 아니다.
 */
export default function Panel({
  children,
  tone = "base",
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  /** hi = 규칙 패널. 항상 펼쳐 두는 유일한 패널이라 한 단 밝다. */
  tone?: "base" | "hi";
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`scanline-faint ${tone === "hi" ? "bg-bg-2" : "bg-bg-1"} ${
        padded ? "p-4" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}
