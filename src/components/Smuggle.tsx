"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ITEM_GRADE_LABEL,
  ITEM_KIND_LABEL,
  formatDuration,
  itemEffect,
  toKoreanError,
  type ItemDef,
  type LastCardPurpose,
  type LastCardView,
  type PlayerState,
  type SmuggleState,
  type StealResult,
} from "@/lib/game";
import {
  LASTCARD_RULE_LINES,
  SMUGGLE_LINES,
  SMUGGLE_REROLL_BUTTON,
  SMUGGLE_REROLL_CONFIRM,
  SMUGGLE_REROLL_DONE,
  SMUGGLE_SPECIAL_BUTTON,
  SMUGGLE_SPECIAL_LOST,
  SMUGGLE_SPECIAL_OFFER,
  SMUGGLE_SPECIAL_WON,
  SMUGGLE_UNLOCK_LOST,
  SMUGGLE_WELCOME,
} from "@/lib/copy";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";
import BuyConfirm from "./ui/BuyConfirm";
import LastCard from "./LastCard";

/**
 * 밀거래 — 거래소의 세 번째 칸.
 *
 * 미해금일 때는 얼굴 없는 상대와 대사를 주고받다가 라스트 카드로 이어지고,
 * 해금 후에는 배급소와 같은 모양의 목록이 된다. 사진 칸은 수감기록 › 신상의
 * 것과 치수를 맞춰 뒀다 — 나중에 img 한 줄만 끼우면 되게.
 *
 * NPC(사진 + 대사) 영역은 상태와 무관하게 항상 위에 고정해 두고, 그 아래에
 * 라스트 카드 판이나 물건 목록을 갈아 끼운다. 버튼만 상황에 따라 붙었다
 * 떨어진다.
 *
 * 승부는 마지막으로 붙은 지 5시간이 지나야 다시 걸 수 있다. 서버는 남은 초를
 * 한 번 내려줄 뿐이라, 화면 쪽에서 마감 시각을 잡아 두고 30초마다 다시 센다.
 */

const primary =
  "state-fade label-11 border-brass-line border bg-brass-fill px-4 py-3 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";

function HandLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-hand text-brass text-[24px] leading-[1.15] font-semibold">
      {children}
    </span>
  );
}

