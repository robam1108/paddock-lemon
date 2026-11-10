"use client";

import { useEffect, useRef, useState } from "react";
import { usePendingSettle } from "@/hooks/usePendingSettle";
import {
  kenoMult,
  kenoTiers,
  type KenoOutcome,
  type PlayResult,
} from "@/lib/game";
import { KENO_DRAWING_NOTE, LABEL, kenoMatchLine, kenoPickPrompt } from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";
import { getRules } from "@/lib/server-rules";

/**
 * 키노 — 벽에 걸린 번호판이다. 서버가 매 회차 열 개를 뽑아 불을 켜고,
 * 플레이어는 그 전에 다섯 개를 짚어 둔다. 맞았는지는 불이 다 켜진 뒤에 안다.
 *
 * 슬롯머신과 같은 골격을 쓴다: 배당 레일 | 게임 존 | 건 코인.
 * 판정은 전부 서버(play_game)가 끝내 놓고, 여기서는 이미 정해진 결과를
 * 순서대로 보여 주기만 한다.
 */

const LEAD_IN = 300; // 첫 숫자가 앉기까지
const STEP = 170; // 숫자 하나 사이의 간격
const TAIL = 250; // 마지막 숫자가 앉고 정산까지

function drawAll(): number[] {
  return Array.from({ length: getRules().keno.range }, (_, i) => i + 1);
}

/** 1~40 에서 서로 다른 다섯을 뽑는다(무작위 버튼). */
function randomPicks(): number[] {
  const pool = drawAll();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, getRules().keno.picks).sort((a, b) => a - b);
}

/**
 * 칸의 네 가지 얼굴. 색상각을 쓰지 않는다 — 밝기와 테만으로 갈라서
 * 여섯 구역 어느 톤에서도, 흑백으로 찍어도 구분된다.
 */
function cellFace(picked: boolean, drawn: boolean): string {
  if (picked && drawn) return "bg-brass text-card-ink";
  if (drawn) return "bg-card-face text-card-ink";
  if (picked)
    return "bg-surface-hi text-fg-hi shadow-[inset_0_0_0_1px_var(--color-brass-line)]";
  return "bg-surface text-fg-mid";
}

const smallAction =
  "label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

