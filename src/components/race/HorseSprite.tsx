import { COAT, saddle } from "@/lib/race";

/**
 * 옆에서 본 말 한 마리(오른쪽을 본다). 몸통은 모색, 번호천은 게이트 색.
 * 다리는 두 장면(뻗음·모음)을 겹쳐 두고 .gallop-a/.gallop-b 가 번갈아 보인다 —
 * running 이 false 면 서 있는 장면 하나만 그린다.
 */
export default function HorseSprite({
  coat,
  face,
  legs,
  gate,
  running = false,
  size = 48,
}: {
  coat: string;
  face: string;
  legs: string;
  gate: number;
  running?: boolean;
  size?: number;
}) {
  const c = COAT[coat] ?? COAT["갈색"];
  const s = saddle(gate);
  const sock = (on: boolean) => (on ? "#e9e6df" : "#1a1410");
  const all = legs.includes("네 발");
  const front = all || legs.includes("앞");
  const hind = all || legs.includes("뒷");
  const leg = { stroke: c.body, strokeWidth: 2.4, strokeLinecap: "round" as const };

  const hoof = (x: number, y: number, white: boolean) => (
    <circle cx={x} cy={y} r={1.3} fill={sock(white)} />
  );

  return (
    <svg
      viewBox="0 0 48 32"
      width={size}
      height={(size * 32) / 48}
      aria-hidden
      className="block overflow-visible"
    >
      <g className={running ? "gallop-body" : undefined}>
        {/* 꼬리 */}
        <path d="M10 13 C 5 14, 3 18, 2 22" stroke={c.mane} strokeWidth={2.4} fill="none" strokeLinecap="round" />

        {running ? (
          <>
            {/* 뻗은 장면 */}
            <g className="gallop-a">
              <line x1={31} y1={18} x2={39} y2={26} {...leg} />
              <line x1={29} y1={19} x2={25} y2={28} {...leg} />
              <line x1={14} y1={18} x2={7} y2={26} {...leg} />
              <line x1={16} y1={19} x2={20} y2={28} {...leg} />
              {hoof(39, 26, front)}
              {hoof(25, 28, front)}
              {hoof(7, 26, hind)}
              {hoof(20, 28, hind)}
            </g>
            {/* 모은 장면 */}
            <g className="gallop-b">
              <line x1={31} y1={18} x2={33} y2={28} {...leg} />
              <line x1={29} y1={19} x2={34} y2={25} {...leg} />
              <line x1={14} y1={18} x2={16} y2={28} {...leg} />
              <line x1={16} y1={19} x2={11} y2={26} {...leg} />
              {hoof(33, 28, front)}
              {hoof(34, 25, front)}
              {hoof(16, 28, hind)}
              {hoof(11, 26, hind)}
            </g>
          </>
        ) : (
          <g>
            <line x1={31} y1={18} x2={32} y2={29} {...leg} />
            <line x1={28} y1={19} x2={28} y2={29} {...leg} />
            <line x1={14} y1={18} x2={13} y2={29} {...leg} />
            <line x1={17} y1={19} x2={17} y2={29} {...leg} />
            {hoof(32, 29, front)}
            {hoof(28, 29, front)}
            {hoof(13, 29, hind)}
            {hoof(17, 29, hind)}
          </g>
        )}

        {/* 몸통 · 목 · 머리 */}
        <ellipse cx={22} cy={14.5} rx={13} ry={5.8} fill={c.body} />
        <polygon points="30,11 37,4 41,6 35,16" fill={c.body} />
        <polygon points="36,3 46,7 45.5,9.5 39,9.5" fill={c.body} />
        <polygon points="37.5,3.5 38.5,0.5 40,3.5" fill={c.body} />
        <path d="M30 10.5 L 36.5 3.5" stroke={c.mane} strokeWidth={2} strokeLinecap="round" />
        {face !== "없음" && (
          face === "별" ? (
            <circle cx={40} cy={5.4} r={0.9} fill="#efece4" />
          ) : (
            <path
              d={face === "작" ? "M44.5 7.6 L 45.6 8.6" : "M39.5 5 L 45 8"}
              stroke="#efece4"
              strokeWidth={face === "백면" ? 1.6 : 0.9}
              strokeLinecap="round"
            />
          )
        )}
        <circle cx={41} cy={5.6} r={0.55} fill="#0b0908" />

        {/* 번호천 */}
        <rect x={16} y={8.5} width={10} height={8.5} rx={0.8} fill={s.bg} stroke="#0006" strokeWidth={0.4} />
        <text
          x={21}
          y={15}
          textAnchor="middle"
          fontSize={6.4}
          fontWeight={700}
          fill={s.fg}
          fontFamily="ui-monospace, monospace"
        >
          {gate}
        </text>

        {/* 기수 — 상의는 번호천 색 */}
        <path d="M22 9 L 24 3.2 L 28.5 4.5 L 26 9 Z" fill={s.bg} stroke="#0007" strokeWidth={0.4} />
        <circle cx={27.2} cy={1.6} r={1.9} fill={s.bg} stroke="#0007" strokeWidth={0.4} />
        <line x1={27} y1={5} x2={33} y2={7.5} stroke="#2a201a" strokeWidth={1} strokeLinecap="round" />
      </g>
    </svg>
  );
}
