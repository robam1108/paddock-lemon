// 서버(supabase/00_rules.sql · 02_schema.sql)의 규칙과 짝을 이루는 표시용 상수.
// 실제 판정과 정산은 전부 DB 함수 play_game() 안에서만 일어난다.

import { GEAR } from "./gear";
import { RADIO } from "./radio";

export const PLAY_LIMIT = 20;

// 백색구역 게임 1판마다 지급하는 일당. 판돈의 절반이 이보다 적으면 그만큼만 준다.
// (실제 값은 사람마다 다르다 — 서버 app.play_wage(코인) 이 정하고 state.play_wage 로
//  내려온다. 0 이면 화면의 일당 안내를 감춘다. 이 값은 표시용 기본치.)
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
// 1~40 에서 5개를 고르면 시설이 10개를 뽑는다. 추첨 수 10 도 배당표의 일부다 —
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

/* ---------------- 체력 ---------------- */
export type HpStatus = "정상" | "피로" | "쇠약" | "위독" | "병동";

export const HP_TIERS: { max: number; status: HpStatus; className: string }[] = [
  { max: 0, status: "병동", className: "text-rose-400" },
  { max: 10, status: "위독", className: "text-red-400" },
  { max: 30, status: "쇠약", className: "text-orange-400" },
  { max: 50, status: "피로", className: "text-amber-400" },
  { max: 100, status: "정상", className: "text-emerald-400" },
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

/** 가축 관계처럼 며칠 단위로 남는 것에 쓴다. "2일 5시간" */
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
  /** 사용 시 회복되는 체력 */
  heal: number;
  /** 사용 시 되살아나는 게임 횟수 */
  plays: number;
  /** 사용 시 줄어드는 병동 시간(시간) */
  ward_cut: number;
  /** 사용 시 얻는 "다음 승리 판돈 2배" 횟수 */
  win_double: number;
  buy_price: number | null;
  /** 배급소 품목에만 붙는다 — 할인 중일 때의 정가(네잎클로버). 할인이 아니면 null */
  list_price?: number | null;
  sell_price: number | null;
  tradable: boolean;
  description?: string;
  /** 배급소 품목에만 붙는다 — 품목당 하루 구매 상한과 오늘 이미 산 수량 */
  daily_cap?: number;
  bought?: number;
  /** 배급소 품목에만 붙는다 — 오늘 훔치기를 이미 썼는지.
   *  시도권은 품목별이 아니라 배급소 전체에 하나라서 모든 항목에 같은 값이 온다. */
  steal_used?: boolean;
  /** 과시 갈래. 없으면 과시 아이템이 아니다 */
  flex_kind?: "consume" | "wear" | null;
  /** consume 일 때 남에게 보이는 시간(시간 단위) */
  flex_hours?: number;
  /** 중독 해제 전용 아이템(해독제) 표식 */
  detox?: boolean;
  /** 한 개에 든 사용 횟수(개비 수). 없거나 1이면 한 번 쓰면 사라진다 */
  uses?: number;
  /** 절도비법 전용 표식. true 면 장착해 둘 수 있고, 그러면 다음 훔치기
   *  한 번이 확정 성공한다(profiles.steal_sure). */
  steal_sure?: boolean;
  /** 누군가와 함께 쓸 수 있는지(item_defs.flex_text_with 가 있는 술·약물·젤).
   *  true 면 쓰기 전에 혼자/함께 팝업이 뜬다. */
  shareable?: boolean;
};

/** 본인에게만 보이는 과시 상태 한 줄. state.flex 가 이 배열을 들고 있다.
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
  tobacco: "담배",
  liquor: "술",
  medicine: "의약품",
  drug: "약물",
  luxury: "사치품",
  permit: "증서",
  treat: "기호식품",
  tool: "연장",
  adult: "성인용품",
  trick: "비법",
  event: "명절",
  charm: "부적",
  gift: "보은",
};

/* ---------------- 네잎클로버 (부적) ----------------
   배급소 전용. 쓰면 flex_hours(6시간) 동안 모든 판의 판돈에 시설이 코인을 얹는다.
   값은 서버 17_items.sql 의 "판돈 추가(stake_bonus)" 표가 정한다 — 여기는 표시용이다. */
export const CLOVER = "clover";
export const CLOVER_STAKE = 15;

/** state.luck — 네잎클로버가 켜져 있을 때만 값이 있다 */
export type LuckEffect = {
  /** 한 판에 얹히는 판돈 */
  stake: number;
  ends_at: string;
};

