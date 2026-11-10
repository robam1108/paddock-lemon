"use client";

import type { ReactNode } from "react";
import { gameList, type GameId, type PlayResult, type PlayerState } from "@/lib/game";
import { bonusTail, clockText, settleLine } from "@/lib/copy";
import Roulette from "../Roulette";
import Slots from "../Slots";
import HighLow from "../HighLow";
import Keno from "../Keno";
import TabRail from "../ui/TabRail";

/** Casual 구역 본문 — 게임 탭, 결과 한 줄, 서버 판정 4게임. */
export default function CasualTab({
  state,
  game,
  onGameChange,
  last,
  busy,
  canPlay,
  effectiveBet,
  blockedRow,
  betSlot,
  onPlay,
  onStartHighLow,
  onContinue,
  onCashout,
  onSettle,
}: {
  state: PlayerState;
  game: GameId;
  /** 탭을 바꾸면 결과 줄과 오류도 같이 지운다(Casino 쪽) */
  onGameChange: (id: GameId) => void;
  last: PlayResult | null;
  busy: boolean;
  canPlay: boolean;
  effectiveBet: number;
  blockedRow: ReactNode;
  betSlot: ReactNode;
  onPlay: (g: GameId, choice: string | null) => Promise<PlayResult | null>;
  onStartHighLow: () => Promise<PlayResult | null>;
  onContinue: (choice: string) => Promise<PlayResult | null>;
  onCashout: () => Promise<PlayResult | null>;
  onSettle: (result: PlayResult) => void;
}) {
  return (
    <>
      <TabRail
        items={gameList().map((g) => ({ id: g.id, label: g.name }))}
        value={game}
        onChange={onGameChange}
        disabled={busy}
        marker="left"
        columns="grid-cols-2 tab:grid-cols-4"
        height="h-10"
      />

      {/* 판이 끝나면 로그에 한 줄 붙는 정도로만 남긴다.
          자리를 늘 비워 둬서 결과가 떠도 아래 판이 밀리지 않는다.
          결과가 없을 때는 그 자리에 참가 보상 안내를 대신 띄운다. */}
      <div className="min-h-9">
        {last ? (
          <p
            className={`mono-13 bg-bg-1 flex min-h-9 items-center px-3 ${
              last.net < 0 ? "text-loss" : "text-fg"
            }`}
          >
            {settleLine(last.net, last.payout)}
            {bonusTail(last.outcome.bonus_stake, state.luck?.ends_at)}
          </p>
        ) : state.luck ? (
          <p className="mono-13 bg-bg-1 text-brass flex min-h-9 items-center px-3">
            클로버 판돈 +{state.luck.stake} · {clockText(state.luck.ends_at)}까지
            (판돈에 얹혀 지급되고, 코인은 판돈만 빠집니다)
          </p>
        ) : state.play_wage > 0 ? (
          <p className="mono-13 bg-bg-1 text-fg-low flex min-h-9 items-center px-3">
            판돈의 절반만큼, 최대 {state.play_wage}코인까지 참가 보상을 지급합니다.
          </p>
        ) : (
          <p className="bg-bg-1 min-h-9" />
        )}
      </div>

      {game === "roulette" && (
        <Roulette
          bet={effectiveBet}
          disabled={!canPlay}
          blockedRow={blockedRow}
          betSlot={betSlot}
          onPlay={onPlay}
          onSettle={onSettle}
        />
      )}
      {game === "slots" && (
        <Slots
          bet={effectiveBet}
          disabled={!canPlay}
          blockedRow={blockedRow}
          betSlot={betSlot}
          onPlay={onPlay}
          onSettle={onSettle}
        />
      )}
      {game === "keno" && (
        <Keno
          bet={effectiveBet}
          disabled={!canPlay}
          blockedRow={blockedRow}
          betSlot={betSlot}
          onPlay={onPlay}
          onSettle={onSettle}
        />
      )}
      {game === "highlow" && (
        <HighLow
          state={state}
          bet={effectiveBet}
          // 판이 열려 있으면(0단계 포함) 코인·횟수를 쓰지 않으므로 잔액이 0이어도 계속할 수 있다
          disabled={busy || (state.hl_bet === 0 && !canPlay)}
          blockedRow={blockedRow}
          betSlot={betSlot}
          onStart={onStartHighLow}
          onContinue={onContinue}
          onCashout={onCashout}
          onSettle={onSettle}
        />
      )}
    </>
  );
}
