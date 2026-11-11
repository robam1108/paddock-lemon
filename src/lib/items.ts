// 아이템 표시용 타입과 도우미. 효과·확률은 서버 아이템 카탈로그가 정본이다.

import { GEAR } from "./gear";
import { RADIO } from "./radio";
import { getRules } from "./server-rules";

/* ---------------- 아이템 ---------------- */
export type ItemGrade =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

export type ItemDef = {
  code: string;
  name: string;
  kind: string;
  grade: ItemGrade;
  emoji: string;
  /** 사용 시 회복되는 에너지 */
  heal: number;
  /** 사용 시 되살아나는 게임 횟수 */
  plays: number;
  /** 사용 시 줄어드는 휴식 시간(시간) */
  ward_cut: number;
  /** 사용 시 얻는 "다음 승리 판돈 2배" 횟수 */
  win_double: number;
  buy_price: number | null;
  /** 상점 품목에만 붙는다 — 할인 중일 때의 정가(네잎클로버). 할인이 아니면 null */
  list_price?: number | null;
  sell_price: number | null;
  tradable: boolean;
  description?: string;
  /** 상점 품목에만 붙는다 — 품목당 하루 구매 상한과 오늘 이미 산 수량 */
  daily_cap?: number;
  bought?: number;
  /** 프로필 표시 갈래. 없으면 표시 아이템이 아니다 */
  flex_kind?: "consume" | "wear" | null;
  /** consume 일 때 남에게 보이는 시간(시간 단위) */
  flex_hours?: number;
  /** 한 개에 든 사용 횟수(개비 수). 없거나 1이면 한 번 쓰면 사라진다 */
  uses?: number;
  /** 누군가와 함께 쓸 수 있는지(item_defs.flex_text_with 가 있는 음료·간식).
   *  true 면 쓰기 전에 혼자/함께 팝업이 뜬다. */
  shareable?: boolean;
};

/** 본인에게만 보이는 프로필 표시 한 줄. state.flex 가 이 배열을 들고 있다.
 *  남은 시간(expires_at)은 여기에만 있다 — player_roster() 는 문장만 준다. */
export type FlexStatus = {
  code: string;
  name: string;
  emoji: string;
  kind: string;
  grade: ItemGrade;
  flex_kind: "consume" | "wear";
  text: string;
  gifted: boolean;
  /** 훔친 개체를 장착/사용한 것인지. gifted 보다 우선한다 */
  stolen: boolean;
  /** 누군가와 함께 쓴 것인지(use_together). 다른 갈래보다 우선한다 */
  together?: boolean;
  /** consume 만 값이 있다. wear 는 null(해제할 때까지 유지) */
  expires_at: string | null;
};

export type InventoryItem = ItemDef & {
  qty: number;
  /** 개봉한 갑에 남은 사용 횟수. 0이거나 없으면 개봉분이 없다는 뜻이다 */
  open_left?: number;
};

export const ITEM_GRADE_STYLE: Record<ItemGrade, string> = {
  common: "bg-fg-low/10 text-fg-mid",
  uncommon: "bg-emerald-600/12 text-emerald-800",
  rare: "bg-sky-600/12 text-sky-800",
  epic: "bg-violet-600/12 text-violet-800",
  legendary: "bg-brass/15 text-brass",
};

export const ITEM_GRADE_LABEL: Record<ItemGrade, string> = {
  common: "일반",
  uncommon: "고급",
  rare: "희귀",
  epic: "특급",
  legendary: "전설",
};

export const ITEM_KIND_LABEL: Record<string, string> = {
  food: "식량",
  liquor: "음료",
  medicine: "회복",
  luxury: "꾸미기",
  permit: "증서",
  treat: "간식",
  tool: "도구",
  charm: "부적",
};

/* ---------------- 네잎클로버 (부적) ----------------
   상점 전용. 쓰면 flex_hours(6시간) 동안 모든 판의 판돈에 서버가 코인을 얹는다.
   값은 서버의 "판돈 추가(stake_bonus)" 표가 정한다 — 여기는 표시용이다. */
export const CLOVER = "clover";

/** state.luck — 네잎클로버가 켜져 있을 때만 값이 있다 */
export type LuckEffect = {
  /** 한 판에 얹히는 판돈 */
  stake: number;
  ends_at: string;
};

type Effectish = {
  code?: string;
  kind?: string;
  heal: number;
  plays: number;
  ward_cut: number;
  win_double: number;
  flex_kind?: "consume" | "wear" | null;
  flex_hours?: number;
  /** 한 개에 든 사용 횟수. 1 이하면 표시하지 않는다 */
  uses?: number;
};

/** 아이템 효과를 한 줄로 */
export function itemEffect(it: Effectish): string {
  if (it.code === RADIO) return "켜면 노래가 나온다";
  if (it.kind === "charm") return `판돈 +${getRules().clover_stake} · ${it.flex_hours ?? 6}시간`;
  const parts: string[] = [];
  if (it.heal > 0) parts.push(`에너지 +${it.heal}`);
  if (it.plays > 0) parts.push(`게임 횟수 +${it.plays}`);
  if (it.ward_cut > 0) {
    parts.push(it.ward_cut >= 48 ? "휴식 즉시 종료" : `휴식 -${it.ward_cut}시간`);
  }
  if (it.win_double > 0) parts.push("다음 승리 판돈 2배");
  if (it.uses && it.uses > 1) parts.push(`${it.uses}회분`);
  if (it.flex_kind === "consume") {
    parts.push(it.flex_hours ? `프로필에 표시 · ${it.flex_hours}시간` : "프로필에 표시");
  } else if (it.flex_kind === "wear") {
    parts.push("장착 가능");
  }
  return parts.join(" · ") || "소지품";
}

export function isUsable(it: Effectish): boolean {
  return (
    it.kind === "charm" ||
    it.heal > 0 ||
    it.plays > 0 ||
    it.ward_cut > 0 ||
    it.win_double > 0 ||
    it.flex_kind === "consume" ||
    it.flex_kind === "wear"
  );
}

/** use_item / flex_use / flex_equip 중 이 아이템이 어느 RPC로 쓰이는지.
 *  효과가 있는 것(식량·회복·증서)은 전부 use_item. 나머지 소모형 꾸미기(음료·향수)만
 *  flex_use, 장착형(라이터·반지·시계)은 flex_equip/flex_unequip.
 *  라디오는 consume 이지만 사라지지 않아 radio_on 으로 따로 켠다.
 *  운동기구도 같은 결로 gear_on 으로 1시간 착용한다. */
export type ItemAction = "use" | "flex_use" | "flex_equip" | "radio" | "gear" | null;

export function itemAction(it: Effectish): ItemAction {
  if (it.code === RADIO) return "radio";
  if (it.code && GEAR.has(it.code)) return "gear";
  const hasEffect = it.heal > 0 || it.plays > 0 || it.ward_cut > 0 || it.win_double > 0;
  if (it.kind === "charm" || hasEffect) return "use";
  if (it.flex_kind === "consume") return "flex_use";
  if (it.flex_kind === "wear") return "flex_equip";
  return null;
}