/* ---------------- 추석 송편 (한정 이벤트) ----------------
   값은 서버 00_rules.sql 의 app.chuseok_* 가 정한다. 여기는 화면용 이름·색·문구뿐이다. */
export type ChuseokGrade = "uncommon" | "rare" | "epic";

export const SONGPYEON: {
  grade: ChuseokGrade;
  code: string;
  name: string;
  /** 떡 색 */
  color: string;
  effect: string;
}[] = [
  { grade: "uncommon", code: "songpyeon_white", name: "흰 송편", color: "#f3efe4", effect: "하루 게임 +5판" },
  { grade: "rare", code: "songpyeon_green", name: "쑥 송편", color: "#7fa36b", effect: "매일 첫 5판 판돈 +15" },
  { grade: "epic", code: "songpyeon_pink", name: "분홍 송편", color: "#e79ab4", effect: "매일 첫 7판 판돈 +30" },
];

/** 9/24 저녁 배급 때 한 장 들어오는 송편 쿠폰. 소지품에서 쓰면 뽑기 팝업이 뜬다. */
export const SONGPYEON_COUPON = "songpyeon_coupon";

/** state.chuseok — 송편을 먹은 뒤 이벤트가 끝날 때까지만 값이 있다 */
export type ChuseokEffect = {
  grade: ChuseokGrade;
  /** 오늘 더해진 게임 횟수(흰 송편만 5) */
  plays: number;
  /** 한 판에 얹히는 판돈(쑥 15 · 분홍 30) */
  stake: number;
  /** 하루에 판돈이 얹히는 판 수 */
  uses: number;
  /** 오늘 남은 판 수 */
  left: number;
  ends_at: string;
};

/** chuseok_state / chuseok_draw / chuseok_reroll / chuseok_finish 의 응답 */
export type ChuseokDraw = {
  open: boolean;
  grade: ChuseokGrade | null;
  rerolled: boolean;
  done: boolean;
};

/** 절도비법 코드. 밀거래 특별 상품(12% 분기)과 수용동 탐색의 전설 등급에서만
 *  나온다. 소지품에서 장착해 두면 다음 훔치기 한 번이 확정 성공한다. */
export const STEAL_TRICK = "steal_trick";

/** 밀거래 특별 상품 옆에 뜨는 가축 지목권 코드. 소지품 탭에서 이 코드만 팝업을 연다. */
export const LIVESTOCK_PASS = "livestock_pass";
// 가축 사슬 최대 인원(주인 포함). 서버 app.livestock_chain_max()(06_relations.sql)와 맞춘다.
export const LIVESTOCK_CHAIN_MAX = 3;

/** 가축 지목권과 나란히 뜨는 호칭권 코드. 소지품 탭에서 이 코드만 팝업을 연다. */
export const TITLE_PASS = "title_pass";

/** 담배에 불을 붙일 수 있는 물건. 장착(flex_equip)해도 인벤에 그대로 남으므로
 *  보유 수량만 보면 장착 여부와 무관하게 판정된다. */
export const LIGHTER_CODES = ["lighter_old", "lighter_ag", "lighter_au"];

/** 담배는 불을 붙일 것이 있어야 쓴다 — 서버 flex_use 의 NEED_LIGHTER 와 같은 기준. */
export function needsLighter(it: { kind?: string }): boolean {
  return it.kind === "tobacco";
}

/** 라이터로 구울 수 있는 것 → 구운 것. 서버 public.roast_item 과 맞춘다. */
export const ROAST_TO: Record<string, string> = {
  sweet_potato_chestnut: "roast_potato_chestnut",
  sweet_potato_pumpkin: "roast_potato_pumpkin",
  fish_mackerel: "roast_fish_mackerel",
  fish_horse_mackerel: "roast_fish_horse_mackerel",
};

/** 축사 우유. 소지품에서 아래 음료와 섞을 수 있다(서버 public.mix_item). */
export const MILK = "milk";

/** 우유에 섞을 수 있는 것 → 섞은 것. 서버 public.mix_item 과 맞춘다. */
export const MIX_TO: Record<string, string> = {
  instant_coffee: "cafe_latte",
  ice_coffee: "iced_latte",
  rooibos_tea: "milk_tea",
};

/** 섞기 창에서 결과를 아직 안 가졌을 때 보여 줄 이름(17_items.sql 과 같게). */
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
  detox?: boolean;
  /** 한 개에 든 사용 횟수(개비 수). 1 이하면 표시하지 않는다 */
  uses?: number;
  steal_sure?: boolean;
};

