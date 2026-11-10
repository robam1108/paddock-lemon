"use client";

import { useEffect, useRef, useState } from "react";
import { CARD_LABELS, PVP_GAMES, type PvpMatch } from "@/lib/game";
import { LABEL } from "@/lib/copy";
import { useCountdown } from "@/hooks/useCountdown";
import DiceRow from "./DiceRow";
import MonoLabel from "./ui/MonoLabel";

/**
 * 1:1 대전 진행 화면.
 *
 * Arena 라 알려주는 게 적다 — 판돈과 남은 초, 그리고 지금까지의 승패만
 * 보인다. 상대가 뭘 쥐고 있는지, 이길 확률이 얼마인지는 아무도 안 알려준다.
 */

const ROLL_MS = 1100;

const CARD_BOX =
  "h-[140px] w-[104px] tab:h-[186px] tab:w-[132px] desk:h-[210px] desk:w-[150px]";
const CARD_NUM =
  "font-mono font-bold leading-[0.9] text-[52px] tab:text-[68px] desk:text-[84px]";

function Card({
  value,
  label,
  hidden,
}: {
  value: number | null;
  label: string;
  hidden?: boolean;
}) {
  const covered = hidden || value === null;
  return (
    <div className="flex flex-col items-center gap-2">
      <MonoLabel tone="low">{label}</MonoLabel>
      {covered ? (
        <div
          className={`${CARD_BOX} card-hatch border-line flex items-center justify-center rounded-[2px] border bg-surface`}
        >
          <span className="label-11 text-fg-low tracking-[0.2em]">PADDOCK</span>
        </div>
      ) : (
        <div
          className={`${CARD_BOX} border-card-edge flex flex-col items-center justify-center gap-0.5 rounded-[2px] border bg-card-face shadow-[inset_0_0_0_5px_var(--color-card-inset)]`}
        >
          <span className={`${CARD_NUM} text-card-ink`}>
            {CARD_LABELS[value]}
          </span>
          <span className="mono-13 text-card-ink-dim hidden tab:inline">
            {value} / 13
          </span>
        </div>
      )}
    </div>
  );
}

