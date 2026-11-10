"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ITEM_GRADE_LABEL,
  ITEM_KIND_LABEL,
  itemEffect,
  toKoreanError,
  type ItemDef,
  type PlayerState,
  type Trade,
} from "@/lib/game";
import TabRail from "./ui/TabRail";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";
import BuyConfirm from "./ui/BuyConfirm";
import { HandLabel, Picker, PLAIN, PRIMARY, toPayload } from "./exchange/parts";
import TradeCard from "./exchange/TradeCard";

import { usePageVisible } from "@/hooks/usePageVisible";

/**
 * 상점 · 개인 거래.
 *
 * 다른 화면과 톤을 나누려고 배경이 hue 70(마분지)으로 넘어가고,
 * 섹션 제목만 명조로 적는다.
 */

type Tab = "depot" | "trade";

const TABS: { id: Tab; label: string }[] = [
  { id: "depot", label: "상점" },
  { id: "trade", label: "개인 거래" },
];

export default function Exchange({
  supabase,
  state,
  busy,
  onBuyItem,
  onRefresh,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  /** 구매 성공 여부를 돌려준다 — 성공하면 상점 수량 표시를 그 자리에서 올린다 */
  onBuyItem: (code: string, qty: number) => Promise<boolean>;
  /** 거래가 성사되면 코인·가방을 다시 읽어야 한다 */
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<Tab>("depot");
  const visible = usePageVisible();
  const [catalog, setCatalog] = useState<ItemDef[]>([]);
  // 상점에서 사기 전 한 번 물어본다. 스냅샷이 아니라 코드만 들고 있다가
  // 목록에서 다시 찾는다 — 갱신된 bought 가 팝업에도 그대로 반영되어야 하기 때문이다.
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
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

  // 처음 한 번, 그리고 구매한 뒤마다 서버 값과 맞춘다.
  const loadCatalog = useCallback(async () => {
    const { data } = await supabase.rpc("shop_catalog");
    if (data) setCatalog(data as ItemDef[]);
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

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // 거래는 상대 행동을 기다려야 하므로 주기적으로 확인한다.
  useEffect(() => {
    if (tab !== "trade" || !visible) return;
    loadTrades();
    const timer = window.setInterval(loadTrades, 4000);
    return () => window.clearInterval(timer);
  }, [tab, visible, loadTrades]);

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

  /**
   * 상점 구매.
   *
   * buy_item 은 state_json 만 돌려주므로 화면의 catalog(오늘 n/3개)는 그대로다.
   * 새로고침해야 숫자가 오르던 게 이 때문이었다. 먼저 손에 든 값을 올려 즉시
   * 1/3 -> 2/3 이 되게 하고, 이어서 shop_catalog 로 서버 값과 맞춘다 —
   * 낙관적으로 올린 값이 틀렸더라도 한 박자 뒤에 제자리를 찾는다.
   */
  const buy = useCallback(
    async (code: string, qty: number) => {
      const ok = await onBuyItem(code, qty);
      if (!ok) return;

      setCatalog((prev) =>
        prev.map((it) =>
          it.code === code ? { ...it, bought: (it.bought ?? 0) + qty } : it,
        ),
      );
      loadCatalog();
    },
    [onBuyItem, loadCatalog],
  );

  const confirmItem = confirmCode
    ? (catalog.find((i) => i.code === confirmCode) ?? null)
    : null;


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
      <TabRail
        items={TABS}
        value={tab}
        onChange={(id) => {
          setTab(id);
          setError(null);
        }}
        marker="left"
        columns="grid-cols-3"
        height="h-10"
      />

      {error && (
        <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">
          {error}
        </p>
      )}

      {/* ── 상점 ── */}
      {tab === "depot" && (
        <section className="bg-bg-1 flex flex-col gap-2 p-4">
          <HandLabel>오늘의 상품</HandLabel>
          <p className="body-15 text-fg-mid">
            사람마다 다르게 진열되고, 자정에 바뀝니다.
          </p>

          {catalog.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              오늘은 진열된 상품이 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {catalog.map((it) => {
                const capped =
                  it.daily_cap !== undefined && (it.bought ?? 0) >= it.daily_cap;

                return (
                  <li
                    key={it.code}
                    className="border-line-soft flex flex-col gap-2 border bg-surface p-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <ItemMark kind={it.kind} grade={it.grade} emoji={it.emoji} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="body-15 text-fg-hi">{it.name}</span>
                          <MonoLabel tone="low">
                            {ITEM_GRADE_LABEL[it.grade]} ·{" "}
                            {ITEM_KIND_LABEL[it.kind] ?? it.kind}
                          </MonoLabel>
                          {it.list_price != null && <MonoLabel>할인</MonoLabel>}
                        </div>
                        <p className="mono-13 text-fg-mid">{itemEffect(it)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {it.daily_cap !== undefined && (
                        <MonoLabel tone="low">
                          오늘 {it.bought ?? 0}/{it.daily_cap}개
                        </MonoLabel>
                      )}
                      <button
                        type="button"
                        disabled={
                          busyAll ||
                          it.buy_price === null ||
                          capped ||
                          state.coins < (it.buy_price ?? 0)
                        }
                        onClick={() => setConfirmCode(it.code)}
                        className={`${PRIMARY} ml-auto flex w-24 shrink-0 flex-col items-center justify-center gap-0.5 text-center`}
                      >
                        {capped ? (
                          "품절"
                        ) : (
                          <>
                            {it.list_price != null && (
                              <span className="label-11 text-fg-low line-through">
                                {it.list_price}
                              </span>
                            )}
                            <span>{it.buy_price} 코인</span>
                          </>
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ── 개인 거래 ── */}
      {tab === "trade" && (
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
      )}

      {/* 구매 확인 팝업 — 바로 사지지 않게 한 번 물어본다. */}
      {confirmItem && (
        <BuyConfirm
          item={confirmItem}
          price={confirmItem.buy_price ?? 0}
          original={confirmItem.list_price ?? undefined}
          busy={busyAll}
          buyDisabled={state.coins < (confirmItem.buy_price ?? 0)}
          onConfirm={() => {
            buy(confirmItem.code, 1);
            setConfirmCode(null);
          }}
          onCancel={() => setConfirmCode(null)}
        />
      )}
    </div>
  );
}