/** 아이템 효과를 한 줄로 */
export function itemEffect(it: Effectish): string {
  if (it.code === LIVESTOCK_PASS) return "가축 소유 가능";
  if (it.code === TITLE_PASS) return "호칭 지정 가능";
  if (it.code === RADIO) return "켜면 노래가 나온다";
  if (it.code === CHURU) return "고양이 간식";
  if (it.kind === "gift") return "고양이의 보은";
  if (it.steal_sure) return "훔치기 1회 확정 성공";
  if (it.code === SONGPYEON_COUPON) return "송편 랜덤 뽑기 · 9/26까지";
  if (it.kind === "event") {
    const sp = SONGPYEON.find((x) => x.code === it.code);
    return sp ? `${sp.effect} · 9/26까지` : "명절 한정";
  }
  if (it.kind === "charm") return `판돈 +${CLOVER_STAKE} · ${it.flex_hours ?? 6}시간`;
  const parts: string[] = [];
  if (it.heal > 0) parts.push(`체력 +${it.heal}`);
  if (it.plays > 0) parts.push(`게임 횟수 +${it.plays}`);
  if (it.ward_cut > 0) {
    parts.push(it.ward_cut >= 48 ? "병동 즉시 퇴원" : `병동 -${it.ward_cut}시간`);
  }
  if (it.win_double > 0) parts.push("다음 승리 판돈 2배");
  if (it.detox) parts.push("중독 해제");
  if (it.uses && it.uses > 1) parts.push(`${it.uses}개비`);
  if (it.flex_kind === "consume") {
    parts.push(it.flex_hours ? `남에게 보임 · ${it.flex_hours}시간` : "남에게 보임");
  } else if (it.flex_kind === "wear") {
    parts.push("장착 가능");
  }
  return parts.join(" · ") || "소지품";
}

export function isUsable(it: Effectish): boolean {
  return (
    it.code === LIVESTOCK_PASS ||
    it.code === TITLE_PASS ||
    it.kind === "event" ||
    it.kind === "charm" ||
    it.heal > 0 ||
    it.plays > 0 ||
    it.ward_cut > 0 ||
    it.win_double > 0 ||
    !!it.detox ||
    it.flex_kind === "consume" ||
    it.flex_kind === "wear"
  );
}

/** use_item / flex_use / flex_equip 중 이 아이템이 어느 RPC로 쓰이는지.
 *  효과가 있는 것(식량·의약품·약물·해독제·증서)은 전부 use_item —
 *  약물이 동시에 flex_kind='consume' 이어도 use_item 하나로 게임 효과와
 *  과시 상태가 함께 적용된다. 나머지 소모형 과시품(담배·술·향수)만
 *  flex_use, 장착형(라이터·반지·시계·절도비법)은 flex_equip/flex_unequip.
 *  라디오는 consume 이지만 사라지지 않아 radio_on 으로 따로 켠다.
 *  운동기구도 같은 결로 gear_on 으로 1시간 착용한다. */
export type ItemAction =
  | "use"
  | "flex_use"
  | "flex_equip"
  | "songpyeon"
  | "coupon"
  | "radio"
  | "gear"
  | null;

export function itemAction(it: Effectish): ItemAction {
  if (it.code === SONGPYEON_COUPON) return "coupon";
  if (it.code === RADIO) return "radio";
  if (it.code && GEAR.has(it.code)) return "gear";
  if (it.kind === "event") return "songpyeon";
  // 약물은 게임 효과가 없는 RP 전용(헤로인 등)이어도 use_item 으로 쓴다 —
  // 중독 부하와 투약 기록을 거기서만 쌓는다.
  const hasEffect =
    it.heal > 0 || it.plays > 0 || it.ward_cut > 0 || it.win_double > 0 || !!it.detox ||
    it.kind === "drug";
  if (it.code === LIVESTOCK_PASS || it.code === TITLE_PASS || it.kind === "charm" || hasEffect)
    return "use";
  if (it.flex_kind === "consume") return "flex_use";
  if (it.flex_kind === "wear") return "flex_equip";
  return null;
}

/* ---------------- 밀거래 · 라스트 카드 ---------------- */
export type LastCardPurpose = "unlock" | "special";

