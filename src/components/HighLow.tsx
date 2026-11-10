"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CARD_LABELS,
  HL_CHOICES,
  HL_MAX_STAGE,
  hlMult,
  hlNextPot,
  hlWinChance,
  type HighLowChoice,
  type HighLowOutcome,
  type PlayResult,
  type PlayerState,
} from "@/lib/game";
import {
  DEALING_NOTE,
  highLowPrompt,
  LABEL,
  POT_WARNING,
  stageNote,
  VERDICT,
} from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";
import { usePendingSettle } from "@/hooks/usePendingSettle";

/**
 * 하이로우 — 이 프로젝트에서 가장 오래된 판이고, 나머지 화면의 골격이 여기서 나왔다.
 *
 * 카드는 화면에서 가장 큰 요소다. 잔액보다 크다. 판에 앉은 사람이
 * 실제로 보고 있는 건 그것뿐이기 때문이다.
 */

/** 클릭 → 뒤집기 시작까지 한 박자. 뒤집기 자체는 globals.css 의 .flip-card 140ms. */
const DEAL_MS = 260;
/** 공개된 패와 판정문을 그대로 보여주는 시간 */
const HOLD_MS = 900;
/** 다음 패가 현재 패 자리로 건너가는 시간 */
const SLIDE_MS = 180;
/** 실패·완주·회수 뒤 판정문을 붙잡아 두는 시간 */
const END_MS = 1400;

/** 색만으로는 구분하지 않는다. 아이콘과 라벨이 항상 함께 간다. */
const PICK_ACCENT: Record<HighLowChoice, string> = {
  high: "border-t-pick-high",
  same: "border-t-pick-same",
  low: "border-t-pick-low",
};

const CARD_BOX =
  "h-[140px] w-[104px] tab:h-[210px] tab:w-[150px] desk:h-[296px] desk:w-[206px]";
const CARD_NUM =
  "font-mono font-bold leading-[0.9] text-[52px] tab:text-[84px] desk:text-[120px]";

const FaceUpCard = forwardRef<HTMLDivElement, { value: number; className?: string }>(
  function FaceUpCard({ value, className }, ref) {
    return (
      <div
        ref={ref}
        className={`${CARD_BOX} border-card-edge flex flex-col items-center justify-center gap-0.5 rounded-[2px] border bg-card-face shadow-[inset_0_0_0_5px_var(--color-card-inset)] ${className ?? ""}`}
      >
        <span className={`${CARD_NUM} text-card-ink`}>{CARD_LABELS[value]}</span>
        <span className="mono-13 text-card-ink-dim hidden tab:inline">
          {value} / 13
        </span>
      </div>
    );
  },
);

/** 뒷면에서 앞면으로 140ms. 그 이상 끌면 연출이 되고, 이건 연출이 아니다. */
const FlipCard = forwardRef<
  HTMLDivElement,
  { value: number | null; flipped: boolean; className?: string }
>(function FlipCard({ value, flipped, className }, ref) {
  return (
    <div ref={ref} className={`${CARD_BOX} flip-stage ${className ?? ""}`}>
      <div className="flip-card" data-flipped={flipped}>
        <div className="flip-face card-hatch border-line flex items-center justify-center border bg-surface">
          <span className="label-11 text-fg-low tracking-[0.2em]">K-77</span>
        </div>
        <div className="flip-face flip-face-back border-card-edge flex flex-col items-center justify-center gap-0.5 border bg-card-face shadow-[inset_0_0_0_5px_var(--color-card-inset)]">
          <span className={`${CARD_NUM} text-card-ink`}>
            {value ? CARD_LABELS[value] : ""}
          </span>
          <span className="mono-13 text-card-ink-dim hidden tab:inline">
            {value ?? "-"} / 13
          </span>
        </div>
      </div>
    </div>
  );
});

