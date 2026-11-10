// 서버(supabase/00_rules.sql · 02_schema.sql)의 규칙과 짝을 이루는 표시용 상수.
// 실제 판정과 정산은 전부 DB 함수 play_game() 안에서만 일어난다.

import { GEAR } from "./gear";
import { RADIO } from "./radio";

export const PLAY_LIMIT = 20;

// Casual 게임 1판마다 지급하는 참가 보상. 판돈의 절반이 이보다 적으면 그만큼만 준다.
// (실제 값은 사람마다 다르다 — 서버 app.play_wage(코인) 이 정하고 state.play_wage 로
//  내려온다. 0 이면 화면의 참가 보상 안내를 감춘다. 이 값은 표시용 기본치.)
export const PLAY_WAGE = 4;

export type GameId = "roulette" | "slots" | "highlow" | "keno";

export const GAMES: { id: GameId; name: string; emoji: string; desc: string }[] = [
  { id: "roulette", name: "룰렛", emoji: "🎯", desc: "색을 맞히면 2.1배, 초록은 14.7배" },
  { id: "slots", name: "슬롯머신", emoji: "🎰", desc: "3개 일치 최대 40배" },
  { id: "highlow", name: "하이로우", emoji: "🃏", desc: "다음 카드가 높을까 낮을까" },
  { id: "keno", name: "키노", emoji: "🔢", desc: "40개 중 5개를 고르고 10개를 뽑는다" },
];

/* ---------------- 룰렛 ---------------- */
// 0 = 초록, 1~7 = 빨강, 8~14 = 검정 (총 15칸)
export const ROULETTE_SLOTS = 15;

export function rouletteColor(slot: number): "green" | "red" | "black" {
  if (slot === 0) return "green";
  return slot <= 7 ? "red" : "black";
}

export const ROULETTE_BETS = [
  { id: "red", label: "빨강", mult: 2.1, className: "bet-red" },
  { id: "black", label: "검정", mult: 2.1, className: "bet-black" },
  { id: "green", label: "초록", mult: 14.7, className: "bet-green" },
] as const;

// 숫자 베팅은 15칸 중 1칸이므로 색 베팅과 하우스 엣지가 같도록 ×14.7 로 맞춘다.
export const ROULETTE_NUMBER_MULT = 14.7;

export function isNumberBet(choice: string | null): boolean {
  return !!choice && /^([0-9]|1[0-4])$/.test(choice);
}

export function rouletteChoiceLabel(choice: string | null): string {
  if (!choice) return "";
  if (isNumberBet(choice)) return `숫자 ${choice}`;
  return choice === "red" ? "빨강" : choice === "black" ? "검정" : "초록";
}

/* ---------------- 슬롯머신 ---------------- */
export const SLOT_SYMBOLS = {
  cherry: { emoji: "🍒", mult: 4 },
  lemon: { emoji: "🍋", mult: 6 },
  bell: { emoji: "🔔", mult: 8 },
  star: { emoji: "⭐", mult: 12 },
  seven: { emoji: "7️⃣", mult: 25 },
  diamond: { emoji: "💎", mult: 40 },
} as const;

export type SlotSymbol = keyof typeof SLOT_SYMBOLS;

/** 두 칸만 같을 때의 배당. 02_schema.sql 의 play_game 과 반드시 같은 값이어야 한다. */
export const SLOT_PAIR_MULT = 1.45;

// 릴 애니메이션용 (서버 확률과 동일한 가중치)
export const SLOT_POOL: SlotSymbol[] = [
  ...Array<SlotSymbol>(6).fill("cherry"),
  ...Array<SlotSymbol>(5).fill("lemon"),
  ...Array<SlotSymbol>(4).fill("bell"),
  ...Array<SlotSymbol>(3).fill("star"),
  ...Array<SlotSymbol>(2).fill("seven"),
  ...Array<SlotSymbol>(1).fill("diamond"),
];

/* ---------------- 하이로우 ---------------- */
export const CARD_LABELS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export type HighLowChoice = "high" | "low" | "same";

export const HL_MAX_STAGE = 3;

// 카드는 균등 추첨이다(쏠림 없음). 난이도 보정은 확률이 아니라 배율에서 한다 —
// 단계가 오를수록 엣지를 깎아 "계속 가는 쪽"이 항상 유리하도록.
// 00_rules.sql 의 app.hl_edge 와 반드시 같은 값이어야 한다.
export const HL_EDGE = [0.05, 0.0, -0.03] as const;
// 배율 상한. 00_rules.sql 의 app.hl_max_mult 와 반드시 같아야 한다.
export const HL_MAX_MULT = 8;

/** 선택이 적중하는 카드 수 (13장 균등 기준) */
export function hlWinCards(card: number, choice: HighLowChoice): number {
  if (choice === "high") return 13 - card;
  if (choice === "low") return card - 1;
  return 1;
}

/** 선택별 적중 확률 — 균등 분포 기준. 화면 표시용이자 실제 확률과 동일하다. */
export function hlWinChance(card: number, choice: HighLowChoice): number {
  return hlWinCards(card, choice) / 13;
}

/** 배율 = (1 - 단계엣지) / 적중률, 소수 2자리 반올림, 상한 적용.
 *  00_rules.sql 의 app.hl_mult 와 반드시 같은 값이어야 한다. */
export function hlMult(
  card: number,
  choice: HighLowChoice,
  stage: number,
): number {
  const winCards = hlWinCards(card, choice);
  if (winCards <= 0) return 0;
  const edge = HL_EDGE[stage - 1] ?? 1;
  const raw = ((1 - edge) * 13) / winCards;
  // 부동소수 오차 보정 — 0.95*13/10 은 정확히 1.235지만 JS 이진 부동소수로는
  // 1.2349999... 가 되어 반올림이 아래로 내려간다. Postgres numeric(정확한
  // 십진 연산)과 결과가 어긋나지 않도록 아주 작은 값을 더해 경계를 바로잡는다.
  const rounded = Math.round((raw + Number.EPSILON) * 100) / 100;
  return Math.min(HL_MAX_MULT, rounded);
}

