"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatDuration,
  toKoreanError,
  type LaborBoard,
  type LaborResult,
  type PlayerState,
} from "@/lib/game";
import { blockedState, laborLines, nonGameBlockedLine } from "@/lib/copy";
import { LABOR_JOBS } from "@/lib/labor";
import BlockedRow from "./ui/BlockedRow";
import MonoLabel from "./ui/MonoLabel";
import ResultPopup from "./ui/ResultPopup";

/**
 * 일일 미션.
 *
 * 하루 3개가 뜨고, 그중 둘까지만 할 수 있다. 미션 시간은 KST 13시부터
 * 19시가 되기 직전까지다. 난이도·보상 범위는 화면 어디에도 없다 — 이름과
 * 짧은 설명만 보고 고른다. 얼마를 받을지는 끝내야 안다.
 *
 * 어제 낮 미션을 한 번도 못 했으면 새벽 2시부터 5시 직전까지 야간 미션이
 * 하나 더 열린다(표 3개 중 한 번).
 */
export default function Labor({
  supabase,
  state,
  busy,
  onRefresh,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  onRefresh: () => void;
}) {
  const [board, setBoard] = useState<LaborBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<LaborResult | null>(null);
  // 지켜볼 마감이 둘이다 — 쿨다운이 끝나는 순간과 근무 시간이 바뀌는 순간.
  // 남은 초(표시용)는 state, 실제 마감 시각(ms)은 ref 에 둔다.
  const [left, setLeft] = useState(0);
  const [openLeft, setOpenLeft] = useState(0);
  const [nightLeft, setNightLeft] = useState(0);
  const coolAt = useRef(0);
  const winAt = useRef(0);
  const nightAt = useRef(0);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("labor_board");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    if (data) {
      const next = data as LaborBoard;
      const now = Date.now();
      coolAt.current = next.cooldown_left > 0 ? now + next.cooldown_left * 1000 : 0;
      winAt.current = next.window_left > 0 ? now + next.window_left * 1000 : 0;
      const nw = next.night?.window_left ?? 0;
      nightAt.current = nw > 0 ? now + nw * 1000 : 0;
      setLeft(next.cooldown_left);
      setOpenLeft(next.window_left);
      setNightLeft(nw);
      setBoard(next);
      setError(null);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // 인터벌 하나가 두 마감을 같이 본다. 의존성이 load 뿐이라 틱마다
  // 재생성되지 않고, 실패한 재조회 뒤에도(다음 틱에 coolAt/winAt 이
  // 이미 0이라) 스스로 회복한다 — counting 같은 파생 불리언에 기대지 않는다.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let refetch = false;
      if (coolAt.current > 0 && now >= coolAt.current) {
        coolAt.current = 0;
        refetch = true;
      }
      if (winAt.current > 0 && now >= winAt.current) {
        winAt.current = 0;
        refetch = true;
      }
      if (nightAt.current > 0 && now >= nightAt.current) {
        nightAt.current = 0;
        refetch = true;
      }
      setLeft(coolAt.current > 0 ? Math.ceil((coolAt.current - now) / 1000) : 0);
      setOpenLeft(winAt.current > 0 ? Math.ceil((winAt.current - now) / 1000) : 0);
      setNightLeft(nightAt.current > 0 ? Math.ceil((nightAt.current - now) / 1000) : 0);
      if (refetch) load();
    }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const work = useCallback(
    async (code: string, night = false) => {
      setWorking(true);
      const { data, error: e } = await supabase.rpc(
        night ? "labor_night_work" : "labor_work",
        { p_code: code },
      );
      setWorking(false);

      if (e || !data) {
        setError(toKoreanError(e?.message));
        // 서버가 거절했다는 건 내 화면이 낡았다는 뜻이다(시간이 지나
        // 닫혔거나, 다른 곳에서 이미 오늘 몫을 썼거나). 다시 읽어 맞춘다.
        load();
        return;
      }

      setError(null);
      setOutcome((data as { labor: LaborResult }).labor);
      // 코인·에너지가 다 바뀐다.
      onRefresh();
      load();
    },
    [supabase, onRefresh, load],
  );

  // 미션은 에너지·휴식을 다루지만 플레이 횟수는 쓰지 않으므로 quota/broke 는
  // 넘기지 않는다 — 정지·휴식만 여기서 막는다.
  const blocked = blockedState(state, false, false);
  const busyAll = busy || working;
  const hpCost = board?.hp_cost ?? 10;
  const noHp = state.hp <= hpCost;
  const capped = (board?.done ?? 0) >= (board?.limit ?? 2);
  // 영구적인 것 → 고칠 수 있는 것 순으로 가린다: 오늘 다 끝난 게 시간대보다
  // 앞이라, 두 번 다 쓴 사람에게는 시간이 열려 있어도 "다 끝냈다"가 뜬다.
  const closed = !capped && board != null && !board.open;
  const cooling = !capped && !closed && left > 0;
  const night = board?.night ?? null;
  // 야간 미션은 에너지를 낮보다 많이 쓴다 — 표시·판정을 따로 한다.
  const nightHpCost = night?.hp_cost ?? 35;
  const nightNoHp = state.hp <= nightHpCost;

  return (
    <div className="flex flex-col gap-2">
      <section className="bg-bg-1 flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <MonoLabel>일일 미션</MonoLabel>
          <MonoLabel tone="low">
            오늘 {board?.done ?? 0}/{board?.limit ?? 2}회
          </MonoLabel>
        </div>

        {error && (
          <p className="mono-13 border-loss/40 border bg-bg-2 px-3 py-2 text-loss">
            {error}
          </p>
        )}

        {blocked ? (
          <BlockedRow
            blocked={{ ...blocked, line: nonGameBlockedLine(blocked) }}
            disabled={busyAll}
          />
        ) : board === null ? (
          <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
            불러오는 중…
          </p>
        ) : capped ? (
          <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
            오늘 미션을 모두 끝냈습니다.
          </p>
        ) : closed ? (
          <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
            미션은 {board.open_from}시부터 {board.open_to}시까지 열립니다.
            <br />
            작업 시작까지 {formatDuration(openLeft)}.
          </p>
        ) : cooling ? (
          <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
            다음 미션까지 {formatDuration(left)} 남았습니다.
          </p>
        ) : noHp ? (
          <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
            에너지가 {hpCost} 이하면 시작할 수 없습니다. 지금 {state.hp}.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {board.jobs.map((j) => {
              const job = LABOR_JOBS[j.code];
              if (!job) return null;
              return (
                <li
                  key={j.code}
                  className={`border-line-soft flex items-center gap-3 border bg-surface p-3 ${
                    j.done ? "opacity-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="body-15 text-fg-hi">{job.name}</span>
                    <p className="mono-13 text-fg-mid">{job.desc}</p>
                  </div>
                  {j.done ? (
                    <MonoLabel tone="low">완료</MonoLabel>
                  ) : (
                    <button
                      type="button"
                      disabled={busyAll}
                      onClick={() => work(j.code)}
                      className="state-fade label-11 border-brass-line w-24 shrink-0 border bg-brass-fill px-4 py-3 text-center text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                    >
                      에너지 -{hpCost}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 어제 낮 미션을 한 번도 못 한 사람에게만 서버가 night 를 내려준다. */}
      {night && !blocked && (
        <section className="bg-bg-1 flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <MonoLabel>야간 미션</MonoLabel>
            <MonoLabel tone="low">오늘 밤 {night.done ? 1 : 0}/1회</MonoLabel>
          </div>

          {night.done ? (
            <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
              오늘 밤 미션을 끝냈습니다.
            </p>
          ) : !night.open ? (
            <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
              어제 미션을 못 한 대신 새벽 {night.open_from}시부터 {night.open_to}시까지
              한 번 할 수 있습니다.
              <br />
              시작까지 {formatDuration(nightLeft)}.
            </p>
          ) : nightNoHp ? (
            <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
              에너지가 {nightHpCost} 이하면 시작할 수 없습니다. 지금 {state.hp}.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {night.jobs.map((j) => {
                const job = LABOR_JOBS[j.code];
                if (!job) return null;
                return (
                  <li
                    key={j.code}
                    className="border-line-soft flex items-center gap-3 border bg-surface p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="body-15 text-fg-hi">{job.name}</span>
                      <p className="mono-13 text-fg-mid">{job.desc}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busyAll}
                      onClick={() => work(j.code, true)}
                      className="state-fade label-11 border-brass-line w-24 shrink-0 border bg-brass-fill px-4 py-3 text-center text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                    >
                      에너지 -{nightHpCost}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {outcome && (
        <ResultPopup
          title="작업 결과"
          lines={laborLines(outcome)}
          onClose={() => setOutcome(null)}
        />
      )}
    </div>
  );
}
