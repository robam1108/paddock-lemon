"use client";

import { useEffect, useRef, useState } from "react";
import type { LastCardView } from "@/lib/game";
import MonoLabel from "./ui/MonoLabel";

/**
 * 라스트 카드 — 밀거래를 거는 승부.
 *
 * 판정은 전부 서버(lastcard_play RPC)가 한다. 이 컴포넌트는 하이로우
 * (HighLow.tsx) 와 같은 두 단계 정산 방식을 쓴다 — 결과는 이미 나와 있고,
 * 화면은 그걸 살짝 늦춰서 보여줄 뿐이다. 상대 카드가 안 보이는 동안은
 * 뒷면(K-77)만 그리고, 낸 순간에도 바로 드러내지 않는다.
 */

const FLIP_MS = 900;
const RESULT_MS = 500;
const HOLD_MS = 900;
const DONE_MS = 2000;

const TOTAL_CARDS = 3;

const CARD_BOX = "h-[92px] w-[66px] tab:h-[128px] tab:w-[92px]";
const CARD_NUM = "font-mono font-bold leading-none text-[32px] tab:text-[46px]";

function CardBack() {
  return (
    <div
      className={`${CARD_BOX} card-hatch border-line flex items-center justify-center border bg-surface`}
    >
      <span className="label-11 text-fg-low tracking-[0.2em]">K-77</span>
    </div>
  );
}

function FlipSlot({ value, flipped }: { value: number; flipped: boolean }) {
  return (
    <div className={`${CARD_BOX} flip-stage`}>
      <div className="flip-card" data-flipped={flipped}>
        <div className="flip-face card-hatch border-line flex items-center justify-center border bg-surface">
          <span className="label-11 text-fg-low tracking-[0.2em]">K-77</span>
        </div>
        <div className="flip-face flip-face-back border-card-edge flex items-center justify-center border bg-card-face shadow-[inset_0_0_0_4px_var(--color-card-inset)]">
          <span className={`${CARD_NUM} text-card-ink`}>{value}</span>
        </div>
      </div>
    </div>
  );
}

type Reveal = {
  mine: number;
  npc: number;
  flipped: boolean;
  showVerdict: boolean;
  committed: boolean;
};

export default function LastCard({
  game,
  busy,
  onPlay,
  onDone,
}: {
  game: LastCardView;
  busy: boolean;
  /** lastcard_play RPC 를 부르고 갱신된 판을 돌려준다. 실패하면 null. */
  onPlay: (card: number) => Promise<LastCardView | null>;
  /** 판이 완전히 끝나 결과를 다 보여준 뒤 — 부모가 smuggle_state 를 다시 읽는다 */
  onDone: () => void;
}) {
  const [view, setView] = useState(game);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const timers = useRef<number[]>([]);

  // 새 판(다른 id)이 오면 로컬 상태를 그 판으로 맞춘다.
  useEffect(() => setView(game), [game.id]);

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  async function play(card: number) {
    if (busy || reveal || view.status !== "playing") return;
    const round = view.my_played.length;
    const result = await onPlay(card);
    if (!result) return;
    const npcCard = result.npc_played[round];

    setReveal({
      mine: card,
      npc: npcCard,
      flipped: false,
      showVerdict: false,
      committed: false,
    });

    const t1 = window.setTimeout(() => {
      setReveal((r) => (r ? { ...r, flipped: true } : r));

      const t2 = window.setTimeout(() => {
        setView(result);
        setReveal((r) => (r ? { ...r, showVerdict: true, committed: true } : r));

        const holdMs = result.status !== "playing" ? DONE_MS : HOLD_MS;
        const t3 = window.setTimeout(() => {
          setReveal(null);
          if (result.status !== "playing") onDone();
        }, holdMs);
        timers.current.push(t3);
      }, RESULT_MS);
      timers.current.push(t2);
    }, FLIP_MS);
    timers.current.push(t1);
  }

  // committed 전에는 view 가 아직 이번 라운드를 반영하지 않은 값이라
  // 뒷면 한 장을 flip 슬롯에 내주려고 하나 더 뺀다.
  const npcBacks =
    TOTAL_CARDS - view.npc_played.length - (reveal && !reveal.committed ? 1 : 0);
  const handRemaining = view.my_cards.filter((c) => !reveal || c !== reveal.mine);

  const myWins = view.results.filter((r) => r === "me").length;
  const npcWins = view.results.filter((r) => r === "npc").length;
  const roundWin = reveal ? reveal.mine > reveal.npc : null;

  return (
    <div className="bg-bg-1 flex flex-col items-center gap-3 p-4">
      <div className="flex items-center gap-2">
        <MonoLabel tone="low">나</MonoLabel>
        <span className="num-md text-fg-hi tabular-nums">{myWins}</span>
        <span className="text-fg-low">－</span>
        <span className="num-md text-fg-hi tabular-nums">{npcWins}</span>
        <MonoLabel tone="low">상대</MonoLabel>
      </div>

      {/* 상대 패 — 남은 장수만큼 뒷면, 공개된 것은 남기지 않는다 */}
      <div className="flex gap-2">
        {Array.from({ length: Math.max(0, npcBacks) }).map((_, i) => (
          <CardBack key={`b${i}`} />
        ))}
        {reveal && <FlipSlot value={reveal.npc} flipped={reveal.flipped} />}
      </div>

      {/* 판정 한 줄 — 자리를 고정해 결과가 떠도 안 밀린다 */}
      <div className="flex min-h-7 items-center">
        {reveal?.showVerdict && (
          <span
            className={`title-19 ${roundWin ? "text-brass" : "text-loss"}`}
          >
            {roundWin ? "이 라운드 승리" : "이 라운드 패배"}
          </span>
        )}
        {!reveal && view.status !== "playing" && (
          <span
            className={`title-19 ${
              view.status === "won" ? "text-brass" : "text-loss"
            }`}
          >
            {view.status === "won" ? "승부 승리" : "승부 패배"}
          </span>
        )}
      </div>

      {/* 내 패 */}
      <div className="flex gap-2">
        {reveal && <FlipSlot value={reveal.mine} flipped={reveal.flipped} />}
        {handRemaining.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy || !!reveal || view.status !== "playing"}
            onClick={() => play(c)}
            className={`${CARD_BOX} border-card-edge state-fade flex items-center justify-center border bg-card-face shadow-[inset_0_0_0_4px_var(--color-card-inset)] enabled:hover:shadow-[inset_0_0_0_4px_var(--color-brass)] disabled:opacity-60`}
          >
            <span className={`${CARD_NUM} text-card-ink`}>{c}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