export default function HighLow({
  state,
  bet,
  disabled,
  blockedRow,
  betSlot,
  onStart,
  onContinue,
  onCashout,
  onSettle,
}: {
  state: PlayerState;
  bet: number;
  disabled: boolean;
  /** 판에 앉을 수 없을 때 3버튼 자리를 대신 채우는 한 줄. Casino 가 만든다. */
  blockedRow: React.ReactNode | null;
  /** 베팅 조절기. 상태는 Casino 가 들고 있어서 자리만 받아 끼운다. */
  betSlot: React.ReactNode;
  /** 판을 연다 — 판돈을 걸고 패를 뽑는다. 이후엔 onContinue 로만 진행한다. */
  onStart: () => Promise<PlayResult | null>;
  onContinue: (choice: HighLowChoice) => Promise<PlayResult | null>;
  onCashout: () => Promise<PlayResult | null>;
  onSettle: (result: PlayResult) => void;
}) {
  /** idle = 연출 없음(화면이 곧 서버 상태). 나머지 셋은 연출 중이다. */
  const [phase, setPhase] = useState<"idle" | "dealing" | "reveal" | "promote">(
    "idle",
  );
  const [revealed, setRevealed] = useState<HighLowOutcome | null>(null);
  const leftCardRef = useRef<HTMLDivElement>(null);
  const rightCardRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  // clearTimers 가 finish 로 가는 타이머를 지우면 onSettle 이 영영 안 불려
  // 화면이 잠긴 채 남는다. 정산할 결과를 맡겨 두고 언마운트 때 흘려보낸다.
  const { hold, settle } = usePendingSettle(onSettle);

  function clearTimers() {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }
  function schedule(fn: () => void, ms: number) {
    timers.current.push(window.setTimeout(fn, ms));
  }
  useEffect(() => clearTimers, []);

  /** 방금 뽑힌 다음 패가 "현재 패" 자리로 건너가는 거리를 실측해 CSS 변수로 넘긴다.
   *  화면 폭마다 카드 칸 크기·간격이 달라서 상수로 둘 수 없다. */
  useLayoutEffect(() => {
    if (phase !== "promote") return;
    const left = leftCardRef.current;
    const right = rightCardRef.current;
    if (!left || !right) return;
    const dx = left.getBoundingClientRect().left - right.getBoundingClientRect().left;
    right.style.setProperty("--hl-slide", `${dx}px`);
  }, [phase]);

  /** 판이 열려 있다 — 0단계(패를 보고 아직 안 고른 상태)도 포함한다. */
  const armed = state.hl_bet > 0;
  /** 적립금이 쌓여 있다 — 회수할 수 있다. */
  const ladder = state.hl_stage > 0;
  const currentCard = state.hl_card;
  const stageForNext = state.hl_stage + 1;
  // 첫 판정의 기준액은 판돈 + 추석 송편이 얹은 몫(hl_bonus)이다 — 서버 highlow_continue 와 같다.
  const stakeNow = armed
    ? ladder
      ? state.hl_pot
      : state.hl_bet + (state.hl_bonus ?? 0)
    : bet;
  const busy = phase !== "idle" || disabled;

  /** 연출 없이 즉시 서버 상태를 반영하고 idle 로 돌아간다. 모든 갈래가 여기 하나로 모인다 —
   *  화면이 서버보다 앞서갈 자리를 아예 만들지 않는다. */
  function finish() {
    settle();
    setPhase("idle");
    setRevealed(null);
  }

  /** 판정을 받아 공개 → 유지 → (적중이면) 이동 순서로 진행한다. */
  function runReveal(result: PlayResult) {
    const outcome = result.outcome as HighLowOutcome;
    hold(result);
    schedule(() => {
      setRevealed(outcome);
      setPhase("reveal");
      schedule(() => {
        if (outcome.result === "win") {
          setPhase("promote");
          schedule(finish, SLIDE_MS);
        } else {
          schedule(finish, END_MS);
        }
      }, HOLD_MS);
    }, DEAL_MS);
  }

  async function guess(choice: HighLowChoice) {
    if (busy) return;
    clearTimers();
    setPhase("dealing");
    setRevealed(null);
    const result = await onContinue(choice);
    if (!result) {
      setPhase("idle");
      return;
    }
    runReveal(result);
  }

  /** 판을 연다 — 패가 뽑히자마자 바로 보여준다. 연출은 없다. */
  async function start() {
    if (busy) return;
    const result = await onStart();
    if (result) onSettle(result);
  }

  /** 회수는 새 패를 뽑지 않으므로 뒤집기 없이 판정문만 잠깐 띄운다. */
  async function cashout() {
    if (busy) return;
    clearTimers();
    const result = await onCashout();
    if (!result) return;
    hold(result);
    setRevealed(result.outcome as HighLowOutcome);
    setPhase("reveal");
    schedule(finish, END_MS);
  }

  // 오른쪽 "다음 패"는 뒤집기(reveal)·이동(promote) 중에만 앞면이다.
  // 회수는 새 패를 뽑지 않으므로 뒤집지 않는다.
  const showFlip =
    (phase === "reveal" || phase === "promote") && revealed?.result !== "cashout";
  // 왼쪽 "현재 패"는 판이 열려 있는 동안(armed) 계속 보이고, 판이 끝난 뒤에도
  // 결과를 보여주는 동안(showFlip)에는 방금 있었던 패를 그대로 유지한다.
  const openCard = armed || showFlip;
  // 연출 중에는 항상 revealed.from 을 쓴다 — idle 이면 revealed 가 null 이라
  // 자연히 state.hl_card(서버 값)로 수렴한다. 어긋날 자리가 없다.
  const leftValue = revealed?.from ?? currentCard;
  const verdict =
    revealed?.result === "lose"
      ? VERDICT.lose
      : revealed?.result === "cleared"
        ? VERDICT.cleared
        : revealed?.result === "cashout"
          ? VERDICT.cashout
          : revealed?.result === "win"
            ? VERDICT.win
            : ladder
              ? VERDICT.hold
              : null;
  const lost = revealed?.result === "lose";

  return (
    <div className="flex flex-col gap-2">
      {/* ── 히어로: 배율 레일 | 패 | 건 코인·적립금 ── */}
      <div className="bg-bg-1 grid grid-cols-1 gap-2 p-2 tab:gap-2 desk:grid-cols-[104px_minmax(0,1fr)_244px] desk:gap-4 desk:p-4">
        {/* [1] 배율 레일 — 올라간 만큼만 밝다 */}
        <div className="flex flex-row gap-1 desk:flex-col">
          <MonoLabel className="hidden desk:block">{LABEL.mult}</MonoLabel>
          {Array.from({ length: HL_MAX_STAGE }, (_, i) => {
            const stage = i + 1;
            const done = state.hl_stage >= stage;
            const next = stage === stageForNext;
            const step = state.hl_steps.find((s) => s.stage === stage && s.win);
            return (
              <div
                key={stage}
                className={`state-fade flex min-h-9 flex-1 flex-col items-center justify-center border px-1 desk:flex-row desk:justify-between desk:gap-1 desk:px-2 ${
                  next
                    ? "border-brass-line bg-brass-fill text-fg-hi"
                    : done
                      ? "border-line bg-surface-hi text-fg"
                      : "border-transparent bg-surface text-fg-low"
                }`}
              >
                <span className="label-11">{stage}단계</span>
                <span className="mono-13 tabular-nums">
                  {step?.mult !== undefined ? `×${step.mult}` : "×?"}
                </span>
              </div>
            );
          })}
        </div>

        {/* [2] 패 — 화면 최대 요소 */}
        <div className="flex min-h-0 flex-col items-center justify-center gap-2.5 desk:min-h-[340px]">
          <div className="flex items-end gap-2.5 desk:gap-5">
            <div className="flex flex-col items-center gap-2">
              <MonoLabel tone="low">{LABEL.current}</MonoLabel>
              {/* 판이 열려 있지 않고 보여줄 결과도 없으면(둘 다 아니면)
                  뒷면이다 — 걸기 전에는 보일 패 자체가 없다. */}
              {openCard ? (
                <FaceUpCard
                  ref={leftCardRef}
                  value={leftValue}
                  className={phase === "promote" ? "hl-retire" : ""}
                />
              ) : (
                <FlipCard ref={leftCardRef} value={null} flipped={false} />
              )}
            </div>

            <span aria-hidden className="text-fg-low pb-16 text-xl desk:pb-32">
              →
            </span>

            <div className="flex flex-col items-center gap-2">
              <MonoLabel tone="low">{LABEL.next}</MonoLabel>
              <FlipCard
                ref={rightCardRef}
                value={showFlip ? revealed!.next : null}
                flipped={showFlip}
                className={phase === "promote" ? "hl-slide" : ""}
              />
            </div>
          </div>

          {/* 판정 — 한 줄. 자리를 title-19 높이로 고정해 결과가 떠도 안 밀린다. */}
          <div className="flex min-h-7 items-center gap-2">
            {phase === "dealing" ? (
              <span className="mono-13 text-fg-low">{DEALING_NOTE}</span>
            ) : (
              verdict && (
                <>
                  <span
                    className={`title-19 ${lost ? "text-loss" : "text-brass"}`}
                  >
                    {verdict.word}
                  </span>
                  <span className="mono-13 text-fg-mid hidden tab:inline">
                    {verdict.note}
                  </span>
                </>
              )
            )}
          </div>
        </div>

        {/* [3] 건 코인 · 적립금 · 단계 */}
        <div className="grid grid-cols-2 gap-2 desk:flex desk:flex-col">
          <div className="bg-surface flex flex-col gap-1 p-3">
            <MonoLabel>{LABEL.stake}</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">{stakeNow}</span>
          </div>

          <div className="border-brass-line flex flex-col gap-1 border bg-brass-fill p-3">
            <MonoLabel>{LABEL.pot}</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">
              {state.hl_pot}
            </span>
          </div>

          <div className="bg-surface col-span-2 hidden flex-1 flex-col justify-end gap-1.5 p-3 desk:flex">
            <span className="body-15 text-fg-mid">
              {stageNote(stageForNext)}
            </span>
            <span className="body-15 text-fg">{POT_WARNING}</span>
          </div>
        </div>
      </div>

      {/* ── 베팅 조절 ── */}
      {betSlot}

      {/* ── 선택 ── */}
      {blockedRow ??
        (armed ? (
          <>
            <p className="body-15 text-fg-mid">
              {highLowPrompt(currentCard)}
              {!ladder && (
                <>
                  <br className="tab:hidden" />
                  <span className="text-fg-low">
                    <span className="hidden tab:inline"> </span>
                    {state.hl_bet} 코인을 걸었다.
                    {(state.hl_bonus ?? 0) > 0 && ` 보너스 ${state.hl_bonus} 코인이 얹혔습니다.`}
                  </span>
                </>
              )}
            </p>

            <div className="grid grid-cols-3 gap-1.5">
              {HL_CHOICES.map((c) => {
                const chance = hlWinChance(currentCard, c.id);
                const mult = hlMult(currentCard, c.id, stageForNext);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy || chance === 0}
                    onClick={() => guess(c.id)}
                    className={`state-fade flex min-h-15 flex-col items-center justify-center gap-1 border-t-2 desk:min-h-23 ${
                      PICK_ACCENT[c.id]
                    } ${
                      busy || chance === 0
                        ? "bg-surface text-fg-low"
                        : "bg-surface-hi text-fg-hi"
                    }`}
                  >
                    <span className="title-19">
                      {c.mark} {c.label}
                    </span>
                    <span className="mono-13 text-fg-mid">
                      <span className="hidden tab:inline">적중률 </span>
                      {Math.round(chance * 100)}%
                      {chance > 0 && ` · ×${mult}`}
                    </span>
                    {chance > 0 && (
                      <span className="mono-13 text-fg-low hidden desk:inline">
                        → {hlNextPot(stakeNow, currentCard, c.id, stageForNext)} 코인
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={start}
            className={`state-fade title-19 min-h-15 border desk:min-h-23 ${
              busy
                ? "border-line-soft bg-bg-1 text-fg-low"
                : "border-brass-line bg-brass-fill text-fg-hi"
            }`}
          >
            {busy ? "여는 중" : `${bet} 코인으로 시작`}
          </button>
        ))}

      {/* ── 회수 ── */}
      <button
        type="button"
        disabled={busy || !ladder || state.hl_pot <= 0}
        onClick={cashout}
        className={`state-fade title-19 min-h-12 border ${
          ladder && state.hl_pot > 0 && !busy
            ? "border-brass-line bg-brass-fill text-fg-hi"
            : "border-line-soft bg-bg-1 text-fg-low"
        }`}
      >
        {ladder && state.hl_pot > 0
          ? `${state.hl_pot} 코인 받고 끝내기`
          : "받아갈 적립금 없음"}
      </button>
    </div>
  );
}
