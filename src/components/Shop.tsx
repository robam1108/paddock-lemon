"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ITEM_GRADE_LABEL,
  ITEM_KIND_LABEL,
  itemEffect,
  type ItemDef,
  type PlayerState,
} from "@/lib/game";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";
import BuyConfirm from "./ui/BuyConfirm";
import { HandLabel, PRIMARY } from "./exchange/parts";

/**
 * 상점.
 *
 * 다른 화면과 톤을 나누려고 골드 기운이 도는 크림 배경으로 넘어가고,
 * 섹션 제목만 명조로 적는다.
 */
export default function Shop({
  supabase,
  state,
  busy,
  onBuyItem,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  /** 구매 성공 여부를 돌려준다 — 성공하면 상점 수량 표시를 그 자리에서 올린다 */
  onBuyItem: (code: string, qty: number) => Promise<boolean>;
}) {
  const [catalog, setCatalog] = useState<ItemDef[]>([]);
  // 사기 전 한 번 물어본다. 스냅샷이 아니라 코드만 들고 있다가
  // 목록에서 다시 찾는다 — 갱신된 bought 가 팝업에도 그대로 반영되어야 하기 때문이다.
  const [confirmCode, setConfirmCode] = useState<string | null>(null);

  // 처음 한 번, 그리고 구매한 뒤마다 서버 값과 맞춘다.
  const loadCatalog = useCallback(async () => {
    const { data } = await supabase.rpc("shop_catalog");
    if (data) setCatalog(data as ItemDef[]);
  }, [supabase]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  /**
   * 구매.
   *
   * buy_item 은 state_json 만 돌려주므로 화면의 catalog(오늘 n/3개)는 그대로다.
   * 먼저 손에 든 값을 올려 즉시 1/3 -> 2/3 이 되게 하고, 이어서 shop_catalog 로
   * 서버 값과 맞춘다 — 낙관적으로 올린 값이 틀렸더라도 한 박자 뒤에 제자리를 찾는다.
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

  return (
    <div className="flex flex-col gap-2">
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
                        busy ||
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

      {/* 구매 확인 팝업 — 바로 사지지 않게 한 번 물어본다. */}
      {confirmItem && (
        <BuyConfirm
          item={confirmItem}
          price={confirmItem.buy_price ?? 0}
          original={confirmItem.list_price ?? undefined}
          busy={busy}
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
