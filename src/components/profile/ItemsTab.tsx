"use client";

import {
  isUsable,
  ITEM_GRADE_LABEL,
  ITEM_KIND_LABEL,
  itemAction,
  itemEffect,
} from "@/lib/game";
import { INSTRUMENTS } from "@/lib/gear";
import ItemMark from "../ui/ItemMark";
import MonoLabel from "../ui/MonoLabel";
import { action } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 소지품 탭 — 쓰기 · 장착 · 판매. */
export default function ItemsTab({ m }: { m: RecordModel }) {
  const {
    busy,
    equippedCount,
    gearOn,
    items,
    onUnequip,
    onUse,
    setConfirm,
    state,
    tab,
  } = m;
  return (
    <>
      {/* ── 소지품 ── */}
      {tab === "items" && (
        <section className="bg-bg-1 flex flex-col gap-2 p-4">
          <p className="body-15 text-fg-mid">
            판매하면 상점이 정해진 값에 되사 갑니다.
            다른 플레이어와 주고받으려면 개인거래를 이용하세요.
          </p>

          {items.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              소지품 없음
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {items.map((it) => (
                <li key={it.code} className="bg-surface flex flex-col gap-2 p-3">
                  <div className="flex items-center gap-2.5">
                    <ItemMark kind={it.kind} grade={it.grade} emoji={it.emoji} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="body-15 text-fg-hi">{it.name}</span>
                        <MonoLabel tone="low">
                          {ITEM_GRADE_LABEL[it.grade]} ·{" "}
                          {ITEM_KIND_LABEL[it.kind] ?? it.kind}
                        </MonoLabel>
                      </div>
                      <p className="mono-13 text-fg-mid">
                        {itemEffect(it)}

                        {(equippedCount.get(it.code) ?? 0) > 0 &&
                          ` · ${equippedCount.get(it.code)}개 장착 중`}
                        {!it.tradable && " · 거래 불가"}
                      </p>
                    </div>
                    <span className="flex flex-col items-end leading-tight">
                      {it.qty > 0 && (
                        <span className="num-md text-fg-hi tabular-nums">{it.qty}</span>
                      )}
                      {!!it.open_left && (
                        <span className="mono-13 text-fg-mid tabular-nums">
                          {it.qty > 0 ? "+" : ""}
                          {it.open_left}회분
                        </span>
                      )}
                    </span>
                  </div>

                  {it.description && (
                    <p className="body-15 text-fg-low">{it.description}</p>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {itemAction(it) === "flex_equip" ? (
                      <>
                        {/* 가진 수량까지 겹쳐 장착할 수 있어 장착·해제가 함께 뜰 수 있다. */}
                        {(equippedCount.get(it.code) ?? 0) > 0 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onUnequip(it.code)}
                            className={`${action} flex-1`}
                          >
                            해제
                          </button>
                        )}
                        {it.qty > (equippedCount.get(it.code) ?? 0) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onUse(it.code)}
                            className={`${action} flex-1`}
                          >
                            {(equippedCount.get(it.code) ?? 0) > 0 ? "하나 더 장착" : "장착"}
                          </button>
                        )}
                      </>
                    ) : itemAction(it) === "gear" && gearOn(it.code) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onUnequip(it.code)}
                        className={`${action} flex-1`}
                      >
                        해제
                      </button>
                    ) : (
                      isUsable(it) && (
                        <button
                          type="button"
                          // 휴식을 줄이는 물건은 휴식 중일 때만, 나머지 효과 아이템은
                          // 휴식 밖에서만 — 순수 꾸미기 소모품(flex_use)은 가리지 않는다.
                          disabled={
                            busy ||
                            // 네잎클로버는 한 번에 하나 — 켜진 동안은 막는다.
                            (it.kind === "charm" && !!state.luck) ||
                            (itemAction(it) === "use" &&
                              (it.ward_cut > 0 ? !state.in_ward : state.in_ward))
                          }
                          onClick={() => onUse(it.code)}
                          className={`${action} flex-1`}
                        >
                          {itemAction(it) === "radio"
                              ? "켜기"
                              : itemAction(it) === "gear"
                                ? INSTRUMENTS.has(it.code)
                                  ? "연주"
                                  : "착용"
                                : it.uses && it.uses > 1
                                ? `사용 (${it.open_left || it.uses}/${it.uses} 남음)`
                                : "사용"}
                        </button>
                      )
                    )}
                    {it.sell_price !== null && it.qty > 0 && (
                      <>
                        <button
                          type="button"
                          disabled={busy || it.qty <= (equippedCount.get(it.code) ?? 0)}
                          onClick={() =>
                            setConfirm({
                              kind: "item-sell",
                              code: it.code,
                              qty: 1,
                              name: it.name,
                              total: it.sell_price!,
                            })
                          }
                          className={`${action} flex-1`}
                        >
                          1개 판매 {it.sell_price}
                        </button>
                        {it.qty > 1 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                kind: "item-sell",
                                code: it.code,
                                qty: it.qty,
                                name: it.name,
                                total: it.sell_price! * it.qty,
                              })
                            }
                            className={`${action} flex-1`}
                          >
                            전부 판매 {it.sell_price * it.qty}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {state.in_ward && (
            <p className="scanline-faint mono-13 text-fg border-line border border-dashed px-3 py-2.5">
              휴식 중에는 휴식을 줄이는 아이템만 사용할 수 있습니다.
            </p>
          )}
        </section>
      )}

    </>
  );
}