/** 다음 단계까지 성공했을 때 적립금이 얼마가 되는지 */
export function hlNextPot(
  base: number,
  card: number,
  choice: HighLowChoice,
  stage: number,
): number {
  // 배율을 정수(×100)로 되돌려 곱한다. base * 1.63 을 그대로 하면 150 * 1.63 이
  // 244.4999... 가 되어 서버(Postgres numeric, 245)보다 1 적게 보인다.
  return Math.round((base * Math.round(hlMult(card, choice, stage) * 100)) / 100);
}

export const HL_CHOICES: {
  id: HighLowChoice;
  label: string;
  mark: string;
  className: string;
}[] = [
    {
      id: "high",
      label: "하이",
      mark: "▲",
      className: "from-emerald-500 to-emerald-700",
    },
    {
      id: "same",
      label: "같다",
      mark: "＝",
      className: "from-amber-500 to-amber-700",
    },
    {
      id: "low",
      label: "로우",
      mark: "▼",
      className: "from-sky-500 to-sky-700",
    },
  ];

/* ---------------- 키노 ---------------- */
// 1~40 에서 5개를 고르면 서버가 10개를 뽑는다. 추첨 수 10 도 배당표의 일부다 —
// 개수를 바꾸면 아래 배당이 전부 어긋난다.
export const KENO_RANGE = 40;
export const KENO_PICKS = 5;
export const KENO_DRAWS = 10;

/** 적중 개수별 배당. 02_schema.sql 의 play_game 키노 절과 반드시 같은 값이어야 한다.
 *
 *  다 맞힌 판은 서버가 일부만 남기고 나머지는 판 전체를 다시 뽑는다 — 초기하분포
 *  그대로면 5개 적중이 2,611판에 한 번이라, 슬롯 다이아 트리플(9,261판에 한 번)
 *  보다 최고 배당이 3.5배 흔해지기 때문이다. 4개 적중(자연 1/104)도 같은 식으로
 *  5개 확률의 2배(1/4,630)까지, 3개 적중(자연 1/12.6)은 1/28.5 까지 낮춘다
 *  (2026-10-02, 2026-10-07). 재추첨을 거친 뒤의 확률은
 *    0개 .2294 · 1개 .4411 · 2개 .2941 · 3개 .0351 · 4개 .000216 · 5개 .000108
 *  이다. 빈도를 정하는 건 서버의 app.keno_five_one_in() · app.keno_four_one_in()
 *  · app.keno_three_one_in() 이고 화면에서 다시 계산하지 않는다.
 *
 *  2026-09-28: 확률은 그대로 두고 배당만 올렸다(×1.5/×4/×15/×50 → ×3/×15/×30/×60).
 *  RTP 는 0.883(하우스 엣지 ≈11.7%)에서 약 2.32(하우스 엣지 ≈ −131.7%, 플레이어
 *  유리)로 뛴다 — 다른 게임과 엣지를 맞추지 않은 의도적 결정이다. 1개 적중에는
 *  지금도 배당을 주지 않는다.
 *  같은 날 2개 적중만 ×3 → ×1.5 로 되돌렸다. RTP 약 1.90(하우스 엣지 ≈ −90.1%).
 *  2026-10-02: 4개 적중 빈도를 낮춰 RTP 약 1.635(하우스 엣지 ≈ −63.5%).
 *  2026-10-06: 3개 적중 빈도를 낮춰 RTP 약 1.44(하우스 엣지 ≈ −44.0%).
 *  2026-10-07: 3개 적중을 1/15 → 1/28.5 로 낮춰 RTP 약 0.980(하우스 엣지 ≈ 2.0%,
 *  룰렛·슬롯·하이로우와 같은 급). */
export const KENO_MULT: Record<number, number> = { 2: 1.5, 3: 15, 4: 30, 5: 60 };

/** 배당 레일용 — 높은 것부터 */
export const KENO_TIERS = [5, 4, 3, 2] as const;

export type KenoOutcome = {
  picks: number[];
  /** 뽑힌 순서 그대로. 화면이 이 순서대로 하나씩 켠다 */
  draw: number[];
  hits: number[];
  match: number;
};

/* ---------------- 서버 응답 타입 ---------------- */
export type HighLowStep = {
  stage: number;
  from: number;
  next: number;
  choice: HighLowChoice;
  win: boolean;
  /** 이 단계에서 적용된 배율. 신규 배율 도입 전 기록에는 없을 수 있다. */
  mult?: number;
};

export type HighLowOutcome = {
  from?: number;
  next: number;
  choice?: string;
  /** armed = 판을 열었다(패 공개, 아직 판정 전), win = 다음 단계 진행 가능,
   *  cleared = 3단계까지 성공, cashout = 중간 수령 */
  result: "armed" | "win" | "lose" | "cleared" | "cashout";
  stage: number;
  pot: number;
  steps: HighLowStep[];
};

/* ---------------- 에너지 ---------------- */
export type HpStatus = "충분" | "보통" | "부족" | "바닥" | "휴식";

export const HP_TIERS: { max: number; status: HpStatus; className: string }[] = [
  { max: 0, status: "휴식", className: "text-rose-400" },
  { max: 10, status: "바닥", className: "text-red-400" },
  { max: 30, status: "부족", className: "text-orange-400" },
  { max: 50, status: "보통", className: "text-amber-400" },
  { max: 100, status: "충분", className: "text-emerald-400" },
];

/** 00_rules.sql 의 app.hp_status 와 같은 구간을 쓴다 */
export function hpStatus(hp: number): HpStatus {
  return (HP_TIERS.find((t) => hp <= t.max) ?? HP_TIERS[4]).status;
}

export function hpClass(status: string): string {
  return HP_TIERS.find((t) => t.status === status)?.className ?? "text-white/60";
}

