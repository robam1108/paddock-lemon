"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ITEM_GRADE_LABEL,
  SONGPYEON,
  toKoreanError,
  type ChuseokDraw,
  type ChuseokGrade,
} from "@/lib/game";
import MonoLabel from "./ui/MonoLabel";

/**
 * 추석 랜덤 송편 이벤트(한정). 소지품에서 송편 쿠폰을 쓰면 뜬다.
 *
 * 뽑기는 전부 서버(20_chuseok.sql)가 한다 — 쿠폰을 거두는 것도 서버다. 화면은
 * 서버가 정한 등급에 멈추도록 빛을 돌릴 뿐이다. 뽑아 두고 확정하지 않은 사람은
 * 접속할 때 돌리지 않고 결과부터 다시 보여 주고, 한 번 더 뽑기가 남아 있으면
 * 그 버튼도 그대로 남는다.
 */

type Phase = "loading" | "spinning" | "result" | "hidden";

/** 빛이 칸을 넘어가는 간격(ms). 점점 느려지다 서버 결과에서 멈춘다. */
function spinDelays(from: number, to: number): { idx: number; ms: number }[] {
  const n = SONGPYEON.length;
  // 최소 네 바퀴 돌고 목표 칸에서 멈춘다.
  const steps = 4 * n + ((to - from + n) % n);
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    return { idx: (from + i + 1) % n, ms: 55 + Math.round(360 * t * t * t) };
  });
}

function Songpyeon({ color, lit }: { color: string; lit: boolean }) {
  // 반달 모양 떡. 윗면에 빚은 자국(주름)을 한 줄 넣는다.
  return (
    <div
      aria-hidden
      className="relative mx-auto h-11 w-16 transition-transform duration-150"
      style={{
        background: color,
        borderRadius: "40px 40px 10px 10px",
        boxShadow: lit
          ? `0 0 0 2px var(--color-brass), 0 0 18px 2px ${color}`
          : "inset 0 -4px 0 rgba(0,0,0,.12)",
        transform: lit ? "scale(1.08)" : "scale(1)",
      }}
    >
      <span
        className="absolute left-1/2 top-1.5 h-[3px] w-10 -translate-x-1/2"
        style={{
          borderTop: "2px dotted rgba(0,0,0,.18)",
          borderRadius: "50%",
        }}
      />
    </div>
  );
}

