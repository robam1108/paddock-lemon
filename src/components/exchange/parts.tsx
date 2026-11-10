"use client";

import type { PlayerState, TradeItem } from "@/lib/game";
import ItemMark from "../ui/ItemMark";

/* 상점 · 개인 거래 화면에서 같이 쓰는 작은 부품과 버튼 클래스. */

export const PRIMARY =
  "state-fade label-11 border-brass-line border bg-brass-fill px-4 py-3 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";
export const PLAIN =
  "state-fade label-11 border-line border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

/** 고른 아이템 수량 → RPC 인자 모양 */
export const toPayload = (picks: Record<string, number>) =>
  Object.entries(picks)
    .filter(([, q]) => q > 0)
    .map(([code, qty]) => ({ code, qty }));

/** 명조로 찍은 섹션 제목. 이 구역에서만 쓴다. */
export function HandLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-hand text-brass text-[24px] leading-[1.15] font-semibold">
      {children}
    </span>
  );
}

/** 코인 + 아이템 묶음을 한 줄로 */
export function OfferLine({
  coins,
  items,
  empty = "없음",
}: {
  coins: number;
  items: TradeItem[];
  empty?: string;
}) {
  if (coins === 0 && items.length === 0) {
    return <span className="text-fg-low">{empty}</span>;
  }
  return (
    <span className="text-fg">
      {coins > 0 && <span className="text-brass">{coins} 코인</span>}
      {coins > 0 && items.length > 0 && <span className="text-fg-low"> + </span>}
      {items.map((i, n) => (
        <span key={i.code}>
          {n > 0 && <span className="text-fg-low">, </span>}
          {i.name} ×{i.qty}
        </span>
      ))}
    </span>
  );
}

/** 코인/아이템 고르기 */
export function Picker({
  items,
  coins,
  maxCoins,
  picked,
  onCoins,
  onPick,
}: {
  items: PlayerState["items"];
  coins: number;
  maxCoins: number;
  picked: Record<string, number>;
  onCoins: (n: number) => void;
  onPick: (p: Record<string, number>) => void;
}) {
  // qty=0 인 항목은 봉인된 갑이 없다는 뜻이다 — 개봉한 갑의 남은 개비(open_left)
  // 만 있는 상태라 넘길 수 없으므로 목록에서도 뺀다.
  const tradable = items.filter((i) => i.tradable && i.qty > 0);

  return (
    <div className="flex flex-col gap-1">
      {/* 빠른 버튼 때문에 좁은 화면에선 한 줄에 안 들어간다 — 줄을 바꿔 증감기를 아래로 내린다. */}
      <div className="bg-surface flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <span className="body-15 text-fg min-w-12 flex-1 truncate">코인</span>
        <div className="ml-auto max-w-full">
          <Stepper value={coins} max={maxCoins} accent quick onChange={onCoins} />
        </div>
      </div>

      {tradable.length === 0 ? (
        <p className="mono-13 text-fg-low px-3 py-1">내놓을 물건이 없습니다.</p>
      ) : (
        tradable.map((it) => {
          const n = picked[it.code] ?? 0;
          return (
            <div
              key={it.code}
              className="bg-surface flex items-center gap-2 px-3 py-2"
            >
              <ItemMark kind={it.kind} grade={it.grade} emoji={it.emoji} size="sm" />
              <span className="body-15 text-fg min-w-0 flex-1 truncate">
                {it.name}
                <span className="text-fg-low"> 보유 {it.qty}</span>
              </span>
              <Stepper
                value={n}
                max={it.qty}
                onChange={(v) => onPick({ ...picked, [it.code]: v })}
              />
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * 코인과 아이템이 같은 간격으로 보이도록 폭을 고정한 증감기.
 * quick을 켜면 ±10, ±100 버튼이 양옆에 붙어 그만큼만 폭이 넓어진다.
 */
export function Stepper({
  value,
  max,
  accent,
  quick,
  onChange,
}: {
  value: number;
  max: number;
  accent?: boolean;
  /** ±10, ±100 버튼을 양옆에 붙인다. 코인처럼 자릿수가 큰 값에만 쓴다. */
  quick?: boolean;
  onChange: (n: number) => void;
}) {
  // 0과 보유량 사이로 자르는 건 여기 한 곳에서만 한다.
  const set = (delta: number) =>
    onChange(Math.max(0, Math.min(max, value + delta)));

  const btn =
    "border-line state-fade h-9 w-9 shrink-0 border bg-surface-hi text-fg disabled:text-fg-low";
  const quickCls =
    "label-11 state-fade border-line h-9 min-w-0 overflow-hidden border bg-surface-hi px-1.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

  // 빠른 버튼이 있으면 좁은 화면에서 버튼만 줄어들어 부모 폭 안에 머문다.
  return (
    <div
      className={`flex items-center gap-1 ${quick ? "min-w-0 max-w-full" : "shrink-0"}`}
    >
      {quick && (
        <>
          <button
            type="button"
            onClick={() => set(-100)}
            disabled={value === 0}
            aria-label="100 줄이기"
            className={quickCls}
          >
            -100
          </button>
          <button
            type="button"
            onClick={() => set(-10)}
            disabled={value === 0}
            aria-label="10 줄이기"
            className={quickCls}
          >
            -10
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => set(-1)}
        disabled={value === 0}
        aria-label="줄이기"
        className={btn}
      >
        ＜
      </button>
      <span
        className={`mono-13 w-10 shrink-0 text-center tabular-nums ${
          accent ? "text-brass" : "text-fg-hi"
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => set(1)}
        disabled={value >= max}
        aria-label="늘리기"
        className={btn}
      >
        ＞
      </button>
      {quick && (
        <>
          <button
            type="button"
            onClick={() => set(10)}
            disabled={value >= max}
            aria-label="10 늘리기"
            className={quickCls}
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => set(100)}
            disabled={value >= max}
            aria-label="100 늘리기"
            className={quickCls}
          >
            +100
          </button>
        </>
      )}
    </div>
  );
}
