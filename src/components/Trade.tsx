"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toKoreanError, type PlayerState, type Trade } from "@/lib/game";
import MonoLabel from "./ui/MonoLabel";
import { HandLabel, Picker, PLAIN, PRIMARY, toPayload } from "./exchange/parts";
import TradeCard from "./exchange/TradeCard";

import { usePageVisible } from "@/hooks/usePageVisible";

/**
 * 개인거래.
 *
 * 섹션 제목만 명조로 적는다. 상대 행동을 기다려야 하므로 화면이 보이는 동안 주기적으로 확인한다.
 */
export default function PrivateTrade({
  supabase,
  state,
  busy,
  onRefresh,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  /** 거래가 성사되면 코인·가방을 다시 읽어야 한다 */
  onRefresh: () => void;
}) {
  const visible = usePageVisible();
  const [members, setMembers] = useState<string[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // 새 거래 작성
  const [partner, setPartner] = useState("");
  const [gift, setGift] = useState(false);
  const [coins, setCoins] = useState(0);
  const [picked, setPicked] = useState<Record<string, number>>({});

  // 거래 기록은 진행 중인 건(없으면 최근 한 건)만 펼쳐 두고 나머지는 접는다
  const [showAllTrades, setShowAllTrades] = useState(false);

  // 되보내기 작성 (거래 id -> 내용)
  const [counterFor, setCounterFor] = useState<number | null>(null);
  const [cCoins, setCCoins] = useState(0);
  const [cPicked, setCPicked] = useState<Record<string, number>>({});

  const myItems = state.items ?? [];

  const loadTrades = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("trade_inbox");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    if (data) setTrades(data as Trade[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;

    // 거래는 접속 여부와 상관없이 모든 회원과 할 수 있다(명단에 없는 관리자 계정 포함).
    supabase.rpc("trade_partners").then(({ data }) => {
      if (active && data) setMembers(data as string[]);
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  // 거래는 상대 행동을 기다려야 하므로 주기적으로 확인한다.
  useEffect(() => {
    if (!visible) return;
    loadTrades();
    const timer = window.setInterval(loadTrades, 4000);
    return () => window.clearInterval(timer);
  }, [visible, loadTrades]);

  const call = useCallback(
    async (fn: string, args: Record<string, unknown>) => {
      setWorking(true);
      const { data, error: e } = await supabase.rpc(fn, args);
      setWorking(false);
      if (e) {
        setError(toKoreanError(e.message));
        loadTrades();
        return false;
      }
      setError(null);
      if (data) setTrades(data as Trade[]);
      onRefresh();
      return true;
    },
    [supabase, loadTrades, onRefresh],
  );

  const candidates = useMemo(
    () => members.filter((name) => name !== state.username),
    [members, state.username],
  );

  // 진행 중(내 응답 대기 포함)을 항상 위로, 그 안에서 최신 활동순.
  const sortedTrades = useMemo(() => {
    const open = (t: Trade) =>
      t.status === "offered" || t.status === "countered";
    return [...trades].sort((a, b) => {
      if (open(a) !== open(b)) return open(a) ? -1 : 1;
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });
  }, [trades]);

  // 접혀 있어도 진행 중인 거래는 전부 보인다. sortedTrades 가 진행 중을
  // 앞에 모아 두므로 앞에서 그만큼 자르면 된다.
  const shownTrades = useMemo(() => {
    if (showAllTrades) return sortedTrades;
    const openCount = sortedTrades.filter(
      (t) => t.status === "offered" || t.status === "countered",
    ).length;
    return sortedTrades.slice(0, Math.max(openCount, 1));
  }, [sortedTrades, showAllTrades]);
  const hiddenTradeCount = sortedTrades.length - shownTrades.length;

  const busyAll = busy || working;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {/* 새 거래 */}
        <section className="bg-bg-1 flex flex-col gap-2 p-4">
          <HandLabel>새로운 거래</HandLabel>

          <MonoLabel tone="low">상대</MonoLabel>
          {candidates.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-4 text-center">
              거래할 수 있는 플레이어가 없습니다.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {candidates.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setPartner(name)}
                  className={
                    partner === name
                      ? "state-fade label-11 border-brass-line border bg-brass-fill px-3.5 py-2.5 text-fg-hi"
                      : "state-fade label-11 border-line border bg-surface px-3.5 py-2.5 text-fg-mid"
                  }
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          <MonoLabel tone="low">내가 내놓을 것</MonoLabel>
          <Picker
            items={myItems}
            coins={coins}
            maxCoins={state.coins}
            picked={picked}
            onCoins={setCoins}
            onPick={setPicked}
          />

          <label className="bg-surface flex cursor-pointer items-center gap-2 px-3 py-2.5">
            <input
              type="checkbox"
              checked={gift}
              onChange={(e) => setGift(e.target.checked)}
              className="accent-brass h-4 w-4"
            />
            <span className="body-15 text-fg">그냥 준다</span>
            <span className="mono-13 text-fg-low">
              상대는 받거나 거절만 한다
            </span>
          </label>

          <button
            type="button"
            disabled={
              busyAll ||
              !partner ||
              (coins === 0 && toPayload(picked).length === 0)
            }
            onClick={async () => {
              const ok = await call("trade_offer", {
                p_to: partner,
                p_coins: coins,
                p_items: toPayload(picked),
                p_gift: gift,
              });
              if (ok) {
                setCoins(0);
                setPicked({});
                setGift(false);
              }
            }}
            className={`${PRIMARY} title-19 min-h-12`}
          >
            {partner
              ? gift
                ? `${partner}에게 보내기`
                : `${partner}에게 걸기`
              : "상대를 먼저 고르세요"}
          </button>

          <p className="body-15 text-fg-low">
            그냥 주는 게 아니면 상대가 조건을 붙여 되보내고, 내가 마지막에
            받아야 성사됩니다. 물건은 미리 묶이지 않고, 성사되는 순간 양쪽을
            다시 확인합니다.
          </p>
        </section>

        {/* 거래 기록 — 최근 한 건만 펼치고, 이전 기록은 열어서 본다 */}
        {trades.length > 0 && (
          <section className="bg-bg-1 flex flex-col gap-2 p-4">
            <HandLabel>거래 기록</HandLabel>
            <ul className="flex flex-col gap-1.5">
              {shownTrades.map((t) => (
                <TradeCard
                  key={t.id}
                  t={t}
                  myItems={myItems}
                  maxCoins={state.coins}
                  busy={busyAll}
                  call={call}
                  countering={counterFor === t.id}
                  cCoins={cCoins}
                  cPicked={cPicked}
                  onCCoins={setCCoins}
                  onCPicked={setCPicked}
                  onCounterOpen={() => {
                    setCounterFor(t.id);
                    setCCoins(0);
                    setCPicked({});
                  }}
                  onCounterSent={() => {
                    setCounterFor(null);
                    setCCoins(0);
                    setCPicked({});
                  }}
                  onCounterCancel={() => setCounterFor(null)}
                />
              ))}
            </ul>

            {(showAllTrades || hiddenTradeCount > 0) && (
              <button
                type="button"
                onClick={() => setShowAllTrades((v) => !v)}
                className={PLAIN}
              >
                {showAllTrades
                  ? "접기"
                  : `이전 기록 ${hiddenTradeCount}건 보기`}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
