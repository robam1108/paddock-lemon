"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { raceCalls } from "@/lib/copy";
import {
  HORSE_LENGTH_M,
  positionAt,
  saddle,
  type Race,
  type RaceHorse,
} from "@/lib/race";
import HorseSprite from "./HorseSprite";
import MonoLabel from "../ui/MonoLabel";

const LANE_H = 26;
const SPRITE = 46;
/** 출발 전 게이트에 서 있는 시간(ms) */
const GATE_MS = 900;

/**
 * 경주 중계. 서버가 남긴 말별 10구간 누적 타임을 보간해 그린다.
 *
 * 프레임마다 바뀌는 건 transform · left · background-position 뿐이다 —
 * requestAnimationFrame 하나가 ref 로 직접 고치고, React 는 자막과 순위처럼
 * 구간마다 한 번 바뀌는 것만 다시 그린다.
 *
 * 카메라는 선두를 화면 2/3 지점에 두고 따라간다. 뒤처진 말은 화면 밖으로
 * 빠지고, 위쪽 미니맵이 전체 간격을 보여준다.
 */
export default function RaceTrack({
  race,
  horses,
  live,
  onDone,
}: {
  race: Race;
  horses: Map<number, RaceHorse>;
  live: boolean;
  onDone: () => void;
}) {
  // 폴링이 경주 객체를 새로 갈아 끼워도 도는 판은 처음 받은 결과로 끝까지 간다.
  const [frozen] = useState(() => ({ splits: race.result!.splits, order: race.result!.order }));
  const D = race.distance;
  // 폴링마다 배열이 새로 생기므로 문자열로 묶어 비교한다.
  const namesKey = race.entries.map((e) => horses.get(e.horse)?.name ?? `${e.gate}번`).join("|");
  const calls = useMemo(
    () => raceCalls(frozen.splits, namesKey.split("|"), D),
    [frozen, namesKey, D],
  );

  const viewRef = useRef<HTMLDivElement>(null);
  const horseRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const poleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const finishRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const [call, setCall] = useState(live ? "각 마 게이트에 들어갑니다." : "다시보기");
  const [order, setOrder] = useState<number[]>(race.entries.map((e) => e.gate));
  const [photo, setPhoto] = useState(false);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const splits = frozen.splits;
    const n = splits.length;
    const lastFinish = Math.max(...splits.map((s) => s[9]));
    const span = lastFinish + 2;
    const playSec = 12 + (D / 1000) * 8;
    const scale = span / playSec;
    const winT = Math.min(...splits.map((s) => s[9]));
    const top2 = [...splits.map((s) => s[9])].sort((a, b) => a - b);
    const close = ((top2[1] - top2[0]) * D) / winT / HORSE_LENGTH_M < 0.2;

    let width = view.clientWidth;
    const ro = new ResizeObserver(() => {
      width = view.clientWidth;
    });
    ro.observe(view);

    const start = performance.now() + GATE_MS;
    let raf = 0;
    let callIdx = -1;
    let orderKey = "";
    let lastOrderAt = 0;
    let ended = false;
    const timers: number[] = [];

    const frame = (now: number) => {
      const t = Math.max(0, ((now - start) / 1000) * scale);
      const viewM = Math.min(60, Math.max(30, width / 14));
      const ppm = width / viewM;
      const pos = splits.map((s) => Math.min(D + 40, positionAt(s, D, t)));
      const lead = Math.max(...pos);
      const cam = Math.min(Math.max(lead - viewM * 0.68, -4), D + 12 - viewM);

      for (let i = 0; i < n; i++) {
        const el = horseRefs.current[i];
        if (el) el.style.transform = `translate3d(${(pos[i] - cam) * ppm - SPRITE}px,0,0)`;
        const dot = dotRefs.current[i];
        if (dot) dot.style.left = `${Math.min(1, pos[i] / D) * 100}%`;
      }
      if (groundRef.current) groundRef.current.style.backgroundPosition = `${-cam * ppm}px 0`;
      if (finishRef.current) finishRef.current.style.transform = `translateX(${(D - cam) * ppm}px)`;
      if (gateRef.current) gateRef.current.style.transform = `translateX(${(0 - cam) * ppm}px)`;
      const first = Math.ceil(cam / 100) * 100;
      poleRefs.current.forEach((p, j) => {
        if (!p) return;
        const m = first + j * 100;
        const show = m > 0 && m < D;
        p.style.display = show ? "block" : "none";
        if (!show) return;
        p.style.transform = `translateX(${(m - cam) * ppm}px)`;
        const label = p.firstElementChild as HTMLElement | null;
        if (label) label.textContent = String(D - m);
      });

      if (now >= start) {
        let ci = callIdx;
        while (ci + 1 < calls.length && calls[ci + 1].at <= t) ci++;
        if (ci !== callIdx) {
          callIdx = ci;
          setCall(calls[ci].text);
        }
        if (now - lastOrderAt > 250) {
          lastOrderAt = now;
          const ord = pos
            .map((p, i) => [p, i] as const)
            .sort((a, b) => b[0] - a[0] || splits[a[1]][9] - splits[b[1]][9])
            .map(([, i]) => i + 1);
          const key = ord.join(",");
          if (key !== orderKey) {
            orderKey = key;
            setOrder(ord);
          }
        }
      }

      if (t >= span && !ended) {
        ended = true;
        setOrder(frozen.order);
        if (close) setPhoto(true);
        timers.push(window.setTimeout(() => onDoneRef.current(), close ? 1600 : 800));
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((x) => window.clearTimeout(x));
      ro.disconnect();
    };
  }, [frozen, D, calls]);

  return (
    <div className="bg-bg-1 flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <MonoLabel tone={live ? "dim" : "low"}>{live ? "● 실황 중계" : "다시보기"}</MonoLabel>
        <span className="mono-13 text-fg-low">{D}m</span>
      </div>

      {/* 미니맵 — 출발부터 결승까지 전체 간격 */}
      <div className="bg-bg-0 relative h-4 border-line-soft border">
        <span className="bg-fg-low absolute inset-y-0 right-0 w-px" />
        {race.entries.map((e, i) => (
          <span
            key={e.gate}
            ref={(el) => {
              dotRefs.current[i] = el;
            }}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: 0, background: saddle(e.gate).bg, boxShadow: "0 0 0 1px #0008" }}
          />
        ))}
      </div>

      {/* 주로 */}
      <div
        ref={viewRef}
        className="relative overflow-hidden border-line border"
        style={{ height: race.entries.length * LANE_H + 18 }}
      >
        <div
          ref={groundRef}
          className="absolute inset-0"
          style={{
            backgroundColor: race.track >= 2 ? "#4a3a2a" : "#6e5638",
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 2px, transparent 2px 38px)," +
              "repeating-linear-gradient(0deg, rgba(0,0,0,.10) 0 1px, transparent 1px " + LANE_H + "px)",
          }}
        />
        {/* 안쪽 난간 */}
        <div
          className="absolute inset-x-0 top-0 h-2"
          style={{ background: "repeating-linear-gradient(90deg,#e9e6df 0 3px,transparent 3px 22px), linear-gradient(#e9e6df,#e9e6df) 0 2px/100% 2px no-repeat" }}
        />
        {/* 남은 거리 표지 */}
        {[0, 1].map((j) => (
          <div
            key={j}
            ref={(el) => {
              poleRefs.current[j] = el;
            }}
            className="absolute inset-y-0 left-0 w-px bg-white/30"
            style={{ display: "none" }}
          >
            <span className="mono-13 absolute top-2 left-1 text-white/70">0</span>
          </div>
        ))}
        {/* 출발 게이트 */}
        <div ref={gateRef} className="absolute inset-y-0 left-0 w-1.5 bg-[#c9c4b8]/80" />
        {/* 결승선 */}
        <div
          ref={finishRef}
          className="absolute inset-y-0 left-0 w-2"
          style={{
            backgroundImage: "repeating-conic-gradient(#f2f2ee 0 25%, #111 0 50%)",
            backgroundSize: "8px 8px",
          }}
        />

        {race.entries.map((e, i) => {
          const h = horses.get(e.horse);
          return (
            <div
              key={e.gate}
              ref={(el) => {
                horseRefs.current[i] = el;
              }}
              className="absolute left-0 will-change-transform"
              style={{ top: 10 + i * LANE_H - 6, transform: `translate3d(${-SPRITE}px,0,0)` }}
            >
              <HorseSprite
                coat={h?.coat ?? "갈색"}
                face={h?.face ?? "없음"}
                legs={h?.legs ?? "없음"}
                gate={e.gate}
                running
                size={SPRITE}
              />
            </div>
          );
        })}

        {photo && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/25">
            <span className="title-19 border-line border bg-bg-0 px-3 py-1 text-fg-hi">
              사진 판정
            </span>
          </div>
        )}
      </div>

      {/* 현재 순위 */}
      <div className="flex flex-wrap items-center gap-1">
        {order.map((g, i) => (
          <span key={g} className="flex items-center gap-1">
            <span
              className="mono-13 inline-flex h-5 min-w-5 items-center justify-center px-1 font-bold"
              style={{ background: saddle(g).bg, color: saddle(g).fg, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / .22)" }}
            >
              {g}
            </span>
            {i < order.length - 1 && <span className="text-fg-low mono-13">›</span>}
          </span>
        ))}
      </div>

      {/* 중계 자막 */}
      <p className="body-15 border-line-soft min-h-12 border bg-bg-0 px-3 py-2 text-fg-hi">
        {call}
      </p>
    </div>
  );
}
