"use client";

import { useEffect, useRef, useState } from "react";
import { usePendingSettle } from "@/hooks/usePendingSettle";
import { SLOT_PAIR_MULT, SLOT_POOL, SLOT_SYMBOLS, type PlayResult, type SlotSymbol } from "@/lib/game";
import { LABEL } from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";

/**
 * 슬롯머신 — 릴에 그림이 그려져 있었지만 이 단말은 그림을 못 띄운다.
 * 그래서 두 글자 코드로만 찍힌다. 아무도 그게 체리인지 종인지 신경 쓰지 않는다.
 */

const STOP_AT = [900, 1350, 1800]; // 릴이 차례로 멈추는 시각(ms)

function randomSymbol(): SlotSymbol {
  return SLOT_POOL[Math.floor(Math.random() * SLOT_POOL.length)];
}

export default function Slots({
  bet,
  disabled,
  blockedRow,
  betSlot,
  onPlay,
  onSettle,
}: {
  bet: number;
  disabled: boolean;
  blockedRow: React.ReactNode | null;
  betSlot: React.ReactNode;
  onPlay: (game: "slots", choice: null) => Promise<PlayResult | null>;
  onSettle: (result: PlayResult) => void;
}) {
  const [reels, setReels] = useState<SlotSymbol[]>(["cherry", "lemon", "bell"]);
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false]);
  const [highlight, setHighlight] = useState(false);
  const timeouts = useRef<number[]>([]);
  const interval = useRef<number | null>(null);

  // 어느 릴이 이미 멈췄는지 — setState 커밋을 기다리지 않고 정지 타이머 안에서
  // 곧바로 true 로 찍는다. spinning state 를 미러링하면 interval 틱이 "정지"
  // 렌더가 커밋되기 전에 끼어들어 방금 박아 넣은 최종 심볼을 랜덤 값으로
  // 덮어쓸 수 있다(모바일처럼 메인 스레드가 바쁠 때 잘 터졌다).
  const stoppedRef = useRef([false, false, false]);

  // 아래 cleanup 이 done 타이머를 지우면 onSettle 이 영영 안 불려 화면이
  // 잠긴 채 남는다. 정산할 결과를 따로 맡겨 두고 언마운트 때 흘려보낸다.
  const { hold, settle } = usePendingSettle(onSettle);

  useEffect(() => {
    const pending = timeouts;
    const running = interval;
    return () => {
      pending.current.forEach((t) => window.clearTimeout(t));
      if (running.current !== null) window.clearInterval(running.current);
    };
  }, []);

  const anySpinning = spinning.some(Boolean);

  async function spin() {
    if (disabled || anySpinning) return;

    const result = await onPlay("slots", null);
    if (!result) return;

    const final = (result.outcome as { reels: SlotSymbol[] }).reels;
    hold(result);
    setHighlight(false);
    setSpinning([true, true, true]);
    stoppedRef.current = [false, false, false];

    // 각 릴을 빠르게 굴리다가 순서대로 정지
    timeouts.current = [];
    interval.current = window.setInterval(() => {
      setReels((prev) =>
        prev.map((s, i) => (stoppedRef.current[i] ? s : randomSymbol())),
      );
    }, 70);

    STOP_AT.forEach((delay, i) => {
      const t = window.setTimeout(() => {
        // setState 보다 먼저 동기적으로 찍어 interval 틱이 끼어들 여지를 없앤다.
        stoppedRef.current[i] = true;
        setReels((prev) => {
          const next = [...prev];
          next[i] = final[i];
          return next;
        });
        setSpinning((prev) => {
          const next = [...prev];
          next[i] = false;
          return next;
        });
      }, delay);
      timeouts.current.push(t);
    });

    const done = window.setTimeout(() => {
      if (interval.current !== null) {
        window.clearInterval(interval.current);
        interval.current = null;
      }
      // 위 타이밍이 어떻게 꼬여도 최종 화면은 서버 결과와 반드시 같아야 한다.
      setReels(final);
      setHighlight(true);
      settle();
    }, STOP_AT[STOP_AT.length - 1] + 250);
    timeouts.current.push(done);
  }

  const payouts = (Object.keys(SLOT_SYMBOLS) as SlotSymbol[]).slice().reverse();

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-bg-1 grid grid-cols-1 gap-4 p-2 desk:grid-cols-[104px_minmax(0,1fr)_244px] desk:gap-4 desk:p-4">
        {/* [1] 배당 레일 — 높은 것부터 */}
        <div className="grid grid-cols-3 gap-1 desk:grid-cols-1">
          <MonoLabel className="hidden desk:block">{LABEL.mult}</MonoLabel>
          {payouts.map((key) => (
            <div
              key={key}
              className="bg-surface flex min-h-9 flex-1 items-center justify-between gap-1 px-2"
            >
              <span className="text-[18px] leading-none">
                {SLOT_SYMBOLS[key].emoji}
              </span>
              <span className="mono-13 text-fg tabular-nums">
                ×{SLOT_SYMBOLS[key].mult}
              </span>
            </div>
          ))}
        </div>

        {/* [2] 릴 — 그림이 아니라 코드가 돈다 */}
        <div className="flex min-h-0 flex-col items-center justify-center gap-2.5 desk:min-h-[340px]">
          <div className="flex justify-center gap-2">
            {reels.map((symbol, i) => (
              <div
                key={i}
                className={`state-fade border-card-edge flex h-[112px] w-[84px] items-center justify-center rounded-[2px] border bg-card-face tab:h-[150px] tab:w-[112px] desk:h-[184px] desk:w-[136px] ${
                  highlight && !anySpinning
                    ? "shadow-[inset_0_0_0_5px_var(--color-brass-line)]"
                    : "shadow-[inset_0_0_0_5px_var(--color-card-inset)]"
                }`}
              >
                <span
                  className={`leading-none text-[40px] tab:text-[52px] desk:text-[68px] ${
                    spinning[i] ? "opacity-50" : "opacity-100"
                  }`}
                >
                  {SLOT_SYMBOLS[symbol].emoji}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* [3] 건 코인 — 모바일에서는 감춰 판이 한눈에 들어오게 한다 */}
        <div className="hidden grid-cols-2 gap-2 tab:grid desk:flex desk:flex-col">
          <div className="bg-surface flex flex-col gap-1 p-3">
            <MonoLabel>{LABEL.stake}</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">{bet}</span>
          </div>
          <div className="border-brass-line flex flex-col gap-1 border bg-brass-fill p-3">
            <MonoLabel>최대 배당</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">
              ×{SLOT_SYMBOLS.diamond.mult}
            </span>
          </div>
          <div className="bg-surface col-span-2 hidden flex-1 flex-col justify-end gap-1.5 p-3 desk:flex">
            <span className="body-15 text-fg-mid">
              세 칸이 같으면 표의 배당, 두 칸만 같으면 ×{SLOT_PAIR_MULT}다.
            </span>
            <span className="body-15 text-fg">
              레버는 없다. 눌러도 결과는 이미 정해져 있다.
            </span>
          </div>
        </div>
      </div>

      {betSlot}

      {blockedRow ?? (
        <button
          type="button"
          disabled={disabled || anySpinning}
          onClick={spin}
          className={`state-fade title-19 min-h-15 border desk:min-h-23 ${
            disabled || anySpinning
              ? "border-line-soft bg-bg-1 text-fg-low"
              : "border-brass-line bg-brass-fill text-fg-hi"
          }`}
        >
          {anySpinning ? "도는 중" : `${bet} 코인으로 돌리기`}
        </button>
      )}
    </div>
  );
}