/** 진행 중이거나 오늘 끝난 판. npc_played 는 이미 공개된 카드만 담는다. */
export type LastCardView = {
  id: number;
  purpose: LastCardPurpose;
  my_cards: number[];
  my_played: number[];
  npc_played: number[];
  npc_left: number;
  results: ("me" | "npc")[];
  status: "playing" | "won" | "lost";
};

export type SmuggleSpecial = {
  /** 'trick' 은 절도비법 전용 칸 — 원가 취소선 없이 정가로 뜬다('sale'만 취소선) */
  kind: "grade" | "sale" | "trick";
  price: number;
  /** 'sale' 일 때만: 취소선으로 보일 정가. 약물은 누진이 얹힌 값이라 item.buy_price 와 다르다 */
  list_price?: number | null;
  item: ItemDef;
};

/** 특별 상품이 열린 날에만 그 옆에 나란히 뜬다. 가축 지목권(500)·호칭권(150) 공용 모양. */
export type SmugglePermit = {
  price: number;
  item: ItemDef;
};

export type SmuggleState = {
  unlocked: boolean;
  /** 다음 승부까지 남은 초. 0이면 지금 붙을 수 있다 */
  cooldown_left: number;
  items: ItemDef[];
  /** 오늘 특별 상품 승부를 이겨 칸이 열렸는지 */
  special_open?: boolean;
  /** 열린 특별 상품 칸들(하루 3칸). 안 열렸으면 빈 배열 */
  specials?: SmuggleSpecial[];
  /** 한 칸이던 시절의 키 — specials 의 첫 칸. 옛 서버 호환용 */
  special?: SmuggleSpecial | null;
  livestock: SmugglePermit | null;
  title: SmugglePermit | null;
  /** 가장 최근 한 판. 진행 중일 수도, 이미 끝난 판일 수도 있다 */
  game: LastCardView | null;
  /** 오늘 이미 가져간 품목 코드(상시분 + 특별 상품). 하나당 하루 한 개까지만. */
  bought: string[];
  /** 오늘 밀거래 훔치기를 이미 썼는지. 배급소 시도권과는 별개다. */
  steal_used?: boolean;
  /** 오늘 상시분 다시 보기를 이미 했는지(하루 한 번) */
  rerolled?: boolean;
  /** 다시 보기 값 */
  reroll_price?: number;
};

/** 훔치기 한 번의 결과. shop_steal / smuggle_steal 이 상태에 얹어 돌려준다. */
export type StealResult = {
  ok: boolean;
  item_name: string;
  /** 실제로 깎인 코인. 성공이면 0 */
  coin_cut: number;
  /** 실제로 깎인 체력. 성공이거나 코인만으로 갚았으면 0 */
  hp_cut: number;
  /** 이 실패로 병동에 실려 갔는지 */
  to_ward: boolean;
};

/* ---------------- 작업장 ---------------- */

/** labor_board() 가 돌려주는 오늘의 배정. 난이도·보수 범위는 서버에만 있다 —
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
    /** 야간작업 한 번에 드는 체력(낮의 hp_cost 와 따로) */
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
  /** 공중변소 청소 high 문구에 들어갈 수감자 이름. 없으면 null */
  visitor?: string | null;
};

/* ---------------- 탐색 ---------------- */

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
  /** 시험 계정('관리자' + 관리자 권한). 하루 한 번 제한·체력 없이 탐색하고 테스트 패널을 쓴다 */
  tester?: boolean;
  /** 이하 시험 계정에게만 온다 — 오늘 고양이 자리 · 내 친밀도 · 가진 츄르 · 처리 안 한 보은 수 */
  cat_place?: string;
  churu_given?: number;
  churu_held?: number;
  gifts_waiting?: number;
  /** 죽은 새가 판돈을 얹어 줄 남은 판 */
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

/* ---------------- 탐색 고양이 ---------------- */

/** 고양이 간식. 서버 app.cat_churu_item() 과 같다. */
export const CHURU = "churu";
/** 고양이 간식이 되는 날생선·우유(app.cat_fish_items). 츄르보다 친밀도가 더 오른다. */
export const CAT_FISH_CODES = new Set(["fish_mackerel", "fish_horse_mackerel", "milk"]);

/** 보은으로 오는 세 품목(app.cat_gift_items). 거래가 안 되고 몰래버리기로 치운다.
 *  쓰면(public.cat_gift_use) 품목마다 효과가 하나 켜진다 — 설명은 사용 팝업에만. */
