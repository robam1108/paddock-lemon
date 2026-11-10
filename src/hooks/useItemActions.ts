"use client";

import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { itemAction, MILK, type InventoryItem, type PlayerState } from "@/lib/game";
import { usedItemLines, type UsedVia } from "@/lib/copy";
import { GEAR } from "@/lib/gear";

/** 상점 RPC 공통 처리 함수의 모양 (Casino 의 callStoreRpc) */
export type StoreRpc = (
  fn: string,
  args?: Record<string, unknown>,
  onError?: (message: string) => void,
) => Promise<PlayerState | null>;

/**
 * 소지품 쓰기 · 착용 · 굽기 · 섞기, 상점 사고팔기, 사진 변경.
 * 확인 창(pendingUse · pendingShare)과 결과 팝업(usedPopup · radioOpen) 상태도 여기서 들고 있다.
 */
export function useItemActions({
  state,
  stateRef,
  callStoreRpc,
  reloadRoster,
  setNotice,
}: {
  state: PlayerState;
  stateRef: MutableRefObject<PlayerState>;
  callStoreRpc: StoreRpc;
  reloadRoster: () => void;
  setNotice: Dispatch<SetStateAction<string | null>>;
}) {
  // 사용 시 효과가 버려지는 아이템을 쓰기 전 확인
  const [pendingUse, setPendingUse] = useState<InventoryItem | null>(null);
  // 함께 쓸 수 있는 음료·간식 — 혼자/함께를 고르는 창이 떠 있는 동안의 대상.
  const [pendingShare, setPendingShare] = useState<InventoryItem | null>(null);
  // 라디오를 켜면 뜨는 팝업. 닫으면 곡도 같이 꺼진다.
  const [radioOpen, setRadioOpen] = useState(false);
  // 소지품에서 쓰거나 착용한 직후 결과 팝업(copy.ts 의 usedItemLines).
  const [usedPopup, setUsedPopup] = useState<{ lines: string[]; notes: string[] } | null>(
    null,
  );

  /** 쓰기·착용·해제 RPC 를 부르고, 무엇이 바뀌었는지 팝업으로 보여준다.
   *  착용 상한(FLEX_LIMIT) 같은 실패도 같은 팝업에 문구 한 줄로 띄운다. */
  const runWithPopup = useCallback(
    async (fn: string, via: UsedVia, code: string, extra?: Record<string, unknown>) => {
      const before = stateRef.current;
      const item = before.items.find((i) => i.code === code);
      const after = await callStoreRpc(fn, { p_code: code, ...extra }, (message) =>
        setUsedPopup({ lines: [message], notes: [] }),
      );
      if (after && item) setUsedPopup(usedItemLines(item, via, before, after));
    },
    [callStoreRpc, stateRef],
  );

  const doUseItem = useCallback(
    (code: string) => runWithPopup("use_item", "use", code),
    [runWithPopup],
  );

  /** 순수 꾸미기 소모품(음료·향수) — 게임 효과가 없어 확인 팝업 없이 바로 쓴다. */
  const doFlexUse = useCallback(
    (code: string) => runWithPopup("flex_use", "flex_use", code),
    [runWithPopup],
  );

  /** 누군가와 함께 — 내 것 하나를 쓰고, 고른 사람에게도 특이사항이 붙는다. */
  const doUseTogether = useCallback(
    (code: string, mate: string) =>
      runWithPopup("use_together", "together", code, { p_with: mate }),
    [runWithPopup],
  );

  /** 라디오 — 사라지지 않고, 켤 때마다 프로필 표시가 1시간 붙는다. */
  const doRadioOn = useCallback(
    async (code: string) => {
      const ok = await callStoreRpc("radio_on", { p_code: code });
      if (ok) setRadioOpen(true);
    },
    [callStoreRpc],
  );

  /** 운동기구 — 사라지지 않고, 착용하면 프로필 표시가 1시간 붙는다. */
  const doGearOn = useCallback(
    (code: string) => runWithPopup("gear_on", "gear_on", code),
    [runWithPopup],
  );

  const doFlexEquip = useCallback(
    (code: string) => runWithPopup("flex_equip", "flex_equip", code),
    [runWithPopup],
  );


  /** 라이터로 생고구마를 굽는다. 라이터는 닳지 않는다. */
  const doRoast = useCallback(
    (code: string) => runWithPopup("roast_item", "roast", code),
    [runWithPopup],
  );

  /** 우유에 커피·아이스 커피·루이보스티를 섞는다. 팝업은 섞은 음료(drink) 쪽 이름으로 쓴다. */
  const doMix = useCallback(
    async (drink: string) => {
      const before = stateRef.current;
      const item = before.items.find((i) => i.code === drink);
      const after = await callStoreRpc("mix_item", { p_code: MILK, p_with: drink }, (message) =>
        setUsedPopup({ lines: [message], notes: [] }),
      );
      if (after && item) setUsedPopup(usedItemLines(item, "mix", before, after));
    },
    [callStoreRpc, stateRef],
  );

  const doFlexUnequip = useCallback(
    (code: string) => runWithPopup("flex_unequip", "flex_unequip", code),
    [runWithPopup],
  );

  /** 해제 — 운동기구는 gear_off 로 1시간 상태를 바로 끝낸다(특이사항도 사라진다). */
  const doUnequip = useCallback(
    (code: string) =>
      GEAR.has(code) ? runWithPopup("gear_off", "gear_off", code) : doFlexUnequip(code),
    [runWithPopup, doFlexUnequip],
  );

  /**
   * 게임 횟수 회복분이 하루 상한(bonus_left — 서버가 이미 총량(extra_max) 기준으로
   * 깎아 내려준다)에 걸려 버려지거나 에너지가 이미 가득 차 회복량이 넘칠
   * 상황이면 먼저 확인을 받는다. 그런 게 아니면 바로 쓴다. 순수 꾸미기는
   * 확인 없이 곧장 처리한다.
   */
  const applyItem = useCallback(
    (code: string) => {
      const item = state.items.find((i) => i.code === code);
      if (!item) return;

      const action = itemAction(item);
      if (action === "flex_use") {
        doFlexUse(code);
        return;
      }
      if (action === "flex_equip") {
        doFlexEquip(code);
        return;
      }
      if (action === "radio") {
        doRadioOn(code);
        return;
      }
      if (action === "gear") {
        doGearOn(code);
        return;
      }
      if (action !== "use") return;

      const playsLeft = state.bonus_left;
      const hpRoom = Math.max(0, state.hp_max - state.hp);
      const playsWasted = item.plays > 0 && playsLeft < item.plays;
      const hpWasted = item.heal > 0 && item.heal > hpRoom;
      if (playsWasted || hpWasted) {
        setPendingUse(item);
        return;
      }
      doUseItem(code);
    },
    [
      state.items,
      state.bonus_left,
      state.hp,
      state.hp_max,
      doUseItem,
      doFlexUse,
      doFlexEquip,
      doRadioOn,
      doGearOn,
    ],
  );

  /** 함께 쓸 수 있는 음료·간식이면 먼저 혼자/함께를 묻는다. 명단을 다시 읽어
   *  그 사이 휴식에 들어간 사람을 목록에서 뺀다. */
  const onUseItem = useCallback(
    (code: string) => {
      const item = state.items.find((i) => i.code === code);
      if (item?.shareable) {
        setPendingShare(item);
        reloadRoster();
        return;
      }
      applyItem(code);
    },
    [state.items, applyItem, reloadRoster],
  );

  const onSellItem = useCallback(
    async (code: string, qty: number) => {
      const ok = await callStoreRpc("sell_item", { p_code: code, p_qty: qty });
      if (ok) setNotice(`${qty}개를 판매했습니다.`);
    },
    [callStoreRpc, setNotice],
  );

  // 성공 여부를 돌려준다 — 상점이 그걸 보고 "오늘 n/3개" 를 바로 올린다.
  const onBuyItem = useCallback(
    async (code: string, qty: number): Promise<boolean> => {
      const ok = await callStoreRpc("buy_item", { p_code: code, p_qty: qty });
      if (ok) setNotice(`${qty}개를 구매했습니다.`);
      return ok !== null;
    },
    [callStoreRpc, setNotice],
  );

  /** 프로필 사진을 Storage에 올린 뒤, 경로만 프로필에 반영한다. */
  const onAvatarChange = useCallback(
    async (path: string | null): Promise<boolean> => {
      const ok = await callStoreRpc("set_avatar_path", { p_path: path });
      if (ok) setNotice(path ? "사진을 등록했습니다." : "사진을 지웠습니다.");
      return ok !== null;
    },
    [callStoreRpc, setNotice],
  );

  return {
    pendingUse,
    setPendingUse,
    pendingShare,
    setPendingShare,
    radioOpen,
    setRadioOpen,
    usedPopup,
    setUsedPopup,
    doUseItem,
    doUseTogether,
    doUnequip,
    doRoast,
    doMix,
    applyItem,
    onUseItem,
    onSellItem,
    onBuyItem,
    onAvatarChange,
  };
}
