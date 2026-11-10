"use client";

import { ITEM_GRADE_LABEL, itemEffect, type PlayerState } from "@/lib/game";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";

/**
 * 자리를 비운 사이 체력이 0까지 떨어졌을 때 뜨는 창.
 *
 * 게임을 하다 0이 된 경우에는 곧바로 병동으로 가므로 이 창은 뜨지 않는다.
 * 시간이 흘러서 쓰러진 경우에만, 가진 음식을 바로 먹을 기회를 준다.
 */
export default function CollapsePopup({
  state,
  busy,
  onUse,
}: {
  state: PlayerState;
  busy: boolean;
  onUse: (code: string) => void;
}) {
  // 병동 밖에서 지금 바로 회복에 쓸 수 있는 것만
  const food = (state.items ?? []).filter(
    (i) => i.heal > 0 && i.qty > 0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg-0/80 p-4 tab:items-center">
      <div className="border-line w-full max-w-sm border bg-bg-1">
        <div className="border-line-soft border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">체력 소진 통보</MonoLabel>
        </div>

        <div className="flex flex-col gap-1 p-4">
          <p className="title-19 text-loss">체력이 0이 되었다.</p>
          <p className="body-15 text-fg-mid">
            자리를 비운 사이 떨어졌다. 지금 뭔가 먹으면 아직 안 실려 간다.
          </p>

          {food.length === 0 ? (
            <p className="scanline-faint mono-13 border-line mt-3 border border-dashed bg-bg-2 px-3 py-3 text-center text-fg">
              먹을 것이 없다. 곧 병동으로 옮겨진다.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {food.map((it) => (
                <li
                  key={it.code}
                  className="bg-surface flex items-center gap-2.5 p-2.5"
                >
                  <ItemMark kind={it.kind} grade={it.grade} emoji={it.emoji} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="body-15 text-fg-hi truncate">
                        {it.name}
                      </span>
                      <MonoLabel tone="low">
                        {ITEM_GRADE_LABEL[it.grade]}
                      </MonoLabel>
                    </div>
                    <p className="mono-13 text-fg-mid truncate">
                      {itemEffect(it)} · {it.qty}개
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUse(it.code)}
                    className="label-11 border-brass-line state-fade shrink-0 border bg-brass-fill px-4 py-3 text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
                  >
                    먹기
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mono-13 text-fg-low mt-3">
            체력이 0인 동안에는 판에 앉을 수 없다.
          </p>
        </div>
      </div>
    </div>
  );
}
