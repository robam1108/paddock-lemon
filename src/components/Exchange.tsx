"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ITEM_GRADE_LABEL,
  ITEM_KIND_LABEL,
  TRADE_STATUS_LABEL,
  formatDuration,
  itemEffect,
  toKoreanError,
  type ItemDef,
  type PlayerState,
  type Trade,
  type TradeItem,
} from "@/lib/game";
import TabRail from "./ui/TabRail";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";
import BuyConfirm from "./ui/BuyConfirm";

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

/** 명조로 찍은 섹션 제목. 이 구역에서만 쓴다. */
function HandLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-hand text-brass text-[24px] leading-[1.15] font-semibold">
      {children}
    </span>
  );
}

/** 코인 + 아이템 묶음을 한 줄로 */
function OfferLine({
  coins,
  items,
  empty = "없음",
}: {
  coins: number;
  items: TradeItem[];
  empty?: string;
}) {
  if (coins === 0 && items.length === 0) {
    return <span className="text-fg-low">{empty}</span>;
  }
  return (
    <span className="text-fg">
      {coins > 0 && <span className="text-brass">{coins} 코인</span>}
      {coins > 0 && items.length > 0 && <span className="text-fg-low"> + </span>}
      {items.map((i, n) => (
        <span key={i.code}>
          {n > 0 && <span className="text-fg-low">, </span>}
          {i.name} ×{i.qty}
        </span>
      ))}
    </span>
  );
}

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


  const toPayload = (picks: Record<string, number>) =>
    Object.entries(picks)
      .filter(([, q]) => q > 0)
      .map(([code, qty]) => ({ code, qty }));

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

  const primary =
    "state-fade label-11 border-brass-line border bg-brass-fill px-4 py-3 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";
  const plain =
    "state-fade label-11 border-line border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

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
                        className={`${primary} ml-auto flex w-24 shrink-0 flex-col items-center justify-center gap-0.5 text-center`}
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
              className={`${primary} title-19 min-h-12`}
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
                {shownTrades.map((t) => {
                  const open =
                    t.status === "offered" || t.status === "countered";
                  // 끝난 건은 끝난 종이다. 바닥보다 더 어두운 면으로 내려
                  // 앉히고 글자도 한 단 죽여서, 아직 굴러가는 건과 갈라 놓는다.
                  const done = t.status === "done";
                  const closed = done || t.status === "cancelled";
                  return (
                    <li
                      key={t.id}
                      className={`flex flex-col gap-1.5 border p-3 ${
                        closed
                          ? "border-line-soft/50 bg-bg-0 text-fg-mid"
                          : "border-line-soft bg-surface"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span
                          className={`body-15 ${closed ? "text-fg-mid" : "text-fg-hi"}`}
                        >
                          {t.partner}
                        </span>
                        {t.is_gift && <MonoLabel>선물</MonoLabel>}
                        <span
                          className={`label-11 ml-auto ${
                            t.my_turn ? "text-brass" : "text-fg-low"
                          }`}
                        >
                          {t.my_turn
                            ? "내 차례"
                            : done
                              ? `✓ ${TRADE_STATUS_LABEL[t.status]}`
                              : TRADE_STATUS_LABEL[t.status]}
                        </span>
                      </div>

                      <div
                        className={`mono-13 flex flex-col gap-0.5 ${
                          closed ? "opacity-65" : ""
                        }`}
                      >
                        <p>
                          <span className="text-fg-low">줄 것 </span>
                          <OfferLine coins={t.my_coins} items={t.my_items} />
                        </p>
                        <p>
                          <span className="text-fg-low">받을 것 </span>
                          <OfferLine
                            coins={t.their_coins}
                            items={t.their_items}
                            empty={t.is_gift ? "선물" : "아직 미정"}
                          />
                        </p>
                      </div>

                      {open && (
                        <MonoLabel tone="low">
                          {formatDuration(t.expires_in)} 후 만료
                        </MonoLabel>
                      )}

                      {/* 받은 쪽: 수락(선물) / 되보내기 / 거절 */}
                      {t.my_turn && t.status === "offered" && (
                        <div className="flex flex-col gap-1.5">
                          {t.is_gift ? (
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                disabled={busyAll}
                                onClick={() =>
                                  call("trade_respond", {
                                    p_id: t.id,
                                    p_action: "accept",
                                  })
                                }
                                className={primary}
                              >
                                받기
                              </button>
                              <button
                                type="button"
                                disabled={busyAll}
                                onClick={() =>
                                  call("trade_respond", {
                                    p_id: t.id,
                                    p_action: "decline",
                                  })
                                }
                                className={plain}
                              >
                                거절
                              </button>
                            </div>
                          ) : counterFor === t.id ? (
                            <div className="bg-bg-2 flex flex-col gap-2 p-2.5">
                              <MonoLabel>내가 내놓을 것</MonoLabel>
                              <Picker
                                items={myItems}
                                coins={cCoins}
                                maxCoins={state.coins}
                                picked={cPicked}
                                onCoins={setCCoins}
                                onPick={setCPicked}
                              />
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  disabled={busyAll}
                                  onClick={async () => {
                                    const ok = await call("trade_respond", {
                                      p_id: t.id,
                                      p_action: "counter",
                                      p_coins: cCoins,
                                      p_items: toPayload(cPicked),
                                    });
                                    if (ok) {
                                      setCounterFor(null);
                                      setCCoins(0);
                                      setCPicked({});
                                    }
                                  }}
                                  className={`${primary} flex-1`}
                                >
                                  보내기
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCounterFor(null)}
                                  className={plain}
                                >
                                  취소
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                disabled={busyAll}
                                onClick={() => {
                                  setCounterFor(t.id);
                                  setCCoins(0);
                                  setCPicked({});
                                }}
                                className={primary}
                              >
                                조건 붙여 되보내기
                              </button>
                              <button
                                type="button"
                                disabled={busyAll}
                                onClick={() =>
                                  call("trade_respond", {
                                    p_id: t.id,
                                    p_action: "decline",
                                  })
                                }
                                className={plain}
                              >
                                거절
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 제안자: 최종 수락 / 거절 */}
                      {t.my_turn && t.status === "countered" && (
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            disabled={busyAll}
                            onClick={() =>
                              call("trade_finalize", {
                                p_id: t.id,
                                p_accept: true,
                              })
                            }
                            className={primary}
                          >
                            성사
                          </button>
                          <button
                            type="button"
                            disabled={busyAll}
                            onClick={() =>
                              call("trade_finalize", {
                                p_id: t.id,
                                p_accept: false,
                              })
                            }
                            className={plain}
                          >
                            거절
                          </button>
                        </div>
                      )}

                      {open && !t.my_turn && (
                        <button
                          type="button"
                          disabled={busyAll}
                          onClick={() => call("trade_cancel", { p_id: t.id })}
                          className={plain}
                        >
                          거래 물리기
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              {(showAllTrades || hiddenTradeCount > 0) && (
                <button
                  type="button"
                  onClick={() => setShowAllTrades((v) => !v)}
                  className={plain}
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

/** 코인/아이템 고르기 */
function Picker({
  items,
  coins,
  maxCoins,
  picked,
  onCoins,
  onPick,
}: {
  items: PlayerState["items"];
  coins: number;
  maxCoins: number;
  picked: Record<string, number>;
  onCoins: (n: number) => void;
  onPick: (p: Record<string, number>) => void;
}) {
  // qty=0 인 항목은 봉인된 갑이 없다는 뜻이다 — 개봉한 갑의 남은 개비(open_left)
  // 만 있는 상태라 넘길 수 없으므로 목록에서도 뺀다.
  const tradable = items.filter((i) => i.tradable && i.qty > 0);

  return (
    <div className="flex flex-col gap-1">
      {/* 빠른 버튼 때문에 좁은 화면에선 한 줄에 안 들어간다 — 줄을 바꿔 증감기를 아래로 내린다. */}
      <div className="bg-surface flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <span className="body-15 text-fg min-w-12 flex-1 truncate">코인</span>
        <div className="ml-auto max-w-full">
          <Stepper value={coins} max={maxCoins} accent quick onChange={onCoins} />
        </div>
      </div>

      {tradable.length === 0 ? (
        <p className="mono-13 text-fg-low px-3 py-1">내놓을 물건이 없습니다.</p>
      ) : (
        tradable.map((it) => {
          const n = picked[it.code] ?? 0;
          return (
            <div
              key={it.code}
              className="bg-surface flex items-center gap-2 px-3 py-2"
            >
              <ItemMark kind={it.kind} grade={it.grade} emoji={it.emoji} size="sm" />
              <span className="body-15 text-fg min-w-0 flex-1 truncate">
                {it.name}
                <span className="text-fg-low"> 보유 {it.qty}</span>
              </span>
              <Stepper
                value={n}
                max={it.qty}
                onChange={(v) => onPick({ ...picked, [it.code]: v })}
              />
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * 코인과 아이템이 같은 간격으로 보이도록 폭을 고정한 증감기.
 * quick을 켜면 ±10, ±100 버튼이 양옆에 붙어 그만큼만 폭이 넓어진다.
 */
function Stepper({
  value,
  max,
  accent,
  quick,
  onChange,
}: {
  value: number;
  max: number;
  accent?: boolean;
  /** ±10, ±100 버튼을 양옆에 붙인다. 코인처럼 자릿수가 큰 값에만 쓴다. */
  quick?: boolean;
  onChange: (n: number) => void;
}) {
  // 0과 보유량 사이로 자르는 건 여기 한 곳에서만 한다.
  const set = (delta: number) =>
    onChange(Math.max(0, Math.min(max, value + delta)));

  const btn =
    "border-line state-fade h-9 w-9 shrink-0 border bg-surface-hi text-fg disabled:text-fg-low";
  const quickCls =
    "label-11 state-fade border-line h-9 min-w-0 overflow-hidden border bg-surface-hi px-1.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

  // 빠른 버튼이 있으면 좁은 화면에서 버튼만 줄어들어 부모 폭 안에 머문다.
  return (
    <div
      className={`flex items-center gap-1 ${quick ? "min-w-0 max-w-full" : "shrink-0"}`}
    >
      {quick && (
        <>
          <button
            type="button"
            onClick={() => set(-100)}
            disabled={value === 0}
            aria-label="100 줄이기"
            className={quickCls}
          >
            -100
          </button>
          <button
            type="button"
            onClick={() => set(-10)}
            disabled={value === 0}
            aria-label="10 줄이기"
            className={quickCls}
          >
            -10
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => set(-1)}
        disabled={value === 0}
        aria-label="줄이기"
        className={btn}
      >
        ＜
      </button>
      <span
        className={`mono-13 w-10 shrink-0 text-center tabular-nums ${
          accent ? "text-brass" : "text-fg-hi"
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => set(1)}
        disabled={value >= max}
        aria-label="늘리기"
        className={btn}
      >
        ＞
      </button>
      {quick && (
        <>
          <button
            type="button"
            onClick={() => set(10)}
            disabled={value >= max}
            aria-label="10 늘리기"
            className={quickCls}
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => set(100)}
            disabled={value >= max}
            aria-label="100 늘리기"
            className={quickCls}
          >
            +100
          </button>
        </>
      )}
    </div>
  );
}