/** 지금까지의 판 결과. 승패만 남기고 숫자는 옆에 붙인다. */
function Scoreboard({ match }: { match: PvpMatch }) {
  return (
    <div className="bg-surface flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="num-md text-fg-hi tabular-nums">
          {match.my_wins}
          <span className="text-fg-low"> : </span>
          {match.their_wins}
        </span>
        <MonoLabel tone="low">
          {match.opponent} · {match.wins_needed}판 선취
        </MonoLabel>
      </div>

      {match.history.length > 0 && (
        <ul className="flex flex-col">
          {match.history.map((h) => (
            <li
              key={h.round}
              className="mono-13 border-line-soft grid grid-cols-[38px_minmax(0,1fr)_38px] items-baseline gap-2 border-t py-1.5"
            >
              <span className="text-fg-low tabular-nums">{h.round}판</span>
              <span className="text-fg tabular-nums">
                {match.game === "dice"
                  ? (h.mine as number[]).reduce((a, b) => a + b, 0)
                  : match.game === "blackjack"
                    ? h.mine
                    : CARD_LABELS[h.mine as number]}
                <span className="text-fg-low"> vs </span>
                {match.game === "dice"
                  ? (h.theirs as number[]).reduce((a, b) => a + b, 0)
                  : match.game === "blackjack"
                    ? h.theirs
                    : CARD_LABELS[h.theirs as number]}
              </span>
              <span
                className={`text-right ${
                  h.won === null
                    ? "text-fg-low"
                    : h.won
                      ? "text-brass"
                      : "text-loss"
                }`}
              >
                {h.won === null ? "무" : h.won ? "승" : "패"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 블랙잭 한쪽 손패 — 작은 카드 칩을 늘어놓고 점수를 붙인다. */
function BjSide({
  label,
  hand,
  score,
  stand,
  active,
}: {
  label: string;
  hand: number[];
  score: number;
  stand: boolean;
  active: boolean;
}) {
  const bust = score > 21;
  return (
    <div
      className={`flex flex-col gap-2 border p-3 ${
        active ? "border-brass-line bg-brass-fill" : "border-line-soft bg-surface"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <MonoLabel tone={active ? "dim" : "low"}>{label}</MonoLabel>
        <span
          className={`num-md tabular-nums ${bust ? "text-loss" : "text-fg-hi"}`}
        >
          {score}
          {bust && <span className="mono-13 text-loss"> 버스트</span>}
          {!bust && stand && <span className="mono-13 text-fg-low"> 스탠드</span>}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {hand.map((c, i) => (
          <span
            key={i}
            className="border-card-edge bg-card-face text-card-ink flex h-11 w-8 items-center justify-center rounded-[2px] border font-mono text-[19px] font-bold"
          >
            {CARD_LABELS[c]}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 에이스 값 고르기 팝업.
 *
 * 에이스가 뜨는 순간 뜬다. 지금까지의 점수(이 에이스는 빼고 집계한 값)를
 * 보여주고 1과 11 중 하나를 고르게 한다 — 한 번 고르면 못 바꾼다.
 */
function AceChoicePopup({
  score,
  busy,
  onChoose,
}: {
  score: number;
  busy: boolean;
  onChoose: (value: 1 | 11) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg-0/80 p-4 tab:items-center">
      <div className="border-line w-full max-w-sm border bg-bg-1">
        <div className="border-line-soft border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">에이스 값 결정</MonoLabel>
        </div>
        <div className="flex flex-col gap-1 p-4">
          <p className="title-19 text-fg-hi">에이스가 나왔습니다. 1과 11 중 하나를 고르세요.</p>
          <p className="body-15 text-fg-mid">
            한 번 고르면 바꿀 수 없습니다.
          </p>
          <p className="mono-13 text-fg-low">
            지금 점수(이 에이스 제외) {score}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose(1)}
              className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid disabled:text-fg-low"
            >
              1로
              <span className="mono-13 text-fg-low block">합계 {score + 1}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose(11)}
              className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
            >
              11로
              <span className="mono-13 text-fg-mid block">합계 {score + 11}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MatchView({
  match,
  busy,
  onAct,
  onRoll,
  onAce,
  onCancel,
  onClose,
}: {
  match: PvpMatch;
  busy: boolean;
  onAct: (action: "call" | "fold" | "hit" | "stand") => void;
  onRoll: () => Promise<boolean>;
  onAce: (value: 1 | 11) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const gameName = PVP_GAMES.find((g) => g.id === match.game)?.name ?? "";
  const pot = match.bet * 2;
  const left = useCountdown(match.expires_in);

  const [spinning, setSpinning] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function roll() {
    if (busy || spinning) return;
    setSpinning(true);
    const ok = await onRoll();
    timer.current = window.setTimeout(() => setSpinning(false), ok ? ROLL_MS : 0);
  }

  const primary =
    "state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low";
  const secondary =
    "state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid disabled:text-fg-low";

  /** 판 머리. 어느 판이고 얼마가 걸렸는지만 적는다. */
  const Head = () => (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <MonoLabel tone="low">
        {gameName} · {match.opponent} · {match.round}판
      </MonoLabel>
      <div className="flex items-baseline gap-2">
        <MonoLabel>판돈</MonoLabel>
        <span className="num-md text-brass tabular-nums">{pot}</span>
      </div>
    </div>
  );

  /* ── 신청 보낸 뒤 대기 ── */
  if (match.status === "invited") {
    return (
      <div className="bg-bg-1 flex flex-col gap-2 p-4">
        <MonoLabel tone="low">응답 대기</MonoLabel>
        <p className="title-19 text-fg-hi">
          {match.opponent}의 답을 기다리는 중.
        </p>
        <p className="mono-13 text-fg-mid">
          {gameName} · {match.bet} 코인 · {left}초 남음
        </p>
        {match.role === "host" && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={`${secondary} mt-2`}
          >
            신청 취소
          </button>
        )}
      </div>
    );
  }

  /* ── 대전 종료 ── */
  if (match.status === "done" && !spinning) {
    return (
      <div className="bg-bg-1 flex flex-col gap-2 p-4">
        <Head />
        <Scoreboard match={match} />

        {match.result?.reason === "timeout" && (
          <p className="mono-13 text-fg-mid">
            {match.result.forfeited === match.role
              ? "시간 초과. 기권 처리됐습니다."
              : "상대가 시간 안에 답하지 않았습니다."}
          </p>
        )}
        {match.result?.reason === "bust" && (
          <p className="mono-13 text-fg-mid">
            21을 넘겨 버스트로 끝났습니다.
          </p>
        )}
        {match.result?.reason === "blackjack" && (
          <p className="mono-13 text-fg-mid">
            첫 두 장으로 블랙잭이 나와 그 판이 바로 끝났습니다.
          </p>
        )}

        {/* 이겨도 축하는 없다. 무슨 일이 있었는지만 적힌다. */}
        <p
          className={`title-19 ${
            match.tie ? "text-fg" : match.won ? "text-brass" : "text-loss"
          }`}
        >
          {match.tie
            ? "무승부. 건 코인은 그대로 돌아왔습니다."
            : match.won
              ? `${pot} 코인 회수.`
              : `${match.bet} 코인 손실.`}
        </p>

        <button type="button" onClick={onClose} className={`${primary} mt-2`}>
          새 대전
        </button>
      </div>
    );
  }

  /* ── 배틀주사위 진행 중 ── */
  if (match.game === "dice") {
    const rolled = !!match.my_roll;

    return (
      <div className="bg-bg-1 flex flex-col gap-3 p-4">
        <Head />
        <Scoreboard match={match} />

        <div className="flex items-start justify-center gap-4 desk:gap-8">
          <div className="flex flex-col items-center gap-2">
            <MonoLabel tone="low">나</MonoLabel>
            <DiceRow
              values={spinning ? null : match.my_roll}
              rolling={spinning || !rolled}
              hidden={!rolled}
            />
            <span className="num-md text-fg-hi tabular-nums">
              {rolled && !spinning
                ? match.my_roll!.reduce((a, b) => a + b, 0)
                : "—"}
            </span>
          </div>

          <span aria-hidden className="text-fg-low self-center text-lg">
            vs
          </span>

          <div className="flex flex-col items-center gap-2">
            <MonoLabel tone="low">{match.opponent}</MonoLabel>
            <DiceRow values={null} hidden rolling={!match.opponent_rolled} />
            <MonoLabel tone="low">
              {match.opponent_rolled ? "굴림 완료" : "대기"}
            </MonoLabel>
          </div>
        </div>

        {!rolled ? (
          <>
            <p className="mono-13 text-fg-mid">
              {left}초 안에 굴리지 않으면 기권 처리됩니다.
            </p>
            <button
              type="button"
              disabled={busy || spinning}
              onClick={roll}
              className={primary}
            >
              {spinning ? "구르는 중" : "주사위 굴리기"}
            </button>
          </>
        ) : (
          <p className="mono-13 text-fg-mid">
            {match.opponent_rolled
              ? "결과 계산 중"
              : `${match.opponent} 대기 중 · ${left}초`}
          </p>
        )}
      </div>
    );
  }

  /* ── 블랙잭 진행 중 ── */
  if (match.game === "blackjack") {
    const myHand = match.my_hand ?? [];
    const theirHand = match.their_hand ?? [];
    const pendingAce = !!match.my_pending_ace;
    const canAct = match.my_turn && !match.my_stand && !pendingAce;

    return (
      <div className="bg-bg-1 flex flex-col gap-3 p-4">
        {pendingAce && (
          <AceChoicePopup
            score={match.my_score ?? 0}
            busy={busy}
            onChoose={onAce}
          />
        )}

        <Head />
        <Scoreboard match={match} />

        <div className="flex flex-col gap-2">
          <BjSide
            label="나"
            hand={myHand}
            score={match.my_score ?? 0}
            stand={!!match.my_stand}
            active={match.my_turn}
          />
          <BjSide
            label={match.opponent}
            hand={theirHand}
            score={match.their_score ?? 0}
            stand={!!match.their_stand}
            active={!match.my_turn}
          />
        </div>

        {canAct ? (
          <>
            <p className="mono-13 text-fg-mid">
              내 차례입니다. {left}초 안에 골라 주세요.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => onAct("hit")}
                className={`${primary} flex flex-col gap-1`}
              >
                히트
                <span className="mono-13 text-fg-mid">한 장 더 받는다</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAct("stand")}
                className={`${secondary} flex flex-col gap-1`}
              >
                스탠드
                <span className="mono-13 text-fg-low">여기서 멈춘다</span>
              </button>
            </div>
          </>
        ) : (
          <p className="mono-13 text-fg-mid">
            {pendingAce
              ? "에이스 값을 먼저 정해 주세요."
              : match.their_pending_ace
                ? `${match.opponent}가 에이스 값을 고르는 중 · ${left}초`
                : match.my_stand
                  ? `스탠드했습니다. ${match.opponent} 차례 · ${left}초`
                  : `${match.opponent} 고민 중 · ${left}초`}
          </p>
        )}
      </div>
    );
  }

  /* ── 인디언포커 진행 중 ── */
  return (
    <div className="bg-bg-1 flex flex-col gap-3 p-4">
      <Head />
      <Scoreboard match={match} />

      <div className="flex items-start justify-center gap-3 desk:gap-6">
        <Card value={null} label={`내 ${LABEL.current}`} hidden />
        <span aria-hidden className="text-fg-low self-center text-lg">
          vs
        </span>
        <Card value={match.opponent_card} label={match.opponent} />
      </div>

      {match.my_turn ? (
        <>
          <p className="mono-13 text-fg-mid">
            내 차례입니다. {left}초 안에 골라 주세요.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct("call")}
              className={`${primary} flex flex-col gap-1`}
            >
              콜
              <span className="mono-13 text-fg-mid">패를 깐다</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct("fold")}
              className={`${secondary} flex flex-col gap-1`}
            >
              다이
              <span className="mono-13 text-fg-low">이 판을 넘긴다</span>
            </button>
          </div>
        </>
      ) : (
        <p className="mono-13 text-fg-mid">
          {match.opponent} 고민 중 · {left}초
        </p>
      )}
    </div>
  );
}
