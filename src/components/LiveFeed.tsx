"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type HighLowStep } from "@/lib/game";

import { GAME_CODE, LABEL } from "@/lib/copy";
import SidePanel from "./ui/SidePanel";

const FEED_SIZE = 5;

/** 로그는 시각부터 시작한다. 현재 시각과 같되 분까지만 남긴다. */
function stamp(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

type Round = {
  id: number;
  user_id: string;
  username: string;
  game: string;
  bet: number;
  payout: number;
  outcome: Record<string, unknown>;
  created_at: string;
};

/** 아레나 대전은 3판 2승제라 최종 승수로 보여준다. */
function describePvp(r: Round): string {
  const side = r.outcome.side as string;
  const pick = (host: string, guest: string) =>
    (side === "host" ? r.outcome[host] : r.outcome[guest]) as number | undefined;

  // 3판 2승제로 바뀌기 전 기록은 합계만 들고 있다.
  const mine = pick("host_wins", "guest_wins") ?? pick("host_total", "guest_total");
  const theirs = pick("guest_wins", "host_wins") ?? pick("guest_total", "host_total");
  const forfeit = r.outcome.reason === "timeout" ? " 기권" : "";

  return `${mine ?? 0} : ${theirs ?? 0}${forfeit} · ${r.outcome.vs}`;
}

/**
 * 모두가 보는 공개 피드는 결과만 짧게 알린다: "슬롯 승리", "룰렛 패",
 * "하이로우 (3단계) 승리". 카드 흐름 같은 자세한 내역은 본인 프로필 기록에만 남는다.
 */
function describe(r: Round): string {
  const name = GAME_CODE[r.game] ?? r.game;
  if (r.game === "dice" || r.game === "indian" || r.game === "blackjack")
    return `${name} ${describePvp(r)}`;

  const won = r.payout - r.bet > 0;

  if (r.game === "highlow") {
    if (r.outcome.result === "cashout") return "하이로우 회수";
    const steps = (r.outcome.steps as HighLowStep[]) ?? [];
    const tag = steps.length > 0 ? ` (${steps.length}단계)` : "";
    return won ? `하이로우${tag} 승리` : `하이로우${tag} 실패`;
  }

  if (r.game === "keno") {
    const match = (r.outcome.match as number) ?? 0;
    return match >= 2 ? `키노 ${match}개 적중` : "키노 빗나감";
  }

  // 경마는 정산 때 한 사람당 한 줄 — 산 마권을 다 합친 결과다.
  if (r.game === "race") {
    const no = r.outcome.no as number | undefined;
    return `경마 제${no ?? "?"}경주 ${r.payout > 0 ? "적중" : "낙첨"}`;
  }

  return won ? `${name} 승리` : `${name} 패`;
}

export default function LiveFeed({
  supabase,
  userId,
  holdSelf,
}: {
  supabase: SupabaseClient;
  userId: string;
  /** 내 게임 애니메이션이 도는 동안 true. 내 결과만 잠시 보류한다. */
  holdSelf: boolean;
}) {
  const [rounds, setRounds] = useState<Round[]>([]);

  // 애니메이션 중에 도착한 "내" 결과를 담아두는 대기열
  const pending = useRef<Round[]>([]);
  const holdRef = useRef(holdSelf);
  holdRef.current = holdSelf;

  useEffect(() => {
    let active = true;

    supabase
      .from("game_rounds")
      .select("id, user_id, username, game, bet, payout, outcome, created_at")
      .order("created_at", { ascending: false })
      .limit(FEED_SIZE)
      .then(({ data }) => {
        if (active && data) setRounds(data as Round[]);
      });

    const channel = supabase
      .channel("rounds-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_rounds" },
        (payload) => {
          const round = payload.new as Round;
          // 남의 결과는 즉시, 내 결과는 애니메이션이 끝난 뒤에 보여준다.
          if (round.user_id === userId && holdRef.current) {
            pending.current.push(round);
            return;
          }
          setRounds((prev) => [round, ...prev].slice(0, FEED_SIZE));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  // 애니메이션이 끝나면 보류해 둔 내 결과를 한꺼번에 내보낸다.
  useEffect(() => {
    if (holdSelf || pending.current.length === 0) return;
    const queued = pending.current;
    pending.current = [];
    setRounds((prev) => {
      const seen = new Set<number>();
      const unique: Round[] = [];
      for (const r of [...queued.reverse(), ...prev]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        unique.push(r);
      }
      return unique.slice(0, FEED_SIZE);
    });
  }, [holdSelf]);

  // 시각 · 이름/경로 · 증감 3칼럼 고정. 이긴 줄에도 축하는 없다.
  return (
    <SidePanel title={LABEL.feed} meta={`최근 ${rounds.length}건`} maxHeight={264}>
      <ul className="flex flex-col gap-2">
        {rounds.length === 0 && (
          <li className="mono-13 text-fg-low py-2">기록 없음</li>
        )}
        {rounds.map((r) => {
          const net = r.payout - r.bet;
          return (
            <li
              key={r.id}
              className="mono-13 grid grid-cols-[40px_minmax(0,1fr)_46px] items-baseline gap-x-4"
            >
              <span className="text-fg-low tabular-nums">
                {stamp(r.created_at)}
              </span>
              <span className="text-fg-mid truncate">
                {r.username}　{describe(r)}
              </span>
              <span
                className={`text-right tabular-nums ${
                  net > 0
                    ? "text-brass"
                    : net < 0
                      ? "text-loss"
                      : "text-fg-mid"
                }`}
              >
                {net > 0 ? `+${net}` : net}
              </span>
            </li>
          );
        })}
      </ul>
    </SidePanel>
  );
}
