"use client";

import { useState } from "react";
import type { Presence } from "@/hooks/usePresence";
import {
  PVP_GAMES,
  type PlayerState,
  type PvpGame,
  type PvpState,
} from "@/lib/game";
import { identityOf } from "@/lib/identity";
import { Countdown } from "@/hooks/useCountdown";
import BetControl from "./BetControl";
import MatchView from "./MatchView";
import TabRail from "./ui/TabRail";
import MonoLabel from "./ui/MonoLabel";

/**
 * Arena — 1:1 대전.
 * 
 * 배경이 온난 쪽(hue 20)으로 넘어가고 표면 밝기가 전체적으로 한 단 내려간다.
 * 여기서는 확률도 분포도 알려주지 않는다 — 어두운 건 정보를 덜 준다는 뜻이다.
 * 걸린 판돈과 남은 시간만 보인다.
 *
 * Casual 과 같은 골격을 쓴다: 게임 선택 → 판 → 조작 → 규칙.
 */
export default function BlackRoom({
  state,
  pvp,
  online,
  busy,
  call,
}: {
  state: PlayerState;
  pvp: PvpState | null;
  online: Presence[];
  busy: boolean;
  call: (fn: string, args?: Record<string, unknown>) => Promise<boolean>;
}) {
  const minBet = state.pvp_min_bet;
  const [game, setGame] = useState<PvpGame>("dice");
  const [bet, setBet] = useState(minBet);
  const [target, setTarget] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const match = pvp?.match ?? null;
  const invites = pvp?.invites ?? [];
  const showMatch = match && match.id !== dismissed;
  const showInvites =
    invites.length > 0 && (!showMatch || match.status === "invited");

  const candidates = online.filter((p) => p.username !== state.username);
  const selected =
    target && candidates.some((c) => c.username === target) ? target : null;

  const ready = PVP_GAMES.find((g) => g.id === game)?.ready ?? false;
  const canAfford = state.coins >= minBet;
  const effectiveBet = Math.max(minBet, Math.min(bet, state.coins));

  const chip =
    "label-11 state-fade border px-3.5 py-2.5 disabled:text-fg-low";

  return (
    <div className="flex flex-col gap-2">
      <TabRail
        items={PVP_GAMES.map((g) => ({ id: g.id, label: g.name }))}
        value={game}
        onChange={setGame}
        disabled={busy}
        marker="left"
        columns="grid-cols-3"
        height="h-10"
      />

      {/* 규칙만 준다. 승률도 분포도 여기서는 안 알려준다.
          상대 고르기보다 위, 대전 중에도 그대로 남는다. */}
      <div className="bg-bg-1 flex flex-col gap-2 p-3">
        <MonoLabel>{PVP_GAMES.find((g) => g.id === game)?.name}</MonoLabel>
        <ul className="flex flex-col gap-1">
          {(game === "dice"
            ? [
                "각자 주사위 두 개를 굴린다.",
                "합이 높은 쪽이 그 판을 가져간다.",
                "같은 눈이면 그 판은 다시 한다.",
                "3판 2승. 먼저 두 판을 이기면 판돈 전액.",
              ]
            : game === "indian"
              ? [
                  "한 장씩 받는다. 내 패는 못 본다.",
                  "상대 패만 보고 콜이나 다이를 고른다.",
                  "다이하면 그 판을 넘긴다. 둘 다 콜이면 높은 쪽이 이긴다.",
                  "3판 2승. 먼저 두 판을 이기면 판돈 전액.",
                ]
              : [
                  "두 장씩 받는다. 양쪽 패와 점수가 다 보인다.",
                  "첫 두 장 합이 21이면 블랙잭 — 그 자리에서 그 판을 이긴다. 둘 다면 무승부.",
                  "에이스가 뜨면 1과 11 중 하나를 고른다. 한 번 고르면 못 바꾼다.",
                  "번갈아 히트(한 장 더)나 스탠드(멈춤)를 고른다.",
                  "21을 넘기면 그 자리에서 진다. 21을 만들면 자동으로 멈춘다.",
                  "둘 다 멈추면 높은 점수가 이긴다. 같으면 그 판은 다시 한다.",
                  "3판 2승. 먼저 두 판을 이기면 판돈 전액.",
                ]
          ).map((line) => (
            <li key={line} className="body-15 text-fg-mid">
              {line}
            </li>
          ))}
        </ul>
        <p className="mono-13 text-fg-low">
          한 대전에 에너지 1을 씁니다. 플레이 횟수는 쓰지 않습니다. 최소 판돈 {minBet}{" "}
          코인. 같은 상대와는 세 종목을 통틀어 하루 3번까지.{" "}
          {game === "blackjack"
            ? "45초 안에 고르지 않으면 에이스는 1로, 차례는 자동 스탠드로 넘어갑니다."
            : "45초 안에 답이 없으면 기권 처리됩니다."}
        </p>
      </div>

      {/* ── 받은 신청 ── */}
      {showInvites && (
        <div className="flex flex-col gap-1.5">
          {invites.map((inv) => (
            <div
              key={inv.id}
              className="border-brass-line flex flex-col gap-2 border bg-bg-1 p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="title-19 text-fg-hi">
                  {identityOf(inv.from).no} {inv.from}
                </span>
                <span className="mono-13 text-fg-mid">
                  {PVP_GAMES.find((g) => g.id === inv.game)?.name} · 판돈{" "}
                  {inv.bet} 코인 · <Countdown seconds={inv.expires_in} />초
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    call("pvp_respond", { p_match_id: inv.id, p_accept: true })
                  }
                  className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
                >
                  수락
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    call("pvp_respond", { p_match_id: inv.id, p_accept: false })
                  }
                  className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid disabled:text-fg-low"
                >
                  거절
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 진행 중인 대전 ── */}
      {showMatch && (
        <MatchView
          match={match}
          busy={busy}
          onAct={(action) =>
            call("pvp_act", { p_match_id: match.id, p_action: action })
          }
          onRoll={() => call("pvp_roll", { p_match_id: match.id })}
          onAce={(value) =>
            call("pvp_bj_ace", { p_match_id: match.id, p_value: value })
          }
          onCancel={() => call("pvp_cancel", { p_match_id: match.id })}
          onClose={() => setDismissed(match.id)}
        />
      )}

      {/* ── 아직 안 열린 판 ── */}
      {!showMatch && !ready && (
        <div className="scanline-faint border-line flex flex-col items-center gap-1.5 border border-dashed bg-bg-1 px-4 py-12 text-center">
          <span className="title-19 text-fg">블랙잭은 아직 열리지 않았습니다.</span>
          <span className="mono-13 text-fg-low">
            배틀주사위와 인디언포커를 먼저 즐겨 주세요.
          </span>
        </div>
      )}

      {/* ── 상대 고르기 ── */}
      {!showMatch && ready && (
        <>
          <div className="bg-bg-1 flex flex-col gap-2 p-3">
            <MonoLabel>상대 · 지금 접속한 사람만</MonoLabel>

            {candidates.length === 0 ? (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-4 text-center">
                지금 대전할 수 있는 상대가 없습니다.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {candidates.map((c) => (
                  <button
                    key={c.username}
                    type="button"
                    disabled={busy}
                    onClick={() => setTarget(c.username)}
                    className={`${chip} ${
                      selected === c.username
                        ? "border-brass-line bg-brass-fill text-fg-hi"
                        : "border-line bg-surface text-fg-mid"
                    }`}
                  >
                    {identityOf(c.username).no} {c.username}
                  </button>
                ))}
              </div>
            )}
          </div>

          {canAfford ? (
            <>
              <BetControl
                value={effectiveBet}
                min={minBet}
                max={Math.max(minBet, state.coins)}
                disabled={busy}
                onChange={setBet}
              />

              <button
                type="button"
                disabled={busy || !selected}
                onClick={() =>
                  call("pvp_invite", {
                    p_game: game,
                    p_opponent: selected,
                    p_bet: effectiveBet,
                  })
                }
                className={`state-fade title-19 min-h-12 border ${
                  busy || !selected
                    ? "border-line-soft bg-bg-1 text-fg-low"
                    : "border-brass-line bg-brass-fill text-fg-hi"
                }`}
              >
                {selected
                  ? `${selected}에게 ${effectiveBet} 코인 걸고 신청`
                  : "상대를 먼저 고르세요"}
              </button>
            </>
          ) : (
            <div className="scanline-faint border-line flex min-h-15 flex-col items-center justify-center gap-1.5 border border-dashed bg-bg-2 p-3 text-center">
              <span className="body-15 text-fg">
                코인이 부족합니다. 최소 {minBet} 코인이 있어야 대전할 수 있습니다.
              </span>
              <span className="mono-13 text-fg-low">
                보유 {state.coins} 코인 · {minBet - state.coins} 코인 부족
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