export const CAT_GIFT_CODES = new Set(["dead_bird", "dead_mouse", "dead_bug"]);
/** 보은 효과(표시용). 서버 app.cat_bird_stake · app.cat_bird_plays · app.cat_mouse_steal 과 같다. */
export const CAT_BIRD_STAKE = 10;
export const CAT_BIRD_PLAYS = 3;
export const CAT_MOUSE_STEAL = 10;

/** 소지품 탭이 cat_gifts_pending() 으로 받는 값 */
export type CatStatus = {
  /** 내가 지은 고양이 이름. 아직 없으면 null */
  cat_name: string | null;
  gifts: CatGift[];
  /** 죽은 새가 판돈을 얹어 줄 남은 판 수 */
  bless_left: number;
  /** 죽은 쥐 — 다음 훔치기를 기다리는 중 */
  steal_ready: boolean;
  /** 죽은 벌레 — 다음 작업을 기다리는 중 */
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

/** 도착한 보은 하나 */
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
  /** 하이로우 판을 열 때 추석 송편·네잎클로버가 얹어 준 판돈. 첫 판정의 기준액은 hl_bet + hl_bonus */
  hl_bonus?: number;
  /** 착용형을 동시에 장착할 수 있는 수(app.flex_wear_limit). 겹쳐 장착한 것도 그 수만큼 센다 */
  wear_limit?: number;
  /** 추석 송편 효과. 먹지 않았거나 이벤트가 끝났으면 null */
  chuseok?: ChuseokEffect | null;
  /** 네잎클로버 효과. 켜져 있지 않으면 null */
  luck?: LuckEffect | null;
  /** 대출로 빌린 뒤 아직 갚지 않은 코인 */
  debt: number;
  is_admin: boolean;
  /** 명단·접속자·순위표 등에서 감추는 계정인가 */
  hidden: boolean;
  /** 흑색구역 1:1 대전의 최소 판돈 */
  pvp_min_bet: number;
  /** 백색구역 게임 1판마다 지급하는 일당. 판돈이 이보다 적으면 판돈만큼만 받는다 */
  play_wage: number;
  /** 오늘 아이템으로 되살린 게임 횟수 */
  bonus_plays: number;
  /** 하루에 아이템으로 되살릴 수 있는 상한 */
  bonus_max: number;
  /** 아직 더 되살릴 수 있는 횟수 */
  bonus_left: number;
  /** 오늘 약물로 되살린 게임 횟수. bonus_plays 와는 별개 하위 상한을 쓰지만,
   *  결국 extra_max 총량을 bonus_plays 와 공유한다 */
  drug_plays: number;
  drug_max: number;
  drug_left: number;
  /** 식량·의약품·약물을 합친 오늘 회복 횟수 (= bonus_plays + drug_plays) */
  extra_plays: number;
  /** 그 총량 상한. daily_play_limit() 에 이만큼까지만 더해진다 */
  extra_max: number;
  /** 총량 기준으로 아직 더 되살릴 수 있는 횟수 */
  extra_left: number;
  /** 약물 누적 부하가 임계를 넘겨 중독 낙인이 붙었는지. 해독제로만 풀린다 */
  addicted: boolean;
  /** 특이사항 맨 앞에 붙는 중독·금단 문장(app.addict_lines). 중독이 아니면 빈 배열.
   *  쓴 약물마다 한 줄씩이라 줄 수로 금단을 가늠하지 않는다. 옛 서버면 없을 수 있다 */
  addict_lines?: string[];
  /** 금단 중인지(app.in_withdrawal). 옛 서버면 없을 수 있다 */
  withdrawal?: boolean;
  /** use_item 응답에만 실린다 — 효과를 적용하기 직전의 체력 */
  hp_before?: number;
  /** use_item 응답에만 실린다 — 약물 부작용으로 잃은 체력(0 이면 무사) */
  hp_lost?: number;
  /** use_item 응답에만 실린다 — 이번에 실제로 늘어난 게임 횟수 */
  plays_gained?: number;
  /** use_together 응답에만 실린다 — 함께 쓴 상대 이름 */
  with?: string;
  /** use_together 로 음식을 함께 먹었을 때만 — 상대가 실제로 얻은 체력·횟수 */
  mate_heal?: number;
  mate_plays?: number;
  /** 남아 있는 "다음 승리 판돈 2배" 횟수 */
  win_double: number;
  hp: number;
  hp_max: number;
  hp_status: HpStatus;
  /** 체력이 0이라 병동에 있는 상태 */
  in_ward: boolean;
  /** 퇴원까지 남은 초 */
  ward_left: number;
  /** 관리자가 정지시킨 상태. 게임·거래·상점·대전이 막힌다 (진정함은 열려 있다) */
  suspended: boolean;
  suspended_until: string | null;
  /** 정지 해제까지 남은 초 */
  suspended_left: number;
  suspend_reason: string | null;
  /** 절도비법을 장착해 두었는지. true 면 다음 훔치기 한 번이 확정 성공하고
   *  그 자리에서 다시 false 로 꺼진다(해제해도 곧장 꺼진다). */
  steal_sure: boolean;
  /** 배정된 수용실. 아직 없으면 null */
  cell_id: number | null;
  /** "4동 08실". 아직 배정 전이면 null */
  cell: string | null;
  /** 본인이 직접 기재. 미기재면 null */
  crime: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  bio: string | null;
  /** 가축권 동의 여부. 아직 기재 전이면 null(미기재) */
  livestock_consent: boolean | null;
  /** 지목자로서 가축 지목권을 쓴 뒤, 동의 철회가 막히는 남은 초 */
  livestock_lock_left: number;
  items: InventoryItem[];
  /** 과시 상태 목록. 남은 시간(expires_at)은 본인 신상 화면에만 노출된다 */
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

/* ---------------- 진정함 ---------------- */
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
  { id: "RECORD", label: "수감기록" },
  { id: "LABOR", label: "작업장" },
  { id: "SEARCH", label: "탐색" },
  { id: "WHITE", label: "백색구역" },
  { id: "BLACK", label: "흑색구역" },
  { id: "EXCHANGE", label: "거래소" },
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
  kind: "game" | "shop" | "trade" | "smuggle" | "labor" | "search" | "admin";
  title: string;
  coin_delta: number;
  coin_after: number;
  detail: Record<string, unknown>;
  created_at: string;
};

