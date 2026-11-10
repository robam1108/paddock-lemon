"use client";

import { itemEffect, type InventoryItem, type PlayerState } from "@/lib/game";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";

/**
 * 게임 횟수 회복분이 하루 상한에 걸려 버려지거나, 체력이 이미 가득 차
 * 회복량이 넘칠 때 뜨는 확인 창. 모르고 써서 날리는 일이 없도록 미리
 * 알려주고, 그냥 닫을 수 있게 한다.
 */
export default function UseWarning({
  item,
  state,
  busy,
  onConfirm,
  onCancel,
}: {
  item: InventoryItem;
  state: PlayerState;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 약물은 bonus_plays 가 아니라 별개 하위 상한(drug_plays)을 쓰지만, 서버가
  // 이미 총량(extra_max) 기준으로 drug_left/bonus_left 를 깎아 내려주므로
  // gain/wasted 계산은 그대로 맞는다.
  const playsLeft = item.kind === "drug" ? state.drug_left : state.bonus_left;
  const gain = Math.min(item.plays, playsLeft);
  const wasted = item.plays - gain;

  const hpRoom = Math.max(0, state.hp_max - state.hp);
  const hpGain = Math.min(item.heal, hpRoom);
  const hpWasted = item.heal - hpGain;

  const Row = ({
    label,
    value,
    tone = "hi",
  }: {
    label: string;
    value: React.ReactNode;
    tone?: "hi" | "loss";
  }) => (
    <div className="flex items-baseline gap-3">
      <MonoLabel tone="low">{label}</MonoLabel>
      <span
        className={`mono-13 ml-auto text-right ${
          tone === "loss" ? "text-loss" : "text-fg-hi"
        }`}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg-0/80 p-4 tab:items-center">
      <div className="border-line w-full max-w-sm border bg-bg-1">
        <div className="border-line-soft border-b bg-surface px-4 py-2">
          <MonoLabel tone="low">사용 전 확인</MonoLabel>
        </div>

        <div className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-2.5">
            <ItemMark kind={item.kind} grade={item.grade} emoji={item.emoji} size="lg" />
            <div className="min-w-0">
              <p className="title-19 text-fg-hi truncate">{item.name}</p>
              <p className="mono-13 text-fg-mid truncate">{itemEffect(item)}</p>
            </div>
          </div>

          {wasted > 0 && (
            <>
              <p className="body-15 text-fg mt-2">
                {gain === 0
                  ? "이걸 써도 배정 횟수는 늘지 않는다."
                  : "배정 횟수는 일부만 들어간다."}
              </p>
              <p className="body-15 text-fg-mid">
                아이템에 의한 게임 횟수 회복은 식량·의약품·약물을 합쳐 1일{" "}
                {state.extra_max}회까지다. 오늘 이미 {state.extra_plays}회를 썼다.
              </p>
            </>
          )}
          {hpWasted > 0 && (
            <p className="body-15 text-fg mt-2">
              체력이 이미 {state.hp_max - hpRoom}이라, 회복량 일부가 넘친다.
            </p>
          )}

          <div className="bg-surface mt-3 flex flex-col gap-2 p-3">
            <Row
              label="실제 적용"
              value={
                <>
                  {hpGain > 0 && `체력 +${hpGain}`}
                  {hpGain > 0 && gain > 0 && " · "}
                  {gain > 0 && `배정 +${gain}`}
                  {hpGain === 0 && gain === 0 && "없음"}
                </>
              }
            />
            {wasted > 0 && (
              <Row label="버려짐 (배정)" value={`${wasted}회`} tone="loss" />
            )}
            {hpWasted > 0 && (
              <Row label="버려짐 (체력)" value={`${hpWasted}`} tone="loss" />
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="state-fade title-19 border-line min-h-12 border bg-surface text-fg-mid disabled:text-fg-low"
            >
              쓰지 않기
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
            >
              그래도 사용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