export default function ChuseokPopup({
  supabase,
  draw,
  onDone,
}: {
  supabase: SupabaseClient;
  /** 쿠폰을 써서 연 경우 true — 뽑은 기록이 없으면 여기서 뽑는다 */
  draw: boolean;
  /** 팝업이 닫힐 때. 가방을 다시 읽어 송편이 보이게 한다 */
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [grade, setGrade] = useState<ChuseokGrade | null>(null);
  const [rerolled, setRerolled] = useState(false);
  const [lit, setLit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const litRef = useRef(0);
  litRef.current = lit;

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const spinTo = useCallback((g: ChuseokGrade) => {
    const to = SONGPYEON.findIndex((s) => s.grade === g);
    clearTimers();
    // 원판 회전처럼 연출이 아니라 판정 피드백이라 reduced-motion 에서도 돌린다.
    setPhase("spinning");
    let at = 0;
    for (const step of spinDelays(litRef.current, to)) {
      at += step.ms;
      timers.current.push(window.setTimeout(() => setLit(step.idx), at));
    }
    timers.current.push(window.setTimeout(() => setPhase("result"), at + 450));
  }, []);

  const rpc = useCallback(
    async (fn: string): Promise<ChuseokDraw | null> => {
      setError(null);
      try {
        const { data, error: e } = await supabase.rpc(fn);
        if (e || !data) {
          setError(toKoreanError(e?.message));
          return null;
        }
        return data as ChuseokDraw;
      } catch (e) {
        setError(toKoreanError(e instanceof Error ? e.message : undefined));
        return null;
      }
    },
    [supabase],
  );

  // 처음 뜰 때: 이미 확정했거나 기간이 아니면 조용히 닫고, 뽑은 적이 없으면
  // 쿠폰을 써서 연 경우에만 뽑는다(접속할 때 여는 건 확정 안 한 결과를 되살릴 때뿐).
  // 조회 자체가 실패했을 때: 쿠폰을 써서 연 경우(draw=true)엔 사용자가 명시적으로
  // 행동한 것이니 오류 문구를 보여 주지만, 접속·새로고침 때의 자동 체크(draw=false)는
  // 인증 세션 하이드레이션 타이밍 같은 일시적 실패일 수 있으니 조용히 숨긴다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await rpc("chuseok_state");
      if (!alive) return;
      if (!st) {
        if (!draw) setPhase("hidden");
        return;
      }
      if (!st.open || st.done) {
        // 쿠폰을 써서 연 경우엔 조용히 사라지지 않고 이유를 보여 준다.
        if (draw) setError(toKoreanError(st.open ? "ALREADY_DRAWN" : "EVENT_OVER"));
        else setPhase("hidden");
        return;
      }
      if (st.grade) {
        // 뽑아 두고 확정하지 않은 채 나간 사람 — 결과부터 보여 준다.
        setGrade(st.grade);
        setRerolled(st.rerolled);
        setLit(SONGPYEON.findIndex((s) => s.grade === st.grade));
        setPhase("result");
        return;
      }
      if (!draw) {
        setPhase("hidden");
        return;
      }
      setPhase("spinning");
      const d = await rpc("chuseok_draw");
      if (!alive) return;
      if (!d || !d.grade) {
        setPhase("result");
        return;
      }
      setGrade(d.grade);
      setRerolled(d.rerolled);
      spinTo(d.grade);
    })();
    return () => {
      alive = false;
    };
  }, [rpc, spinTo, draw]);

  const close = useCallback(() => {
    setPhase("hidden");
    onDone();
  }, [onDone]);

  const onTake = useCallback(async () => {
    if (busy) return;
    // 다시 뽑았으면 서버에서 이미 확정됐다.
    if (rerolled) {
      close();
      return;
    }
    setBusy(true);
    const d = await rpc("chuseok_finish");
    setBusy(false);
    if (d) close();
  }, [busy, rerolled, rpc, close]);

  const onReroll = useCallback(async () => {
    if (busy || rerolled) return;
    setBusy(true);
    const d = await rpc("chuseok_reroll");
    setBusy(false);
    if (!d || !d.grade) return;
    setGrade(d.grade);
    setRerolled(true);
    spinTo(d.grade);
  }, [busy, rerolled, rpc, spinTo]);

  if (phase === "hidden" || (phase === "loading" && !error)) return null;

  const won = SONGPYEON.find((s) => s.grade === grade);
  const showResult = phase === "result" && won;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg-0/80 p-4 tab:items-center">
      <div className="border-line w-full max-w-md border bg-bg-1">
        <div className="border-line-soft flex items-center justify-between border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">추석 특집 · 9/26까지</MonoLabel>
          <MonoLabel tone="low">한 사람에 하나</MonoLabel>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="title-19 text-fg-hi text-center">추석 랜덤 송편 이벤트</p>

          <ul className="grid grid-cols-3 gap-1.5">
            {SONGPYEON.map((s, i) => {
              const on = lit === i && phase !== "loading";
              const picked = showResult && s.grade === grade;
              return (
                <li
                  key={s.grade}
                  className={`flex flex-col items-center gap-1.5 border px-1 py-3 text-center transition-colors duration-150 ${
                    on
                      ? "border-brass-line bg-brass-fill"
                      : "border-line-soft bg-surface"
                  } ${showResult && !picked ? "opacity-45" : ""}`}
                >
                  <Songpyeon color={s.color} lit={on} />
                  <span className="body-15 text-fg-hi">{s.name}</span>
                  <MonoLabel tone={on ? "dim" : "low"}>
                    {ITEM_GRADE_LABEL[s.grade]}
                  </MonoLabel>
                  <span className="mono-13 text-fg-mid leading-tight">
                    {s.effect}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="min-h-12 text-center" aria-live="polite">
            {showResult ? (
              <>
                <p className="title-19 text-brass">{won.name}이 나왔다!</p>
                <p className="mono-13 text-fg-mid">
                  소지품에서 먹으면 9월 26일까지 {won.effect}
                </p>
              </>
            ) : phase === "spinning" ? (
              <p className="mono-13 text-fg-low">어느 송편이 나올까…</p>
            ) : null}
          </div>

          {error && (
            <p className="mono-13 border-loss/40 border bg-bg-2 px-3 py-2 text-loss">
              {error}
            </p>
          )}

          {showResult ? (
            <div className={`grid gap-1.5 ${rerolled ? "grid-cols-1" : "grid-cols-2"}`}>
              <button
                type="button"
                disabled={busy}
                onClick={onTake}
                className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
              >
                받기
              </button>
              {!rerolled && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onReroll}
                  className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid disabled:text-fg-low"
                >
                  한 번 더 뽑기 (1회)
                </button>
              )}
            </div>
          ) : error ? (
            <button
              type="button"
              onClick={close}
              className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid"
            >
              닫기
            </button>
          ) : null}

          {showResult && !rerolled && (
            <p className="mono-13 text-fg-low text-center">
              다시 뽑으면 지금 송편은 사라지고 새로 나온 것으로 확정된다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