/** 남은 시간을 "12시간 34분" 처럼 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0분";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

/** 정지 기간처럼 며칠 단위로 남는 것에 쓴다. "2일 5시간" */
export function formatDaysLeft(seconds: number): string {
  if (seconds <= 0) return "0시간";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}일 ${h}시간`;
  return `${h}시간`;
}

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
 *  남은 시간(expires_at)은 여기에만 있다 — inmate_roster() 는 문장만 준다. */
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
  common: "bg-white/10 text-white/60",
  uncommon: "bg-emerald-500/20 text-emerald-300",
  rare: "bg-sky-500/20 text-sky-300",
  epic: "bg-violet-500/20 text-violet-300",
  legendary: "bg-gold-500/20 text-gold-400",
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
  gift: "선물",
};

/* ---------------- 네잎클로버 (부적) ----------------
   상점 전용. 쓰면 flex_hours(6시간) 동안 모든 판의 판돈에 서버가 코인을 얹는다.
   값은 서버의 "판돈 추가(stake_bonus)" 표가 정한다 — 여기는 표시용이다. */
export const CLOVER = "clover";
export const CLOVER_STAKE = 15;

/** state.luck — 네잎클로버가 켜져 있을 때만 값이 있다 */
export type LuckEffect = {
  /** 한 판에 얹히는 판돈 */
  stake: number;
  ends_at: string;
};

/** 불을 붙일 수 있는 물건(굽기에 쓴다). 장착(flex_equip)해도 인벤에 그대로 남으므로
 *  보유 수량만 보면 장착 여부와 무관하게 판정된다. */
export const LIGHTER_CODES = ["lighter_old", "lighter_ag", "lighter_au"];

/** 라이터로 구울 수 있는 것 → 구운 것. 서버 public.roast_item 과 맞춘다. */
export const ROAST_TO: Record<string, string> = {
  sweet_potato_chestnut: "roast_potato_chestnut",
  sweet_potato_pumpkin: "roast_potato_pumpkin",
  fish_mackerel: "roast_fish_mackerel",
  fish_horse_mackerel: "roast_fish_horse_mackerel",
};

/** 목장 우유. 소지품에서 아래 음료와 섞을 수 있다(서버 public.mix_item). */
export const MILK = "milk";

/** 우유에 섞을 수 있는 것 → 섞은 것. 서버 public.mix_item 과 맞춘다. */
export const MIX_TO: Record<string, string> = {
  instant_coffee: "cafe_latte",
  ice_coffee: "iced_latte",
  rooibos_tea: "milk_tea",
};

/** 섞기 창에서 결과를 아직 안 가졌을 때 보여 줄 이름(서버 아이템 카탈로그와 같게). */
export const MIX_NAME: Record<string, string> = {
  instant_coffee: "카페라떼",
  ice_coffee: "아이스 카페라떼",
  rooibos_tea: "밀크티",
};

export function hasLighter(items: { code: string; qty: number }[]): boolean {
  return items.some((it) => LIGHTER_CODES.includes(it.code) && it.qty > 0);
}

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
  if (it.code === CHURU) return "고양이 간식";
  if (it.kind === "gift") return "고양이의 선물";
  if (it.kind === "charm") return `판돈 +${CLOVER_STAKE} · ${it.flex_hours ?? 6}시간`;
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

/* ---------------- 일일 미션 ---------------- */

/** labor_board() 가 돌려주는 오늘의 미션 목록. 난이도·보상 범위는 서버에만 있다 —
 *  이 타입 어디에도 없다. */
export type LaborBoard = {
  hp_cost: number;
  /** 오늘 이미 끝낸 작업 수 */
  done: number;
  /** 오늘 할 수 있는 총 횟수 */
  limit: number;
  /** 다음 작업까지 남은 초. 0이면 지금 할 수 있다 */
  cooldown_left: number;
  /** 지금이 근무 시간(KST open_from~open_to)인지 */
  open: boolean;
  open_from: number;
  open_to: number;
  /** 열림/닫힘이 바뀔 때까지 남은 초 */
  window_left: number;
  jobs: { code: string; done: boolean }[];
  /** 야간작업(새벽 open_from~open_to). 어제 낮 작업을 한 번도 못 했고 오늘 새벽
   *  몫이 아직 지나지 않았을 때만 실린다 — 아니면 null. 한 번만 할 수 있다 */
  night?: {
    done: boolean;
    /** 야간 미션 한 번에 드는 에너지(낮의 hp_cost 와 따로) */
    hp_cost: number;
    open: boolean;
    open_from: number;
    open_to: number;
    window_left: number;
    jobs: { code: string; done: boolean }[];
  } | null;
};

export type LaborBand = "low" | "mid" | "high";

/** labor_work() 한 번의 결과. */
export type LaborResult = {
  code: string;
  pay: number;
  band: LaborBand;
  hp_cut: number;
  done: number;
  cooldown_left: number;
  /** 농장 밭일에서 챙긴 고구마 · 물고기잡이에서 챙긴 생선. 없으면 null */
  item?: { code: string; name: string; emoji: string } | null;
  /** 야간작업 결과인지 */
  night?: boolean;
  /** 청소 미션 high 문구에 들어갈 플레이어 이름. 없으면 null */
  visitor?: string | null;
};

/* ---------------- 탐험 ---------------- */

/** search_board() 가 돌려주는 오늘 상태. */
export type SearchBoard = {
  hp_cost: number;
  used: boolean;
  place: string | null;
  /** 오늘 고양이를 만나 놓고 아직 간식주기/쓰다듬기를 안 눌렀다 */
  cat_waiting?: boolean;
  /** 오늘 고양이를 만났다(행동을 끝냈어도 true) */
  cat_met?: boolean;
  /** 공용 고양이 이름. 아직 없으면 null */
  cat_name?: string | null;
  /** 내가 이름 지을 권리를 가졌고 아직 이름을 안 적었다 */
  can_name?: boolean;
  /** 이름을 지어 준 사이면 오늘 고양이 자리 — 그 장소 칸에 발자국을 찍는다. 아니면 null */
  cat_spot?: string | null;
  /** 시험 계정('관리자' + 관리자 권한). 하루 한 번 제한·에너지 없이 탐험하고 테스트 패널을 쓴다 */
  tester?: boolean;
  /** 이하 시험 계정에게만 온다 — 오늘 고양이 자리 · 내 친밀도 · 가진 츄르 · 처리 안 한 선물 수 */
  cat_place?: string;
  churu_given?: number;
  churu_held?: number;
  gifts_waiting?: number;
  /** 깃털이 판돈을 얹어 줄 남은 판 */
  bless_left?: number;
};

/** cat_test() 동작. 서버 24_cat.sql 의 public.cat_test 와 같다. */
export type CatTestAction = "here" | "churu" | "fish" | "friend" | "gifts_now" | "deads" | "reset";

/** search_look() 한 번의 결과. */
export type SearchResult = {
  place: string;
  /** 아무것도 못 건진 경우. true 면 item 은 null */
  miss: boolean;
  /** 등급 추첨 없이 곧장 비상식량이 나온 경우 */
  ration: boolean;
  hp_cut: number;
  item: {
    code: string;
    name: string;
    emoji: string;
    grade: ItemGrade;
    kind: string;
    buy_price: number | null;
    description: string;
  } | null;
  /** 오늘 고양이 자리를 골랐다. 있으면 item 은 null */
  cat?: { name: string | null } | null;
};

/* ---------------- 탐험 고양이 ---------------- */

/** 고양이 간식. 서버 app.cat_churu_item() 과 같다. */
export const CHURU = "churu";
/** 고양이 간식이 되는 날생선·우유(app.cat_fish_items). 츄르보다 친밀도가 더 오른다. */
export const CAT_FISH_CODES = new Set(["fish_mackerel", "fish_horse_mackerel", "milk"]);

/** 선물로 오는 세 품목(app.cat_gift_items). 거래가 안 되고 몰래 정리로 치운다.
 *  쓰면(public.cat_gift_use) 품목마다 효과가 하나 켜진다 — 설명은 사용 팝업에만. */
// 코드값은 서버 카탈로그와 묶여 있어 P2에서 feather · toy_mouse · butterfly 로 함께 바꾼다.
export const CAT_GIFT_CODES = new Set(["dead_bird", "dead_mouse", "dead_bug"]);
/** 선물 효과(표시용). 서버 app.cat_bird_stake · app.cat_bird_plays 와 같다. */
export const CAT_BIRD_STAKE = 10;
export const CAT_BIRD_PLAYS = 3;

/** 소지품 탭이 cat_gifts_pending() 으로 받는 값 */
export type CatStatus = {
  /** 내가 지은 고양이 이름. 아직 없으면 null */
  cat_name: string | null;
  gifts: CatGift[];
  /** 깃털이 판돈을 얹어 줄 남은 판 수 */
  bless_left: number;
  /** 나비 — 다음 미션을 기다리는 중 */
  labor_ready: boolean;
};

/** cat_gift_resolve() 결과 */
export type CatGiftResolved = {
  kept: boolean;
  cat_name: string | null;
};

/** cat_act() 결과 — no_snack · shy 는 고양이가 도망간 것 */
export type CatOutcome = "no_snack" | "fed" | "shy" | "petted";

export type CatActResult = {
  outcome: CatOutcome;
  /** 간식주기로 준 품목 코드 · 이름(츄르 또는 날생선). 주지 못했으면 null */
  snack?: string | null;
  snack_name?: string | null;
  /** 친밀도 점수(츄르 +1 · 생선 +2) */
  churu_given: number;
  need: number;
  cat_name: string | null;
  can_name: boolean;
};

/** 도착한 선물 하나 */
export type CatGift = {
  id: number;
  code: string;
  name: string;
  emoji: string;
  grade: ItemGrade;
  kind: string;
};

export type PlayerState = {
  username: string;
  /** Storage(avatars 버킷) 안의 경로. 없으면 null. */
  avatar_path: string | null;
  coins: number;
  plays_used: number;
  plays_left: number;
  play_limit: number;
  hl_card: number;
  /** 0 이면 진행 중인 하이로우 사다리가 없다 */
  hl_stage: number;
  hl_bet: number;
  hl_pot: number;
  hl_steps: HighLowStep[];
  hl_max_stage: number;
  /** 하이로우 판을 열 때 네잎클로버 등이 얹어 준 판돈. 첫 판정의 기준액은 hl_bet + hl_bonus */
  hl_bonus?: number;
  /** 착용형을 동시에 장착할 수 있는 수(app.flex_wear_limit). 겹쳐 장착한 것도 그 수만큼 센다 */
  wear_limit?: number;
  /** 네잎클로버 효과. 켜져 있지 않으면 null */
  luck?: LuckEffect | null;
  /** 대출로 빌린 뒤 아직 갚지 않은 코인 */
  debt: number;
  is_admin: boolean;
  /** 명단·접속자·순위표 등에서 감추는 계정인가 */
  hidden: boolean;
  /** Arena 1:1 대전의 최소 판돈 */
  pvp_min_bet: number;
  /** Casual 게임 1판마다 지급하는 보상. 판돈이 이보다 적으면 판돈만큼만 받는다 */
  play_wage: number;
  /** 오늘 아이템으로 되살린 게임 횟수 */
  bonus_plays: number;
  /** 하루에 아이템으로 되살릴 수 있는 상한 */
  bonus_max: number;
  /** 아직 더 되살릴 수 있는 횟수 */
  bonus_left: number;
  /** 아이템으로 되살린 오늘 회복 횟수 (= bonus_plays) */
  extra_plays: number;
  /** 그 총량 상한. daily_play_limit() 에 이만큼까지만 더해진다 */
  extra_max: number;
  /** 총량 기준으로 아직 더 되살릴 수 있는 횟수 */
  extra_left: number;
  /** use_item 응답에만 실린다 — 효과를 적용하기 직전의 에너지 */
  hp_before?: number;
  /** use_item 응답에만 실린다 — 이번에 실제로 늘어난 게임 횟수 */
  plays_gained?: number;
  /** use_together 응답에만 실린다 — 함께 쓴 상대 이름 */
  with?: string;
  /** use_together 로 음식을 함께 먹었을 때만 — 상대가 실제로 얻은 에너지·횟수 */
  mate_heal?: number;
  mate_plays?: number;
  /** 남아 있는 "다음 승리 판돈 2배" 횟수 */
  win_double: number;
  hp: number;
  hp_max: number;
  hp_status: HpStatus;
  /** 에너지가 0이라 휴식 중인 상태 */
  in_ward: boolean;
  /** 휴식이 끝날 때까지 남은 초 */
  ward_left: number;
  /** 관리자가 정지시킨 상태. 게임·거래·상점·대전이 막힌다 (피드백은 열려 있다) */
  suspended: boolean;
  suspended_until: string | null;
  /** 정지 해제까지 남은 초 */
  suspended_left: number;
  suspend_reason: string | null;
  /** 배정된 룸. 아직 없으면 null */
  cell_id: number | null;
  /** "4-08". 아직 배정 전이면 null */
  cell: string | null;
  /** 본인이 직접 기재. 미기재면 null */
  crime: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  bio: string | null;
  items: InventoryItem[];
  /** 프로필 표시 목록. 남은 시간(expires_at)은 본인 프로필에만 노출된다 */
  flex: FlexStatus[];
};

/** 관리자 페이지에서 보는 플레이어 한 줄 */
export type AdminPlayer = {
  username: string;
  code: string;
  coins: number;
  hp: number;
  hp_status: HpStatus;
  in_ward: boolean;
  plays_used: number;
  bonus_plays: number;
  plays_left: number;
  items: {
    code: string;
    name: string;
    emoji: string;
    grade: ItemGrade;
    qty: number;
    /** 개봉한 갑에 남은 사용 횟수. 0이거나 없으면 개봉분이 없다는 뜻이다 */
    open_left?: number;
  }[];
  is_admin: boolean;
  created_at: string;
  /** null 이면 정지 상태가 아니다 */
  suspended_until: string | null;
  suspend_reason: string | null;
};

/** 관리자 상세 조회 */
export type AdminPlayerDetail = {
  username: string;
  coins: number;
  debt: number;
  hp: number;
  hp_max: number;
  hp_status: HpStatus;
  in_ward: boolean;
  ward_left: number;
  plays_used: number;
  bonus_plays: number;
  plays_left: number;
  win_double: number;
  is_admin: boolean;
  created_at: string;
  /** null 이면 정지 상태가 아니다 */
  suspended_until: string | null;
  suspend_reason: string | null;
  items: {
    code: string;
    name: string;
    emoji: string;
    grade: ItemGrade;
    kind: string;
    qty: number;
    /** 개봉한 갑에 남은 사용 횟수. 0이거나 없으면 개봉분이 없다는 뜻이다 */
    open_left?: number;
  }[];
  ledger: {
    id: number;
    kind: string;
    title: string;
    coin_delta: number;
    coin_after: number;
    created_at: string;
  }[];
};

export type AdminTrade = {
  id: number;
  from: string;
  to: string;
  /** 그 쪽 플레이어가 삭제됐다(거래 기록만 남았다) */
  from_deleted: boolean;
  to_deleted: boolean;
  is_gift: boolean;
  status: TradeStatus;
  from_coins: number;
  from_items: TradeItem[];
  to_coins: number;
  to_items: TradeItem[];
  created_at: string;
  updated_at: string;
  /** 관리자가 취소한 시각. 취소 전이면 null */
  reverted_at: string | null;
  /** 취소 때 실제로 거둔 양. from_* 는 제안자에게서, to_* 는 상대에게서 거둔 것 */
  reverted_detail: {
    from_coins: number;
    from_items: TradeItem[];
    to_coins: number;
    to_items: TradeItem[];
  } | null;
};

/** panel_revert_trade 응답 — 각자에게서 실제로 거둔 것 */
/** 관리자 상세의 거래 기록 한 줄 — 이 사람 쪽에서 본 ledger 의 거래 기록 */
export type AdminTradeLedger = {
  id: number;
  created_at: string;
  title: string;
  coin_delta: number;
  partner: string;
  /** 상대가 지금은 없는 사람이다 */
  partner_deleted: boolean;
  gave_coins: number;
  gave_items: TradeItem[];
  got_coins: number;
  got_items: TradeItem[];
  /** 기록에서 회수한 내역. 회수 전이면 null */
  confiscated: { coins: number; items: TradeItem[]; at: string } | null;
  /** 연결이 끊긴 옛 기록인데 같은 상대와의 관리자 거래 취소가 뒤에 있다 */
  maybe_reverted: boolean;
  /** 거래 목록에 남아 있는 거래. 상대가 삭제돼 행이 사라졌으면 null */
  trade: {
    id: number;
    status: TradeStatus;
    from: string;
    to: string;
    from_deleted: boolean;
    to_deleted: boolean;
  } | null;
};

export type TradeLedgerConfiscateResult = {
  name: string;
  partner: string;
  coins: number;
  items: TradeItem[];
};

export type TradeRevertResult = {
  id: number;
  from: { name: string; deleted?: boolean; coins: number; items: TradeItem[] };
  to: { name: string; deleted?: boolean; coins: number; items: TradeItem[] };
};

/* ---------------- 피드백 ---------------- */
export type PetitionStatus = "open" | "answered" | "closed";

/** 목록 한 줄 — 본인 것이든 관리자가 보는 전체 목록이든 같은 모양이다. */
export type PetitionSummary = {
  id: number;
  subject: string;
  status: PetitionStatus;
  created_at: string;
  last_message_at: string;
};

/** 관리자 목록에서만 작성자 이름이 붙는다 */
export type AdminPetition = PetitionSummary & { username: string };

export type PetitionMessage = {
  id: number;
  created_at: string;
  /** 관리자 답변은 서버가 이미 "관리자"로 치환해서 준다 */
  author: string;
  is_admin_reply: boolean;
  body: string;
  /** petitions 버킷 안의 경로. 없으면 첨부 없음 */
  image_path: string | null;
};

export type PetitionThread = {
  id: number;
  subject: string;
  status: PetitionStatus;
  created_at: string;
  username: string;
  messages: PetitionMessage[];
};

/* ---------------- 라운지 카테고리 ---------------- */
export type Section = "RECORD" | "LABOR" | "SEARCH" | "WHITE" | "BLACK" | "EXCHANGE";

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "RECORD", label: "프로필" },
  { id: "LABOR", label: "일일 미션" },
  { id: "SEARCH", label: "탐험" },
  { id: "WHITE", label: "Casual" },
  { id: "BLACK", label: "Arena" },
  { id: "EXCHANGE", label: "상점·거래" },
];

/* ---------------- 개인 거래 ---------------- */
export type TradeItem = {
  code: string;
  name: string;
  emoji: string;
  grade: ItemGrade;
  qty: number;
};

export type TradeStatus =
  | "offered"
  | "countered"
  | "done"
  | "declined"
  | "cancelled"
  | "expired"
  /** 성립 뒤 관리자가 취소(압수)한 거래 */
  | "reverted";

export type Trade = {
  id: number;
  status: TradeStatus;
  is_gift: boolean;
  role: "from" | "to";
  partner: string;
  my_coins: number;
  my_items: TradeItem[];
  their_coins: number;
  their_items: TradeItem[];
  my_turn: boolean;
  expires_in: number;
  updated_at: string;
};

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  offered: "상대 응답 대기",
  countered: "내 최종 확인 대기",
  done: "성사됨",
  declined: "거절됨",
  cancelled: "취소됨",
  expired: "만료됨",
  reverted: "관리자 취소",
};

/* ---------------- 원장 ---------------- */
export type LedgerEntry = {
  id: number;
  kind: "game" | "shop" | "trade" | "labor" | "search" | "admin";
  title: string;
  coin_delta: number;
  coin_after: number;
  detail: Record<string, unknown>;
  created_at: string;
};

export const LEDGER_KIND_LABEL: Record<string, string> = {
  game: "게임",
  shop: "상점",
  trade: "거래",
  labor: "미션",
  search: "탐험",
  cat: "고양이",
  admin: "관리",
};

/**
 * 관리자가 지급·회수할 때 고르는 사유 분류. 값은 app.admin_reason() 이
 * 받는 셋과 반드시 같아야 한다(그 밖의 값은 서버가 INVALID_REASON 으로 막는다).
 */
export const ADMIN_REASONS = [
  { id: "log", label: "로그" },
  { id: "event", label: "이벤트" },
  { id: "etc", label: "기타" },
] as const;

export type AdminReason = (typeof ADMIN_REASONS)[number]["id"];

export const ADMIN_REASON_LABEL: Record<string, string> = Object.fromEntries(
  ADMIN_REASONS.map((r) => [r.id, r.label]),
);

/* ---------------- BLACK 대전 ---------------- */
export type PvpGame = "dice" | "indian" | "blackjack";

export const PVP_GAMES: { id: PvpGame; name: string; ready: boolean }[] = [
  { id: "dice", name: "배틀주사위", ready: true },
  { id: "indian", name: "인디언포커", ready: true },
  { id: "blackjack", name: "블랙잭", ready: true },
];

/** 끝난 한 판. 주사위는 [n,n], 인디언포커는 카드 숫자 */
export type PvpRound = {
  round: number;
  mine: number[] | number;
  theirs: number[] | number;
  /** null 이면 무승부라 다시 한 판 */
  won: boolean | null;
};

export type PvpMatch = {
  id: number;
  game: PvpGame;
  status: "invited" | "active" | "done";
  bet: number;
  role: "host" | "guest";
  me: string;
  opponent: string;
  turn: "host" | "guest" | null;
  my_turn: boolean;
  expires_in: number;
  result: {
    reason?: "timeout" | "bust" | "blackjack";
    forfeited?: string;
    host_wins?: number;
    guest_wins?: number;
    host_total?: number;
    guest_total?: number;
  } | null;
  wins_needed: number;
  my_wins: number;
  their_wins: number;
  /** 지금 몇 번째 판인지 */
  round: number;
  history: PvpRound[];
  won: boolean | null;
  tie: boolean;
  /** 배틀주사위: 내가 굴린 눈. 굴리기 전에는 null */
  my_roll: number[] | null;
  /** 배틀주사위: 상대가 굴렸는지 여부 (눈은 그 판이 끝나야 보인다) */
  opponent_rolled: boolean | null;
  opponent_card: number | null;
  my_card: number | null;
  /** 블랙잭: 양쪽 손패·점수·스탠드 여부 (숨기는 정보 없음) */
  my_hand: number[] | null;
  their_hand: number[] | null;
  my_score: number | null;
  their_score: number | null;
  my_stand: boolean | null;
  their_stand: boolean | null;
  /** 블랙잭: 아직 값을 안 고른 에이스가 있으면 팝업으로 골라야 한다. */
  my_pending_ace: boolean | null;
  their_pending_ace: boolean | null;
};

export type PvpInvite = {
  id: number;
  game: PvpGame;
  bet: number;
  from: string;
  expires_in: number;
};

export type PvpState = {
  match: PvpMatch | null;
  invites: PvpInvite[];
  player: PlayerState;
};


export type PlayResult = Omit<PlayerState, "extra_plays" | "extra_max" | "extra_left"> & {
  // 서버 패치(patch_extra_plays.sql)보다 클라이언트가 먼저 배포될 수 있으니
  // 옵셔널로 두고, 없으면 toPlayerState 에서 bonus 값으로 대체한다.
  extra_plays?: number;
  extra_max?: number;
  extra_left?: number;
  game: GameId;
  bet: number;
  choice: string | null;
  outcome: (
    | { slot: number; color: "red" | "black" | "green" }
    | { reels: SlotSymbol[]; kind: "triple" | "pair" | "none" }
    | HighLowOutcome
    | KenoOutcome
  ) & {
    /** 네잎클로버 등 보너스가 이 판 판돈에 얹어 준 코인. 없으면 안 온다. */
    bonus_stake?: number;
  };
  payout: number;
  net: number;
};

/** 게임 결과에서 플레이어 상태 부분만 뽑아낸다. */
export function toPlayerState(r: PlayResult): PlayerState {
  return {
    username: r.username,
    avatar_path: r.avatar_path,
    coins: r.coins,
    plays_used: r.plays_used,
    plays_left: r.plays_left,
    play_limit: r.play_limit,
    hl_card: r.hl_card,
    hl_stage: r.hl_stage,
    hl_bet: r.hl_bet,
    hl_pot: r.hl_pot,
    hl_steps: r.hl_steps,
    hl_max_stage: r.hl_max_stage,
    hl_bonus: r.hl_bonus,
    wear_limit: r.wear_limit,
    luck: r.luck,
    debt: r.debt,
    is_admin: r.is_admin,
    hidden: r.hidden,
    pvp_min_bet: r.pvp_min_bet,
    play_wage: r.play_wage,
    bonus_plays: r.bonus_plays,
    bonus_max: r.bonus_max,
    bonus_left: r.bonus_left,
    extra_plays: r.extra_plays ?? r.bonus_plays,
    extra_max: r.extra_max ?? r.bonus_max,
    extra_left: r.extra_left ?? r.bonus_left,
    win_double: r.win_double,
    hp: r.hp,
    hp_max: r.hp_max,
    hp_status: r.hp_status,
    in_ward: r.in_ward,
    ward_left: r.ward_left,
    suspended: r.suspended,
    suspended_until: r.suspended_until,
    suspended_left: r.suspended_left,
    suspend_reason: r.suspend_reason,
    cell_id: r.cell_id,
    cell: r.cell,
    crime: r.crime,
    age: r.age,
    height_cm: r.height_cm,
    weight_kg: r.weight_kg,
    bio: r.bio,
    items: r.items,
    flex: r.flex,
  };
}

export const ERROR_MESSAGES: Record<string, string> = {
  CANNOT_TRADE_SELF: "자기 자신과는 거래할 수 없습니다.",
  TRADE_ALREADY_OPEN: "이 상대와 진행 중인 거래가 이미 있습니다.",
  TRADE_CLOSED: "이미 끝난 거래입니다.",
  TRADE_EXPIRED: "거래가 만료되었습니다.",
  NOT_YOUR_TRADE: "권한이 없습니다.",
  NO_TRADE: "거래를 찾을 수 없습니다.",
  TRADE_NOT_DONE: "성립된 거래만 취소할 수 있습니다.",
  ALREADY_CONFISCATED: "이미 회수한 거래입니다.",
  TRADE_LINKED: "거래 목록에 남아 있는 거래입니다. 거래 취소로 처리하세요.",
  EMPTY_OFFER: "내놓을 코인이나 아이템을 하나 이상 골라 주세요.",
  MUST_COUNTER: "선물이 아니면 내놓을 것을 정해 되보내야 합니다.",
  GIFT_NO_COUNTER: "선물에는 되보내기를 할 수 없습니다.",
  PARTNER_SHORT_COINS: "상대의 코인이 부족해 거래가 취소되었습니다.",
  PARTNER_SHORT_ITEMS: "상대의 아이템이 부족해 거래가 취소되었습니다.",
  IN_WARD: "휴식 중에는 할 수 없습니다.",
  OPPONENT_IN_WARD: "상대가 휴식 중입니다.",
  NO_HP: "에너지가 부족합니다.",
  NOT_USABLE: "사용할 수 없는 아이템입니다.",
  NOT_SELLABLE: "팔 수 없는 아이템입니다.",
  NOT_BUYABLE: "살 수 없는 아이템입니다.",
  NOT_ENOUGH_ITEMS: "아이템이 부족합니다.",
  NOT_IN_SHOP: "오늘 상점에 없는 품목입니다.",
  DAILY_ITEM_CAP: "이 물품은 오늘 더 살 수 없습니다.",
  ALREADY_BOUGHT: "오늘 이미 가져간 물건입니다.",
  INVALID_PATH: "사진 경로가 올바르지 않습니다.",
  NOT_IN_WARD: "휴식 중일 때만 쓸 수 있습니다.",
  NO_SUCH_ITEM: "그런 아이템이 없습니다.",
  NOT_FLEX: "그런 식으로는 쓸 수 없는 아이템입니다.",
  NOT_SHAREABLE: "함께 쓸 수 없는 아이템입니다.",
  NOT_ROASTABLE: "구울 수 있는 물건이 아닙니다.",
  NOT_MIXABLE: "섞을 수 있는 것이 아닙니다.",
  NO_SUCH_USER: "그런 플레이어가 없습니다.",
  SELF_TARGET: "자기 자신은 고를 수 없습니다.",
  MATE_IN_WARD: "고른 사람이 휴식 중입니다.",
  ALREADY_EQUIPPED: "이미 장착 중입니다.",
  NOT_EQUIPPED: "장착하고 있지 않습니다.",
  FLEX_LIMIT: "동시에 장착할 수 있는 수를 넘었습니다. 하나를 먼저 해제하세요.",
  EQUIPPED_LOCKED: "장착 중인 것은 팔거나 넘길 수 없습니다. 먼저 해제하세요.",
  INVALID_QTY: "수량이 올바르지 않습니다.",
  BET_TOO_LOW: "Arena는 최소 판돈이 정해져 있습니다.",
  OPPONENT_POOR: "상대의 코인이 부족합니다.",
  OPPONENT_NO_HP: "상대의 에너지가 부족합니다.",
  PAIR_LIMIT: "오늘 이 상대와는 더 겨룰 수 없습니다.",
  OPPONENT_BUSY: "상대가 다른 대전 중입니다.",
  ALREADY_IN_MATCH: "이미 진행 중인 대전이 있습니다.",
  CANNOT_INVITE_SELF: "자기 자신에게는 신청할 수 없습니다.",
  INVITE_EXPIRED: "초대가 만료되었습니다.",
  INVITE_CLOSED: "이미 처리된 초대입니다.",
  NOT_YOUR_TURN: "상대 차례입니다.",
  NOT_YOUR_INVITE: "권한이 없습니다.",
  NOT_ACTIVE: "진행 중인 대전이 아닙니다.",
  ALREADY_ROLLED: "이미 굴렸습니다.",
  ACE_PENDING: "에이스 값을 먼저 정해야 합니다.",
  NO_PENDING_ACE: "지금 정할 에이스가 없습니다.",
  NO_MATCH: "대전을 찾을 수 없습니다.",
  NOT_ADMIN: "관리자만 사용할 수 있는 기능입니다.",
  NAME_TAKEN: "이미 있는 이름입니다.",
  INVALID_NAME: "이름을 입력해 주세요.",
  SUSPENDED: "정지된 계정이라 할 수 없습니다.",
  OPPONENT_SUSPENDED: "상대가 정지 상태입니다.",
  INVALID_DAYS: "정지 일수가 올바르지 않습니다.",
  CANNOT_SUSPEND_SELF: "자기 계정은 정지할 수 없습니다.",
  PETITION_NOT_CLOSED: "종료된 피드백만 삭제할 수 있습니다.",
  INVALID_AMOUNT: "지급할 코인 수가 올바르지 않습니다.",
  NO_SUCH_PLAYER: "그런 이름의 플레이어가 없습니다.",
  ALREADY_BLACK: "이미 블랙 회원입니다.",
  LOAN_PENDING: "이미 심사 중인 대출 신청이 있습니다.",
  INVALID_LOAN_AMOUNT: "신청할 수 있는 금액이 아닙니다.",
  NO_DEBT: "갚을 빚이 없습니다.",
  HIGHLOW_IN_PROGRESS:
    "진행 중인 하이로우 게임이 있습니다. 먼저 받거나 계속 진행하세요.",
  NO_LADDER: "진행 중인 하이로우 게임이 없습니다.",
  DAILY_LIMIT: "오늘의 Casual 플레이 횟수를 모두 사용했습니다. 내일 다시 오세요.",
  NOT_ENOUGH_COINS: "코인이 부족합니다.",
  INVALID_BET: "베팅 금액이 올바르지 않습니다.",
  INVALID_CHOICE: "선택이 올바르지 않습니다.",
  INVALID_GAME: "알 수 없는 게임입니다.",
  AUTH_REQUIRED: "로그인이 필요합니다.",
  NO_PROFILE: "프로필을 찾을 수 없습니다. 다시 로그인해 주세요.",
  TOO_SHORT: "내용을 조금 더 적어 주세요.",
  TOO_LONG: "200자 이내로 적어 주세요.",
  TOO_MANY_PENDING: "심사 중인 신청이 이미 3건 있습니다. 처리된 뒤 다시 신청하세요.",
  NO_RELATION: "해당 관계 신청을 찾을 수 없습니다.",
  NO_REASON: "반려 사유를 적어 주세요.",
  REASON_TOO_LONG: "반려 사유는 300자 이내로 적어 주세요.",
  NO_PARTNER: "상대를 골라 주세요.",
  CANNOT_RELATE_SELF: "자기 자신과는 관계를 등록할 수 없습니다.",
  RELATION_EXISTS: "그 사람과는 이미 심사 중인 관계 신청이 있습니다.",
  SUBJECT_TOO_SHORT: "제목을 조금 더 적어 주세요.",
  SUBJECT_TOO_LONG: "제목은 60자 이내로 적어 주세요.",
  BODY_TOO_LONG: "내용은 500자 이내로 적어 주세요.",
  TOO_MANY_OPEN: "답변을 기다리는 피드백이 이미 3건 있습니다. 처리된 뒤 다시 보내 주세요.",
  NO_PETITION: "해당 피드백을 찾을 수 없습니다.",
  PETITION_CLOSED: "이미 종료된 피드백입니다.",
  INVALID_DETAIL: "기재할 수 없는 값입니다.",
  NAME_CODE_MISMATCH: "아이디 또는 비밀번호가 맞지 않습니다.",
  CANNOT_DELETE_SELF: "자기 계정은 지울 수 없습니다.",
  LABOR_DONE: "오늘 미션을 모두 끝냈습니다.",
  LABOR_CLOSED: "지금은 미션 시간이 아닙니다.",
  NIGHT_CLOSED: "지금은 야간 미션 시간이 아닙니다.",
  NIGHT_NOT_ELIGIBLE: "오늘은 야간 미션이 없습니다.",
  LABOR_COOLDOWN: "아직 다음 미션을 시작할 수 없습니다.",
  NOT_ON_BOARD: "오늘 목록에 없는 미션입니다.",
  ALREADY_WORKED: "이미 끝낸 미션입니다.",
  SEARCH_USED: "오늘은 이미 탐험했습니다.",
  INVALID_PLACE: "그런 장소는 없습니다.",
  CAT_GONE: "고양이가 이미 떠났습니다.",
  SNACK_CHOICE: "줄 간식을 골라 주세요.",
  CAT_NOT_OPEN: "아직 고양이가 나타나지 않았습니다.",
  CAT_GIFT_ACTIVE: "앞서 쓴 선물의 효과가 아직 남아 있습니다.",
  CAT_NAME_TAKEN: "고양이 이름이 이미 정해졌습니다.",
  CAT_NAME_INVALID: "이름은 1~12자로 적어 주세요.",
  GIFT_GONE: "이미 처리한 선물입니다.",
  LUCK_ACTIVE: "네잎클로버 효과가 이미 켜져 있습니다. 끝난 뒤에 다시 쓸 수 있습니다.",
  GEAR_ACTIVE: "이미 사용 중입니다.",
  RACE_NOT_OPEN: "경마장이 아직 열리지 않았습니다.",
  RACE_NOT_FOUND: "그런 경주가 없습니다.",
  RACE_CLOSED: "출발 시각이 지나 베팅이 마감됐습니다.",
  RACE_BET_LOW: "베팅은 최소 20코인부터입니다.",
  RACE_BET_HIGH: "한 경주에 걸 수 있는 한도를 넘었습니다.",
};

export function toKoreanError(message: string | undefined): string {
  if (!message) return "알 수 없는 오류가 발생했습니다.";
  for (const [key, text] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(key)) return text;
  }
  return message;
}