export default function Keno({
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
  onPlay: (game: "keno", choice: string) => Promise<PlayResult | null>;
  onSettle: (result: PlayResult) => void;
}) {
  // 고른 수는 판이 끝나도 남는다 — 같은 번호로 계속 거는 게 이 게임의 기본 자세다.
  const [picks, setPicks] = useState<number[]>([]);
  // 지금까지 켜진 수. 추첨 중에는 앞에서부터 채워지고, 끝나면 열 개가 된다.
  const [shown, setShown] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [done, setDone] = useState(false);

  const timeouts = useRef<number[]>([]);
  const { hold, settle } = usePendingSettle(onSettle);

  // 추첨 도중 화면을 떠나면 타이머를 치운다. 정산은 usePendingSettle 이
  // 대신 흘려보내므로 잠금은 남지 않는다.
  useEffect(() => {
    const pending = timeouts;
    return () => {
      pending.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const locked = disabled || drawing;
  const shownSet = new Set(shown);
  const hitCount = picks.filter((n) => shownSet.has(n)).length;

  /** 지난 회차의 불을 끈다. 새 선택 밑에 옛 결과가 남으면 판이 거짓말을 한다. */
  function clearBoard() {
    setShown([]);
    setDone(false);
  }

  function toggle(n: number) {
    if (locked) return;
    if (done) clearBoard();
    setPicks((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      // 다 찼으면 조용히 바꿔치지 않는다 — 몇 개 골랐는지 읽을 수 없게 된다.
      if (prev.length >= getRules().keno.picks) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  }

  async function press() {
    if (locked || picks.length !== getRules().keno.picks) return;

    const result = await onPlay("keno", picks.join(","));
    if (!result) return;

    const outcome = result.outcome as KenoOutcome;
    const draw = outcome.draw;

    hold(result);
    clearBoard();
    setDrawing(true);

    timeouts.current = [];
    draw.forEach((n, i) => {
      const t = window.setTimeout(() => {
        setShown((prev) => [...prev, n]);
      }, LEAD_IN + i * STEP);
      timeouts.current.push(t);
    });

    const finish = window.setTimeout(
      () => {
        // 위 타이밍이 어떻게 꼬여도 최종 화면은 서버 결과와 반드시 같아야 한다.
        setShown(draw);
        setDrawing(false);
        setDone(true);
        settle();
      },
      LEAD_IN + (draw.length - 1) * STEP + TAIL,
    );
    timeouts.current.push(finish);
  }

  const left = getRules().keno.picks - picks.length;
  const buttonLabel = drawing
    ? KENO_DRAWING_NOTE
    : left > 0
      ? kenoPickPrompt(left)
      : `${bet} 코인으로 추첨`;
  const canPress = !locked && left === 0 && !blockedRow;

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-bg-1 grid grid-cols-1 gap-4 p-2 desk:grid-cols-[104px_minmax(0,1fr)_244px] desk:gap-4 desk:p-4">
        {/* [1] 배당 레일 — 높은 것부터 */}
        <div className="grid grid-cols-2 gap-1 tab:grid-cols-4 desk:grid-cols-1">
          <MonoLabel className="hidden desk:block">{LABEL.mult}</MonoLabel>
          {kenoTiers().map((k) => (
            <div
              key={k}
              className={`state-fade flex min-h-9 flex-1 items-center justify-between gap-1 px-2 ${
                done && hitCount === k
                  ? "border-brass-line border bg-brass-fill"
                  : "bg-surface"
              }`}
            >
              <span className="mono-13 text-fg-mid tabular-nums">{k}개</span>
              <span className="mono-13 text-fg tabular-nums">×{kenoMult(k)}</span>
            </div>
          ))}
        </div>

        {/* [2] 번호판 */}
        <div className="flex min-h-0 flex-col justify-center gap-2.5 desk:min-h-[340px]">
          <div className="flex items-center justify-between gap-2">
            <MonoLabel>
              고른 수 {picks.length}/{getRules().keno.picks}
            </MonoLabel>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (done) clearBoard();
                  setPicks(randomPicks());
                }}
                className={smallAction}
              >
                무작위
              </button>
              <button
                type="button"
                disabled={locked || picks.length === 0}
                onClick={() => {
                  if (done) clearBoard();
                  setPicks([]);
                }}
                className={smallAction}
              >
                지움
              </button>
            </div>
          </div>

          <div className="grid grid-cols-8 gap-1 tab:grid-cols-10">
            {Array.from({ length: getRules().keno.range }, (_, i) => i + 1).map((n) => {
              const picked = picks.includes(n);
              const drawn = shownSet.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={locked}
                  aria-pressed={picked}
                  onClick={() => toggle(n)}
                  className={`state-fade flex min-h-11 items-center justify-center font-mono text-sm font-bold ${cellFace(
                    picked,
                    drawn,
                  )} ${picked && drawn ? "keno-hit" : ""}`}
                >
                  {n}
                </button>
              );
            })}
          </div>

          {/* 읽는 줄. 자리를 늘 비워 둬서 추첨이 돌아도 판이 밀리지 않는다. */}
          <div className="bg-surface flex flex-col gap-1 p-2.5">
            <div className="grid grid-cols-[52px_minmax(0,1fr)] items-baseline gap-2">
              <MonoLabel>고른 수</MonoLabel>
              <span className="mono-13 text-fg-hi tabular-nums">
                {picks.length > 0 ? picks.join(" · ") : "—"}
              </span>
            </div>
            <div className="grid min-h-[42px] grid-cols-[52px_minmax(0,1fr)] items-baseline gap-2">
              <MonoLabel>나온 수</MonoLabel>
              <span className="mono-13 text-fg tabular-nums">
                {shown.length > 0
                  ? shown.join(" · ")
                  : drawing
                    ? KENO_DRAWING_NOTE
                    : "—"}
              </span>
            </div>
            <div className="grid min-h-6 grid-cols-[52px_minmax(0,1fr)] items-baseline gap-2">
              <MonoLabel>적중</MonoLabel>
              <span className="mono-13 text-fg-hi tabular-nums">
                {shown.length > 0 ? `${hitCount}개` : "—"}
              </span>
            </div>
          </div>

          {/* 세 얼굴이 무슨 뜻인지 적어 둔다. 색으로 짐작하게 두지 않는다. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {[
              { face: cellFace(true, false), label: "고른 수" },
              { face: cellFace(false, true), label: "나온 수" },
              { face: cellFace(true, true), label: "적중" },
            ].map((it) => (
              <span key={it.label} className="flex items-center gap-1.5">
                <span className={`inline-block h-3.5 w-3.5 ${it.face}`} />
                <MonoLabel tone="low">{it.label}</MonoLabel>
              </span>
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
              ×{kenoMult(getRules().keno.picks)}
            </span>
          </div>
          <div className="bg-surface col-span-2 hidden flex-1 flex-col justify-end gap-1.5 p-3 desk:flex">
            <span className="body-15 text-fg-mid">
              {done
                ? kenoMatchLine(hitCount)
                : `다섯 개를 고르면 서버가 ${getRules().keno.draws}개를 뽑습니다.`}
            </span>
            <span className="body-15 text-fg">
              두 개만 맞혀도 {kenoMult(2)}배입니다.
            </span>
          </div>
        </div>
      </div>

      {betSlot}

      {blockedRow ?? (
        <button
          type="button"
          disabled={!canPress}
          onClick={press}
          className={`state-fade title-19 min-h-15 border desk:min-h-23 ${
            canPress
              ? "border-brass-line bg-brass-fill text-fg-hi"
              : "border-line-soft bg-bg-1 text-fg-low"
          }`}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
