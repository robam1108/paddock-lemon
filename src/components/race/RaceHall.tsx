"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toKoreanError, type PlayerState } from "@/lib/game";
import {
  KIND_NAME,
  STYLE_NAME,
  TRACK_NAME,
  countdown,
  kstTime,
  oddsText,
  raceTitle,
  type Race,
  type RaceCard,
  type RaceKind,
} from "@/lib/race";
import MonoLabel from "../ui/MonoLabel";
import BetSlip from "./BetSlip";
import HorseCard from "./HorseCard";
import RaceResult, { Chip } from "./RaceResult";
import RaceTrack from "./RaceTrack";
import { usePageVisible } from "@/hooks/usePageVisible";

const DISTANCES = [1000, 1200, 1400, 1600, 1800, 2000];
const wd = (d: number) => (d > 0 ? `+${d}` : String(d));

/**
 * 아레나 › 경마장.
 *
 * 출전표는 발주 전까지 배당만 보여준다 — 결과는 서버에도 아직 없다. 열려 있던
 * 경주가 끝난 것을 폴링이 알아채면(발주 2분 전부터 3초 간격) 그 자리에서
 * 실황으로 틀어 준다. 끝난 경주는 언제든 다시 볼 수 있다.
 */
export default function RaceHall({
  supabase,
  state,
  onState,
  onRefresh,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  onState: (s: PlayerState) => void;
  onRefresh: () => void;
}) {
  const [card, setCard] = useState<RaceCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selId, setSelId] = useState<number | null>(null);
  const [play, setPlay] = useState<{ id: number; live: boolean } | null>(null);
  const [info, setInfo] = useState<number | null>(null);
  const [kind, setKind] = useState<RaceKind>("win");
  const [picks, setPicks] = useState<number[]>([]);
  const [amount, setAmount] = useState(20);
  const [testDist, setTestDist] = useState(0);
  const [testTrack, setTestTrack] = useState(-1);
  const [testDelay, setTestDelay] = useState(120);
  const [now, setNow] = useState(() => Date.now());
  // 서버 시계와의 차이 — 마감 카운트다운은 서버 시각 기준이다.
  const skew = useRef(0);
  const visible = usePageVisible();
  // 열려 있는 걸 본 경주. 이게 끝난 채로 돌아오면 실황으로 튼다.
  const seenOpen = useRef(new Set<number>());

  const apply = useCallback(
    (c: RaceCard) => {
      skew.current = Date.parse(c.now) - Date.now();
      let paid = false;
      for (const r of [...(c.test ? [c.test] : []), ...c.recent]) {
        if (r.status === "done" && seenOpen.current.has(r.id)) {
          seenOpen.current.delete(r.id);
          setPlay((p) => p ?? { id: r.id, live: true });
          setSelId(r.id);
          if (!r.is_test && r.tickets.length > 0) paid = true;
        }
      }
      for (const r of [...c.upcoming, ...(c.test?.status === "open" ? [c.test] : [])]) {
        seenOpen.current.add(r.id);
      }
      if (paid) onRefresh();
      setCard(c);
    },
    [onRefresh],
  );

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase.rpc("race_card");
      if (e || !data) {
        setError(toKoreanError(e?.message));
        return;
      }
      apply(data as RaceCard);
    } catch (e) {
      setError(toKoreanError(e instanceof Error ? e.message : undefined));
    }
  }, [supabase, apply]);

  // 처음 한 번, 그리고 숨겨졌던 탭으로 돌아올 때마다 바로 다시 읽는다.
  useEffect(() => {
    if (visible) load();
  }, [load, visible]);

  // 발주가 가까우면 3초, 아니면 15초마다 다시 읽는다.
  useEffect(() => {
    if (!card || !visible) return;
    const open = [...card.upcoming, ...(card.test?.status === "open" ? [card.test] : [])];
    const t0 = Date.now() + skew.current;
    const near = open.some((r) => Date.parse(r.post_at) - t0 < 120_000);
    const id = window.setTimeout(load, near ? 3000 : 15000);
    return () => window.clearTimeout(id);
  }, [card, load, visible]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const horses = useMemo(() => new Map((card?.horses ?? []).map((h) => [h.id, h])), [card]);

  const races = useMemo(() => {
    if (!card) return [] as Race[];
    const list = [...(card.test ? [card.test] : []), ...card.upcoming, ...card.recent];
    return list.filter((r, i) => list.findIndex((x) => x.id === r.id) === i);
  }, [card]);
  const sel = races.find((r) => r.id === selId) ?? card?.upcoming[0] ?? races[0] ?? null;

  useEffect(() => {
    setPicks([]);
    setInfo(null);
  }, [sel?.id]);

  const togglePick = (gate: number) => {
    setPicks((p) => {
      if (p.includes(gate)) return p.filter((g) => g !== gate);
      if (kind === "quin") return [...p, gate].slice(-2);
      return [gate];
    });
  };

  const buy = async (value: number) => {
    if (!sel || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: e } = await supabase.rpc("race_bet", {
        p_race: sel.id,
        p_kind: kind,
        p_picks: picks,
        p_amount: value,
      });
      if (e || !data) {
        setError(toKoreanError(e?.message));
      } else {
        if (!sel.is_test) onState(data as PlayerState);
        setNotice(`${KIND_NAME[kind]} ${picks.join("-")} · ${value}코인 베팅했습니다.`);
        setPicks([]);
      }
    } catch (e) {
      setError(toKoreanError(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
      load();
    }
  };

  const adminTest = async (action: "create" | "start" | "reset_tips") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const opts: Record<string, number> = { delay_sec: testDelay };
      if (testDist) opts.distance = testDist;
      if (testTrack >= 0) opts.track = testTrack;
      const { data, error: e } = await supabase.rpc("race_admin_test", {
        p_action: action,
        p_opts: opts,
      });
      if (e || !data) {
        setError(toKoreanError(e?.message));
        return;
      }
      const c = data as RaceCard;
      if (action !== "reset_tips" && c.test) setSelId(c.test.id);
      if (action === "create") setPlay(null);
      if (action === "reset_tips") setNotice("인사이더 팁 한도를 되돌렸습니다.");
      apply(c);
    } catch (e) {
      setError(toKoreanError(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  // 연습 경주 — 관리자가 아니어도 시각과 무관하게 한 경주를 돌려 볼 수 있다.
  const practice = async (action: "create" | "start") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: e } = await supabase.rpc("race_practice", { p_action: action });
      if (e || !data) {
        setError(toKoreanError(e?.message));
        return;
      }
      const c = data as RaceCard;
      if (c.test) setSelId(c.test.id);
      if (action === "create") setPlay(null);
      apply(c);
    } catch (e) {
      setError(toKoreanError(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  if (!card) {
    return (
      <p className="mono-13 border-line-soft border bg-bg-1 px-3 py-6 text-center text-fg-low">
        {error ?? "출전표를 받는 중…"}
      </p>
    );
  }

  const serverNow = now + skew.current;
  const spent = sel ? sel.tickets.reduce((s, t) => s + t.amount, 0) : 0;
  const select = (id: number) => {
    setSelId(id);
    setPlay(null);
  };
  const chip = (active: boolean) =>
    `state-fade flex min-w-0 flex-col items-start gap-0.5 border px-3 py-2 text-left ${
      active ? "border-brass bg-surface-hi text-fg-hi" : "border-line-soft bg-surface text-fg-mid hover:text-fg"
    }`;
  const select_ = "mono-13 border-line border bg-surface px-2 h-9 text-fg";

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-bg-1 flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
        <MonoLabel>Paddock 경마장{card.public ? "" : " · 비공개"}</MonoLabel>
        <span className="mono-13 text-fg-low">
          매일 10:00 · 22:00 발주 · 8두 출전 · 발주 시각에 발매 마감
        </span>
      </div>

      {/* 연습 경주 — 정식 발주 시각이 아니어도 실황을 볼 수 있게 */}
      {!card.tester && (
        <div className="border-brass-line flex flex-col gap-2 border border-dashed bg-bg-1 p-3 tab:flex-row tab:items-center tab:justify-between">
          <p className="mono-13 text-fg-mid break-keep">
            연습 경주 · 코인과 에너지가 들지 않습니다. 편성 1분 뒤 발주하며, 바로 발주할 수도 있습니다.
          </p>
          <div className="grid shrink-0 grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => practice("create")}
              className="state-fade mono-13 border-brass-line min-h-10 border bg-brass-fill px-3 py-1.5 leading-tight break-keep text-fg-hi disabled:text-fg-low"
            >
              연습 경주 편성
            </button>
            <button
              type="button"
              disabled={busy || card.test?.status !== "open"}
              onClick={() => practice("start")}
              className="state-fade mono-13 border-line min-h-10 border bg-surface px-3 py-1.5 leading-tight break-keep text-fg disabled:text-fg-low"
            >
              지금 발주
            </button>
          </div>
        </div>
      )}

      {/* 관리자 사전 확인 — 시각과 무관한 테스트 경주 */}
      {card.tester && (
        <div className="border-brass-line flex flex-col gap-2 border border-dashed bg-bg-1 p-3">
          <p className="mono-13 text-fg-mid break-keep">관리자 테스트 · 코인이 움직이지 않는다</p>
          <div className="flex flex-wrap gap-1.5">
            <select className={select_} value={testDist} onChange={(e) => setTestDist(Number(e.target.value))}>
              <option value={0}>거리 무작위</option>
              {DISTANCES.map((d) => (
                <option key={d} value={d}>
                  {d}m
                </option>
              ))}
            </select>
            <select className={select_} value={testTrack} onChange={(e) => setTestTrack(Number(e.target.value))}>
              <option value={-1}>주로 무작위</option>
              {TRACK_NAME.map((t, i) => (
                <option key={t} value={i}>
                  {t}
                </option>
              ))}
            </select>
            <select className={select_} value={testDelay} onChange={(e) => setTestDelay(Number(e.target.value))}>
              <option value={30}>30초 뒤 발주</option>
              <option value={120}>2분 뒤 발주</option>
              <option value={600}>10분 뒤 발주</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["create", "테스트 경주 편성"],
                ["start", "지금 발주"],
                ["reset_tips", "팁 초기화"],
              ] as const
            ).map(([a, label]) => (
              <button
                key={a}
                type="button"
                disabled={busy || (a === "start" && card.test?.status !== "open")}
                onClick={() => adminTest(a)}
                className="state-fade mono-13 border-line min-h-10 border bg-surface px-2 py-1.5 leading-tight break-keep text-fg disabled:text-fg-low"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 경주 고르기 */}
      <div className="grid grid-cols-1 gap-1 tab:grid-cols-3">
        {[...(card.test ? [card.test] : []), ...card.upcoming].map((r) => (
          <button key={r.id} type="button" onClick={() => select(r.id)} className={chip(sel?.id === r.id)}>
            <span className="title-19 break-keep">{raceTitle(r)}</span>
            <span className="mono-13 text-fg-low">
              {kstTime(r.post_at)} · {r.distance}m · {TRACK_NAME[r.track]}
              {r.status === "done" ? " · 종료" : ""}
            </span>
          </button>
        ))}
      </div>

      {notice && <p className="mono-13 border-line-soft border bg-bg-1 px-3 py-2 text-fg">{notice}</p>}
      {error && <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">{error}</p>}

      {sel && (
        <>
          <div className="bg-bg-1 flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
            <span className="title-19 text-fg-hi">
              {raceTitle(sel)} · {sel.distance}m
            </span>
            <span className="mono-13 text-fg-mid">
              주로 {TRACK_NAME[sel.track]} · 발주 {kstTime(sel.post_at)}
              {sel.status === "open" &&
                (Date.parse(sel.post_at) > serverNow
                  ? ` · 마감까지 ${countdown(Date.parse(sel.post_at) - serverNow)}`
                  : " · 발주! 결과 집계 중")}
            </span>
          </div>

          {play && play.id === sel.id && sel.result ? (
            <RaceTrack key={`${sel.id}-${play.live}`} race={sel} horses={horses} live={play.live} onDone={() => setPlay(null)} />
          ) : sel.status === "done" ? (
            <RaceResult race={sel} horses={horses} onReplay={() => setPlay({ id: sel.id, live: false })} />
          ) : (
            <>
              {/* 출전표 */}
              <div className="bg-bg-1 flex flex-col">
                <div className="mono-13 text-fg-low grid grid-cols-[1.75rem_1fr_3.25rem_2.25rem] items-center gap-2 px-3 py-1.5 tab:grid-cols-[2rem_1fr_4.5rem_3rem_5rem_3.5rem_3.5rem_2.5rem]">
                  <span>번</span>
                  <span>마명</span>
                  <span className="hidden text-right tab:block">마체중</span>
                  <span className="hidden tab:block">습성</span>
                  <span className="hidden tab:block">최근</span>
                  <span className="hidden text-right tab:block">단승</span>
                  <span className="hidden text-right tab:block">연승</span>
                  <span className="text-right leading-tight tab:hidden">단승 연승</span>
                  <span />
                </div>
                {sel.entries.map((e) => {
                  const h = horses.get(e.horse);
                  if (!h) return null;
                  const picked = picks.includes(e.gate);
                  return (
                    <Fragment key={e.gate}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-pressed={picked}
                        onClick={() => togglePick(e.gate)}
                        onKeyDown={(k) => {
                          if (k.key === "Enter" || k.key === " ") {
                            k.preventDefault();
                            togglePick(e.gate);
                          }
                        }}
                        className={`state-fade mono-13 grid cursor-pointer grid-cols-[1.75rem_1fr_3.25rem_2.25rem] items-center gap-2 border-l-2 px-3 py-2 tab:grid-cols-[2rem_1fr_4.5rem_3rem_5rem_3.5rem_3.5rem_2.5rem] ${
                          picked ? "border-brass bg-surface-hi text-fg-hi" : "border-transparent text-fg hover:bg-surface"
                        }`}
                      >
                        <Chip gate={e.gate} />
                        <span className="flex min-w-0 flex-col">
                          <span className="break-keep">
                            <span className="text-fg-hi font-bold">{h.name}</span>{" "}
                            <span className="text-fg-low">
                              {h.sex}
                              {h.age}
                            </span>
                          </span>
                          {/* 좁은 화면에서는 마체중을 이름 아래로 내린다 */}
                          <span className="text-fg-low tabular-nums tab:hidden">
                            {e.weight}kg({wd(e.wdelta)})
                          </span>
                        </span>
                        <span className="hidden text-right tabular-nums tab:block">
                          {e.weight}
                          <span className="text-fg-low">({wd(e.wdelta)})</span>
                        </span>
                        <span className="hidden tab:block">{STYLE_NAME[h.style]}</span>
                        <span className="hidden truncate tab:block">{h.last5.length ? h.last5.join("-") : "-"}</span>
                        <span className="text-brass hidden text-right tabular-nums tab:block">{oddsText(sel.odds.win[e.gate - 1])}</span>
                        <span className="hidden text-right tabular-nums tab:block">{oddsText(sel.odds.place[e.gate - 1])}</span>
                        {/* 좁은 화면 — 단승·연승을 한 칸에 위아래로 */}
                        <span className="flex flex-col items-end tabular-nums leading-tight tab:hidden">
                          <span className="text-brass">{oddsText(sel.odds.win[e.gate - 1])}</span>
                          <span>{oddsText(sel.odds.place[e.gate - 1])}</span>
                        </span>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setInfo((g) => (g === e.gate ? null : e.gate));
                          }}
                          className="label-11 border-line-soft h-7 border text-fg-mid hover:text-fg-hi"
                          aria-expanded={info === e.gate}
                        >
                          {info === e.gate ? "닫기" : "정보"}
                        </button>
                      </div>
                      {info === e.gate && <HorseCard horse={h} gate={e.gate} />}
                    </Fragment>
                  );
                })}
              </div>

              <BetSlip
                race={sel}
                kind={kind}
                onKind={(k) => {
                  setKind(k);
                  setPicks([]);
                }}
                picks={picks}
                amount={amount}
                onAmount={setAmount}
                minBet={card.min_bet}
                maxBet={card.max_bet}
                spent={spent}
                coins={state.coins}
                hp={state.hp}
                busy={busy || Date.parse(sel.post_at) <= serverNow || state.suspended || (!sel.is_test && state.in_ward)}
                onBuy={buy}
              />

              {sel.tickets.length > 0 && (
                <ul className="bg-bg-1 flex flex-col gap-1 px-3 py-2">
                  <MonoLabel tone="mid">내 마권</MonoLabel>
                  {sel.tickets.map((t) => (
                    <li key={t.id} className="mono-13 flex justify-between gap-2 text-fg">
                      <span>
                        {KIND_NAME[t.kind]} {t.picks.join("-")}
                      </span>
                      <span>
                        {t.amount}코인 × {oddsText(t.odds)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {/* 지난 경주 */}
      {card.recent.length > 0 && (
        <div className="bg-bg-1 flex flex-col gap-1 p-3">
          <MonoLabel tone="mid">지난 경주</MonoLabel>
          {card.recent.slice(0, 4).map((r) => {
            const w = r.result ? horses.get(r.entries[r.result.order[0] - 1].horse) : null;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => select(r.id)}
                className={`state-fade mono-13 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-l-2 px-2 py-1.5 text-left ${
                  sel?.id === r.id ? "border-brass text-fg-hi" : "border-transparent text-fg-mid hover:text-fg"
                }`}
              >
                <span className="break-keep">
                  {raceTitle(r)} · {r.distance}m
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {r.result && <Chip gate={r.result.order[0]} />}
                  {w?.name}
                  {r.tickets.length > 0 && <span className="text-brass">· 내 마권 {r.tickets.length}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
