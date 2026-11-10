import MonoLabel from "./MonoLabel";

/**
 * 라벨 + 숫자 한 덩어리.
 *
 * 헤더의 보유 코인 · 오늘 남은 판, 히어로의 건 코인 · 적립금이 전부 이 모양이다.
 * 라벨과 값 사이는 4px. 그보다 붙이거나 띄우지 않는다.
 */
export default function StatBlock({
  label,
  value,
  suffix,
  size = "md",
  tone = "plain",
  note,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  /** lg = 보유 코인(34), md = 남은 판·에너지·적립금(26) */
  size?: "lg" | "md";
  /** brass = 코인처럼 놋쇠로 읽히는 값, fill = 적립금 블록(놋쇠 면) */
  tone?: "plain" | "brass" | "fill";
  note?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 ${
        tone === "fill" ? "border border-brass-line bg-brass-fill p-3" : ""
      } ${className}`}
    >
      <MonoLabel tone={tone === "plain" ? "mid" : "dim"}>{label}</MonoLabel>
      <div
        className={`${size === "lg" ? "num-lg" : "num-md"} tabular-nums ${
          tone === "brass" ? "text-brass" : "text-fg-hi"
        }`}
      >
        {value}
        {suffix && (
          <span className="text-fg-mid ml-0.5 text-[15px] font-normal">
            {suffix}
          </span>
        )}
      </div>
      {note && <p className="mono-13 text-fg-low">{note}</p>}
    </div>
  );
}