export const LEDGER_KIND_LABEL: Record<string, string> = {
  game: "게임",
  shop: "배급소",
  trade: "거래",
  smuggle: "밀거래",
  labor: "작업",
  search: "탐색",
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
  // 옵셔널로 두고, 없으면 toPlayerState 에서 bonus/drug 값으로 대체한다.
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
    /** 추석 송편(희귀·특급)이 이 판 판돈에 얹어 준 코인. 없으면 안 온다. */
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
    chuseok: r.chuseok,
    luck: r.luck,
    debt: r.debt,
    is_admin: r.is_admin,
    hidden: r.hidden,
    pvp_min_bet: r.pvp_min_bet,
    play_wage: r.play_wage,
    bonus_plays: r.bonus_plays,
    bonus_max: r.bonus_max,
    bonus_left: r.bonus_left,
    drug_plays: r.drug_plays,
    drug_max: r.drug_max,
    drug_left: r.drug_left,
    extra_plays: r.extra_plays ?? r.bonus_plays + r.drug_plays,
    extra_max: r.extra_max ?? r.bonus_max,
    extra_left: r.extra_left ?? r.bonus_left,
    addicted: r.addicted,
    addict_lines: r.addict_lines,
    withdrawal: r.withdrawal,
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
    steal_sure: r.steal_sure,
    cell_id: r.cell_id,
    cell: r.cell,
    crime: r.crime,
    age: r.age,
    height_cm: r.height_cm,
    weight_kg: r.weight_kg,
    bio: r.bio,
    livestock_consent: r.livestock_consent,
    livestock_lock_left: r.livestock_lock_left,
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
  IN_WARD: "병동에 있는 동안에는 할 수 없습니다.",
  OPPONENT_IN_WARD: "상대가 병동에 있습니다.",
  NO_HP: "체력이 부족합니다.",
  NOT_USABLE: "사용할 수 없는 아이템입니다.",
  NOT_SELLABLE: "팔 수 없는 아이템입니다.",
  NOT_BUYABLE: "살 수 없는 아이템입니다.",
  NOT_ENOUGH_ITEMS: "아이템이 부족합니다.",
  NOT_IN_SHOP: "오늘 배급소에 올라오지 않은 물품입니다.",
  DAILY_ITEM_CAP: "이 물품은 오늘 더 살 수 없습니다.",
  NOT_IN_SMUGGLE: "오늘 그쪽에 올라오지 않은 물건입니다.",
  ALREADY_BOUGHT: "오늘 이미 가져간 물건입니다.",
  SMUGGLE_REROLLED: "오늘은 이미 다른 물건을 한 번 봤다.",
  REROLL_EMPTY: "더 꺼내 올 물건이 없다.",
  STEAL_USED: "오늘은 이미 한 번 손을 댔다.",
  CANNOT_STEAL: "그건 훔칠 수 없다.",
  ALREADY_ARMED: "이미 비법을 새겨 두었다.",
  NOT_UNLOCKED: "아직 그쪽 물건을 볼 자격이 없습니다.",
  ALREADY_UNLOCKED: "이미 밀거래가 열려 있습니다.",
  SPECIAL_ALREADY_OPEN: "오늘 특별 상품은 이미 열려 있습니다.",
  LASTCARD_COOLDOWN: "아직 때가 아닙니다. 5시간마다 한 번씩만 붙을 수 있습니다.",
  GAME_IN_PROGRESS: "붙고 있는 판이 아직 안 끝났습니다.",
  NO_GAME: "지금 붙고 있는 판이 없습니다.",
  NOT_YOUR_CARD: "가진 카드가 아니거나 이미 낸 카드입니다.",
  INVALID_PURPOSE: "알 수 없는 승부입니다.",
  INVALID_PATH: "사진 경로가 올바르지 않습니다.",
  NOT_IN_WARD: "병동에 있을 때만 쓸 수 있습니다.",
  NO_SUCH_ITEM: "그런 아이템이 없습니다.",
  NOT_ADDICTED: "중독 상태가 아니면 쓸 수 없습니다.",
  NOT_FLEX: "그런 식으로는 쓸 수 없는 아이템입니다.",
  NEED_LIGHTER: "불을 붙일 라이터가 없습니다.",
  NOT_SHAREABLE: "함께 쓸 수 없는 아이템입니다.",
  NOT_ROASTABLE: "구울 수 있는 물건이 아닙니다.",
  NOT_MIXABLE: "섞을 수 있는 것이 아닙니다.",
  NO_SUCH_USER: "그런 수감자가 없습니다.",
  SELF_TARGET: "자기 자신은 고를 수 없습니다.",
  MATE_IN_WARD: "고른 사람이 병동에 있습니다.",
  ALREADY_EQUIPPED: "이미 장착 중입니다.",
  NOT_EQUIPPED: "장착하고 있지 않습니다.",
  FLEX_LIMIT: "동시에 장착할 수 있는 수를 넘었습니다. 하나를 먼저 해제하세요.",
  EQUIPPED_LOCKED: "장착 중인 것은 팔거나 넘길 수 없습니다. 먼저 해제하세요.",
  INVALID_QTY: "수량이 올바르지 않습니다.",
  BET_TOO_LOW: "흑색구역은 최소 판돈이 정해져 있습니다.",
  OPPONENT_POOR: "상대의 코인이 부족합니다.",
  OPPONENT_NO_HP: "상대의 체력이 부족합니다.",
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
  PETITION_NOT_CLOSED: "종결된 진정만 삭제할 수 있습니다.",
  INVALID_AMOUNT: "지급할 코인 수가 올바르지 않습니다.",
  NO_SUCH_PLAYER: "그런 이름의 플레이어가 없습니다.",
  ALREADY_BLACK: "이미 블랙 회원입니다.",
  LOAN_PENDING: "이미 심사 중인 대출 신청이 있습니다.",
  INVALID_LOAN_AMOUNT: "신청할 수 있는 금액이 아닙니다.",
  NO_DEBT: "갚을 빚이 없습니다.",
  HIGHLOW_IN_PROGRESS:
    "진행 중인 하이로우 게임이 있습니다. 먼저 받거나 계속 진행하세요.",
  NO_LADDER: "진행 중인 하이로우 게임이 없습니다.",
  DAILY_LIMIT: "오늘의 백색구역 배정을 모두 사용했습니다. 내일 다시 오세요!",
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
  NOT_CONSENTED: "그 사람은 가축권에 동의하지 않았습니다.",
  ALREADY_LIVESTOCK: "이미 다른 사람의 가축입니다.",
  LIVESTOCK_CHAIN_FULL: "가축 사슬은 주인 포함 3명까지만 이어질 수 있습니다.",
  RELATION_EXISTS: "그 사람과는 이미 심사 중인 관계 신청이 있습니다.",
  ALREADY_TITLED: "이미 다른 사람에게 호칭을 지정당했습니다.",
  CANNOT_TARGET_OWNER: "이미 나를 그렇게 지목해 둔 상대는 다시 지목할 수 없습니다.",
  CANNOT_DELETE_LIVESTOCK: "가축 관계는 기간이 끝나야 사라집니다.",
  CANNOT_DELETE_TITLE: "호칭 관계는 기간이 끝나야 사라집니다.",
  NO_TITLE: "호칭을 적어 주세요.",
  LIVESTOCK_PASS_HELD: "가축 지목권을 가지고 있는 동안은 가축권 동의를 철회할 수 없습니다.",
  TITLE_PASS_HELD: "호칭권을 가지고 있는 동안은 가축권 동의를 철회할 수 없습니다.",
  LIVESTOCK_ACTIVE: "가축 관계가 진행 중인 동안은 가축권 동의를 철회할 수 없습니다.",
  TITLE_ACTIVE: "호칭 관계가 진행 중인 동안은 가축권 동의를 철회할 수 없습니다.",
  LIVESTOCK_COOLDOWN: "가축 지목권·호칭권을 사용한 뒤 7일 동안은 가축권 동의를 철회할 수 없습니다.",
  SUBJECT_TOO_SHORT: "제목을 조금 더 적어 주세요.",
  SUBJECT_TOO_LONG: "제목은 60자 이내로 적어 주세요.",
  BODY_TOO_LONG: "내용은 500자 이내로 적어 주세요.",
  TOO_MANY_OPEN: "이미 처리되지 않은 진정이 3건 있습니다. 처리된 뒤 다시 접수하세요.",
  NO_PETITION: "해당 진정을 찾을 수 없습니다.",
  PETITION_CLOSED: "이미 종결된 진정입니다.",
  INVALID_DETAIL: "기재할 수 없는 값입니다.",
  NAME_CODE_MISMATCH: "이름과 코드가 맞지 않습니다.",
  CANNOT_DELETE_SELF: "자기 계정은 지울 수 없습니다.",
  LABOR_DONE: "오늘 배정된 작업은 다 끝냈다.",
  LABOR_CLOSED: "지금은 작업 시간이 아니다.",
  NIGHT_CLOSED: "지금은 야간작업 시간이 아니다.",
  NIGHT_NOT_ELIGIBLE: "오늘 밤 야간작업 배정이 없다.",
  LABOR_COOLDOWN: "아직 다음 작업에 들어갈 수 없다.",
  NOT_ON_BOARD: "오늘 배정에 없는 작업이다.",
  ALREADY_WORKED: "이미 끝낸 작업이다.",
  SEARCH_USED: "오늘은 이미 한 번 돌아봤다.",
  INVALID_PLACE: "그런 곳은 없다.",
  CAT_GONE: "고양이는 이미 가 버렸다.",
  SNACK_CHOICE: "줄 간식을 골라 주세요.",
  CAT_NOT_OPEN: "아직 고양이가 나타나지 않는다.",
  CAT_GIFT_ACTIVE: "아직 앞의 기운이 남아 있다. 다 쓴 뒤에 다시 쓸 수 있다.",
  CAT_NAME_TAKEN: "고양이 이름은 이미 정해졌다.",
  CAT_NAME_INVALID: "이름은 1~12자로 적어 주세요.",
  GIFT_GONE: "이미 처리한 보은이다.",
  EVENT_OVER: "추석 이벤트가 끝났습니다.",
  ALREADY_ACTIVE: "이미 송편을 먹었습니다. 효과는 하나만 받을 수 있습니다.",
  ALREADY_REROLLED: "한 번 더 뽑기는 이미 썼습니다.",
  NOT_DRAWN: "아직 송편을 뽑지 않았습니다.",
  ALREADY_DRAWN: "이미 송편을 받았습니다. 뽑기는 한 사람에 한 번입니다.",
  LUCK_ACTIVE: "이미 네잎클로버를 쥐고 있다. 효과가 끝난 뒤에 다시 쓸 수 있다.",
  GEAR_ACTIVE: "이미 착용하고 있다.",
  RACE_NOT_OPEN: "경마장은 아직 열리지 않았다.",
  RACE_NOT_FOUND: "그런 경주는 없다.",
  RACE_CLOSED: "발주 시각이 지나 마권 발매가 끝났다.",
  RACE_BET_LOW: "마권 한 장은 최소 20코인부터다.",
  RACE_BET_HIGH: "한 경주에 걸 수 있는 한도를 넘었다.",
};

export function toKoreanError(message: string | undefined): string {
  if (!message) return "알 수 없는 오류가 발생했습니다.";
  for (const [key, text] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(key)) return text;
  }
  return message;
}