function PhotoSlot() {
  const [broken, setBroken] = useState(false);
  return (
    <div className="scanline-faint border-line relative mx-auto flex h-[152px] w-[132px] items-center justify-center overflow-hidden border border-dashed bg-bg-0">
      {!broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/npc/smuggler.jpg"
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function Lines({ lines }: { lines: readonly [string, string, string] }) {
  return (
    <div className="flex flex-col gap-1">
      {[0, 1, 2].map((i) => (
        <p key={i} className="body-15 text-fg text-center">
          {lines[i] || " "}
        </p>
      ))}
    </div>
  );
}

/** 승부를 다시 걸 수 있을 때까지. 버튼이 있어야 할 자리에 대신 놓인다. */
function CooldownLine({ left }: { left: number }) {
  return (
    <p className="text-center">
      <MonoLabel tone="low">
        다음 승부까지 {left < 60 ? "1분 미만" : formatDuration(left)}
      </MonoLabel>
    </p>
  );
}

function ItemRow({
  item,
  price,
  original,
  disabled,
  sold,
  poor,
  canSteal,
  highlight,
  onBuy,
}: {
  item: ItemDef;
  price: number;
  /** 할인가일 때만: 원래 값 */
  original?: number;
  disabled: boolean;
  /** 오늘 이미 가져간 물건이다 — 버튼을 값 대신 이 상태로 고정한다 */
  sold: boolean;
  /** 값을 치를 코인이 없다 */
  poor: boolean;
  /** 훔칠 수 있는 물건이다 — 그러면 코인이 모자라도 팝업은 열어 준다 */
  canSteal: boolean;
  /** 정규 상시분이 아니라 특별히 얹힌 물건(특별 상품·가축권)이면 켠다 */
  highlight?: boolean;
  onBuy: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 border p-3 ${
        highlight
          ? "border-brass-line bg-brass-fill/15"
          : "border-line-soft bg-surface"
      }`}
    >
      <ItemMark kind={item.kind} grade={item.grade} emoji={item.emoji} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5">
          <span className="body-15 text-fg-hi">{item.name}</span>
          <MonoLabel tone="low">
            {ITEM_GRADE_LABEL[item.grade]} · {ITEM_KIND_LABEL[item.kind] ?? item.kind}
          </MonoLabel>
        </div>
        <p className="mono-13 text-fg-mid truncate">{itemEffect(item)}</p>
      </div>
      <button
        type="button"
        disabled={disabled || sold || (poor && !canSteal)}
        onClick={onBuy}
        className={`${primary} flex w-24 shrink-0 flex-col items-center justify-center gap-0.5`}
      >
        {sold ? (
          <span className="text-fg-low">가져감</span>
        ) : (
          <>
            {original != null && (
              <span className="label-11 text-fg-low line-through">{original}</span>
            )}
            <span>{price} 코인</span>
          </>
        )}
      </button>
    </div>
  );
}

export default function Smuggle({
  supabase,
  state,
  busy,
  onRefresh,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  /** 코인이 바뀌므로 거래소 전체(Casino)의 상태도 다시 읽어야 한다 */
  onRefresh: () => void;
}) {
  const [data, setData] = useState<SmuggleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [confirmItem, setConfirmItem] = useState<{
    item: ItemDef;
    price: number;
  } | null>(null);
  /** 다시 보기 버튼을 한 번 눌러 확인을 묻는 중인지 */
  const [rerollAsk, setRerollAsk] = useState(false);
  // 훔치기 결과. 오면 같은 팝업이 결과 화면으로 바뀐다.
  const [stealOutcome, setStealOutcome] = useState<StealResult | null>(null);
  /** 다음 승부까지 남은 초 */
  const [left, setLeft] = useState(0);
  /** 남은 초를 받은 순간 기준으로 잡아 둔 마감 시각(ms) */
  const deadline = useRef(0);

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc("smuggle_state");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    if (d) {
      const next = d as SmuggleState;
      // smuggle.sql 을 아직 안 올린 DB 라면 이 값이 없다. 없으면 쿨다운도 없다.
      const rest = next.cooldown_left ?? 0;
      deadline.current = Date.now() + rest * 1000;
      setLeft(rest);
      setData(next);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // 분 단위로만 보여 주므로 30초에 한 번이면 충분하다.
  // 다 식으면 서버 상태를 한 번 더 읽어 버튼을 되살린다.
  const counting = left > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => {
      const rest = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setLeft(rest);
      if (rest === 0) load();
    }, 30_000);
    return () => clearInterval(id);
  }, [counting, load]);

  const start = useCallback(
    async (purpose: LastCardPurpose): Promise<LastCardView | null> => {
      setWorking(true);
      const { data: d, error: e } = await supabase.rpc("lastcard_start", {
        p_purpose: purpose,
      });
      setWorking(false);
      if (e || !d) {
        setError(toKoreanError(e?.message));
        return null;
      }
      setError(null);
      return d as LastCardView;
    },
    [supabase],
  );

  const playCard = useCallback(
    async (card: number): Promise<LastCardView | null> => {
      setWorking(true);
      const { data: d, error: e } = await supabase.rpc("lastcard_play", {
        p_card: card,
      });
      setWorking(false);
      if (e || !d) {
        setError(toKoreanError(e?.message));
        return null;
      }
      setError(null);
      return d as LastCardView;
    },
    [supabase],
  );

  const buy = useCallback(
    async (code: string, qty: number) => {
      setWorking(true);
      const { data: d, error: e } = await supabase.rpc("smuggle_buy", {
        p_code: code,
        p_qty: qty,
      });
      setWorking(false);
      if (e || !d) {
        setError(toKoreanError(e?.message));
        return;
      }
      setError(null);
      onRefresh();
      load();
    },
    [supabase, onRefresh, load],
  );

  /** 상시분 다시 보기. 하루 한 번, 처음 칸·특별 상품과 겹치지 않는 새 칸으로 갈아엎는다. */
  const reroll = useCallback(async () => {
    setWorking(true);
    const { data: d, error: e } = await supabase.rpc("smuggle_reroll");
    setWorking(false);
    setRerollAsk(false);
    if (e || !d) {
      setError(toKoreanError(e?.message));
      return;
    }
    setError(null);
    onRefresh();
    load();
  }, [supabase, onRefresh, load]);

  /** 밀거래 훔치기. 하루 한 번이고, 배급소 시도권과는 별개다. */
  const steal = useCallback(
    async (code: string) => {
      setWorking(true);
      const { data, error: e } = await supabase.rpc("smuggle_steal", {
        p_code: code,
      });
      setWorking(false);

      if (e || !data) {
        setError(toKoreanError(e?.message));
        setConfirmItem(null);
        return;
      }

      setError(null);
      setStealOutcome((data as { steal: StealResult }).steal);
      onRefresh();
      load();
    },
    [supabase, onRefresh, load],
  );

  const busyAll = busy || working;

  const errorLine = error && (
    <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">
      {error}
    </p>
  );

  if (!data) {
    return errorLine ?? null;
  }

  // ── 미해금: 대화 ──
  if (!data.unlocked) {
    const g = data.game;
    const playing = g?.status === "playing";
    // 쿨다운 중이라는 건 방금 붙었다가 졌다는 뜻이다.
    const cooling = !playing && left > 0;
    const step = SMUGGLE_LINES[stage];
    const lines = playing
      ? LASTCARD_RULE_LINES
      : cooling
        ? SMUGGLE_UNLOCK_LOST
        : step.lines;

    return (
      <div className="flex flex-col gap-2">
        <section className="bg-bg-1 flex flex-col gap-4 p-4">
          {errorLine}

          <PhotoSlot />

          <Lines lines={lines} />

          {cooling && <CooldownLine left={left} />}

          {!playing && !cooling && (
            <button
              type="button"
              disabled={busyAll}
              onClick={async () => {
                if (stage < 2) {
                  setStage((s) => (s + 1) as 0 | 1 | 2);
                  return;
                }
                const game = await start("unlock");
                if (game) setData((d) => (d ? { ...d, game } : d));
              }}
              className={`${primary} title-19 min-h-12`}
            >
              {step.button}
            </button>
          )}
        </section>

        {playing && g && (
          <LastCard game={g} busy={busyAll} onPlay={playCard} onDone={load} />
        )}
      </div>
    );
  }

  // ── 해금 후 ──
  const g = data.game;
  const specialPlaying = g?.status === "playing";
  // 오늘 몫이 이미 열렸으면 더 붙을 이유가 없다. 자정이 지나면 다시 닫힌다.
  const specials = data.specials ?? (data.special ? [data.special] : []);
  const opened = data.special_open ?? specials.length > 0;
  const canPlay = !specialPlaying && !opened && left === 0;

  let npcLines: readonly [string, string, string];
  let npcButton: { label: string; onClick: () => void } | null = null;

  if (specialPlaying) {
    npcLines = LASTCARD_RULE_LINES;
  } else if (canPlay) {
    npcLines = SMUGGLE_SPECIAL_OFFER;
    npcButton = {
      label: SMUGGLE_SPECIAL_BUTTON,
      onClick: async () => {
        const game = await start("special");
        if (game) setData((d) => (d ? { ...d, game } : d));
      },
    };
  } else if (opened) {
    npcLines = SMUGGLE_SPECIAL_WON;
  } else if (g?.purpose === "unlock") {
    // 방금 해금한 판. 특별 상품은 이 쿨다운이 끝나야 걸 수 있다.
    npcLines = SMUGGLE_WELCOME;
  } else if (g?.status === "won") {
    npcLines = SMUGGLE_SPECIAL_WON;
  } else if (g?.status === "lost") {
    npcLines = SMUGGLE_SPECIAL_LOST;
  } else {
    npcLines = SMUGGLE_SPECIAL_OFFER;
  }

  const shelf: {
    item: ItemDef;
    price: number;
    original?: number;
    highlight?: boolean;
  }[] = [
    ...data.items.map((it) => ({ item: it, price: it.buy_price ?? 0 })),
    ...specials.map((sp) => ({
      item: sp.item,
      price: sp.price,
      original: sp.list_price ?? undefined,
      highlight: true,
    })),
    ...(data.livestock
      ? [{ item: data.livestock.item, price: data.livestock.price, highlight: true }]
      : []),
    ...(data.title
      ? [{ item: data.title.item, price: data.title.price, highlight: true }]
      : []),
  ];
  const bought = data.bought ?? [];
  const rerollPrice = data.reroll_price ?? 30;

  /**
   * 훔칠 수 있는 물건인가.
   * 증서(가축 지목권·호칭권)는 제외 — 값이 따로 매겨져 있고 되팔 수도 없어서
   * 실패 벌칙의 기준인 "물건 가액" 자체가 서지 않는다. 절도비법(trick)도
   * 제외 — 훔치기 요령을 훔쳐서 배운다는 게 앞뒤가 안 맞는다. 서버도 같이 막는다.
   */
  const stealable = (item: ItemDef) =>
    !data.steal_used &&
    !state.in_ward &&
    item.kind !== "permit" &&
    item.kind !== "trick" &&
    !bought.includes(item.code);

  return (
    <div className="flex flex-col gap-2">
      <section className="bg-bg-1 flex flex-col gap-4 p-4">
        {errorLine}

        <PhotoSlot />

        <Lines lines={npcLines} />

        {!specialPlaying && !opened && left > 0 && <CooldownLine left={left} />}

        {npcButton && (
          <button
            type="button"
            disabled={busyAll}
            onClick={npcButton.onClick}
            className={`${primary} title-19 min-h-12`}
          >
            {npcButton.label}
          </button>
        )}
      </section>

      {specialPlaying && g ? (
        <LastCard game={g} busy={busyAll} onPlay={playCard} onDone={load} />
      ) : (
        <section className="bg-bg-1 flex flex-col gap-2 p-4">
          <HandLabel>오늘 들어온 것</HandLabel>

          {shelf.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              오늘은 들어온 게 없다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shelf.map(({ item, price, original, highlight }) => {
                const sold = bought.includes(item.code);
                return (
                  <li key={item.code}>
                    <ItemRow
                      item={item}
                      price={price}
                      original={original}
                      highlight={highlight}
                      disabled={busyAll}
                      sold={sold}
                      poor={state.coins < price}
                      canSteal={stealable(item)}
                      onBuy={() => setConfirmItem({ item, price })}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {/* 다시 보기 — 하루 한 번. 첫 탭은 묻기만 하고, 두 번째 탭에 코인이 나간다. */}
          {data.rerolled ? (
            <p className="text-center">
              <MonoLabel tone="low">{SMUGGLE_REROLL_DONE}</MonoLabel>
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {rerollAsk && (
                <p className="body-15 text-fg text-center">{SMUGGLE_REROLL_CONFIRM}</p>
              )}
              <div className="flex gap-1.5">
                {rerollAsk && (
                  <button
                    type="button"
                    disabled={busyAll}
                    onClick={() => setRerollAsk(false)}
                    className="state-fade label-11 border-line-soft bg-surface text-fg-mid flex-1 border px-4 py-3"
                  >
                    그만둔다
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAll || state.coins < rerollPrice}
                  onClick={() => (rerollAsk ? reroll() : setRerollAsk(true))}
                  className={`${primary} flex-1`}
                >
                  {SMUGGLE_REROLL_BUTTON} · {rerollPrice} 코인
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {confirmItem && (
        <BuyConfirm
          item={confirmItem.item}
          price={confirmItem.price}
          busy={busyAll}
          buyDisabled={state.coins < confirmItem.price}
          canSteal={stealable(confirmItem.item)}
          stealSure={state.steal_sure}
          who="밀수꾼"
          outcome={stealOutcome}
          onConfirm={async () => {
            const code = confirmItem.item.code;
            setConfirmItem(null);
            await buy(code, 1);
          }}
          onSteal={() => steal(confirmItem.item.code)}
          onCancel={() => {
            setConfirmItem(null);
            setStealOutcome(null);
          }}
        />
      )}
    </div>
  );
}
