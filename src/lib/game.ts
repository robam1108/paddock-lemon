// 게임 화면에서 쓰는 타입과 표시용 도우미.
// 실제 판정과 정산은 전부 DB 함수(play_game 등) 안에서만 일어난다.
// 배당 · 한도 같은 규칙 숫자는 여기에 적지 않는다 — 서버 get_rules() 값을 getRules() 로 읽는다.

import type { ItemGrade } from "./items";
import type { PlayerState } from "./types";
import { getRules } from "./server-rules";

export type GameId = "roulette" | "slots" | "highlow" | "keno";

/** 게임 탭 목록. 설명 속 숫자도 서버 규칙에서 만든다. */
export function gameList(): { id: GameId; name: string; emoji: string; desc: string }[] {
  const r = getRules();
  const topSlot = Math.max(...Object.values(r.slots.triple));
  return [
    { id: "roulette", name: "룰렛", emoji: "🎯", desc: `색을 맞히면 ${r.roulette.color_mult}배, 초록은 ${r.roulette.number_mult}배` },
    { id: "slots", name: "슬롯머신", emoji: "🎰", desc: `3개 일치 최대 ${topSlot}배` },
    { id: "highlow", name: "하이로우", emoji: "🃏", desc: "다음 카드가 높을까 낮을까" },
    { id: "keno", name: "키노", emoji: "🔢", desc: `${r.keno.range}개 중 ${r.keno.picks}개를 고르고 ${r.keno.draws}개를 뽑는다` },
  ];
}

/* ---------------- 룰렛 ---------------- */
// 0 = 초록, 1~7 = 빨강, 8~14 = 검정 (칸 수는 getRules().roulette.slots)

export function rouletteColor(slot: number): "green" | "red" | "black" {
  if (slot === 0) return "green";
  return slot <= 7 ? "red" : "black";
}

/** 색 베팅 버튼. 배율은 서버 규칙 값이다. */
export function rouletteBets() {
  const r = getRules().roulette;
  return [
    { id: "red", label: "빨강", mult: r.color_mult, className: "bet-red" },
    { id: "black", label: "검정", mult: r.color_mult, className: "bet-black" },
    { id: "green", label: "초록", mult: r.number_mult, className: "bet-green" },
  ] as const;
}

export function isNumberBet(choice: string | null): boolean {
  return !!choice && /^([0-9]|1[0-4])$/.test(choice);
}

export function rouletteChoiceLabel(choice: string | null): string {
  if (!choice) return "";
  if (isNumberBet(choice)) return `숫자 ${choice}`;
  return choice === "red" ? "빨강" : choice === "black" ? "검정" : "초록";
}

/* ---------------- 슬롯머신 ---------------- */
/** 릴 그림. 배당(getRules().slots.triple)과 확률(getRules().slots.pool)은 서버 값이다. */
export const SLOT_EMOJI = {
  cherry: "🍒",
  lemon: "🍋",
  bell: "🔔",
  star: "⭐",
  seven: "7️⃣",
  diamond: "💎",
} as const;

export type SlotSymbol = keyof typeof SLOT_EMOJI;

/** 세 칸 일치 배당 */
export function slotTripleMult(symbol: SlotSymbol): number {
  return getRules().slots.triple[symbol] ?? 0;
}

/* ---------------- 하이로우 ---------------- */
export const CARD_LABELS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export type HighLowChoice = "high" | "low" | "same";

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
 *  서버 app.hl_mult 와 같은 식이고, 엣지·상한은 get_rules() 값을 쓴다.
 *  카드는 균등 추첨이다(쏠림 없음). 난이도 보정은 확률이 아니라 배율에서 한다 —
 *  단계가 오를수록 엣지를 깎아 "계속 가는 쪽"이 유리하도록. */
export function hlMult(card: number, choice: HighLowChoice, stage: number): number {
  const { edge: edges, max_mult } = getRules().highlow;
  const winCards = hlWinCards(card, choice);
  if (winCards <= 0) return 0;
  const edge = edges[stage - 1] ?? 1;
  const raw = ((1 - edge) * 13) / winCards;
  // 부동소수 오차 보정 — 0.95*13/10 은 정확히 1.235지만 JS 이진 부동소수로는
  // 1.2349999... 가 되어 반올림이 아래로 내려간다. Postgres numeric(정확한
  // 십진 연산)과 결과가 어긋나지 않도록 아주 작은 값을 더해 경계를 바로잡는다.
  const rounded = Math.round((raw + Number.EPSILON) * 100) / 100;
  return Math.min(max_mult, rounded);
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
// 개수(range · picks · draws)와 배당표(mult)는 getRules().keno 에 있다.
// 다 맞힌 판 일부를 서버가 다시 뽑는 재추첨 규칙과 RTP 계산은
// supabase/migrations 의 play_game 주석과 docs 를 본다.

/** 적중 수별 배당. 1개 이하는 0. */
export function kenoMult(hits: number): number {
  return getRules().keno.mult[String(hits)] ?? 0;
}

/** 배당 레일용 — 높은 것부터 */
export function kenoTiers(): number[] {
  return Object.keys(getRules().keno.mult).map(Number).sort((a, b) => b - a);
}

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

/** 서버 app.hp_status 와 같은 구간을 쓴다 */
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
  // 서버 응답에 이 키가 빠져 있어도 동작하도록
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
    status_message: r.status_message,
    age: r.age,
    height_cm: r.height_cm,
    weight_kg: r.weight_kg,
    bio: r.bio,
    items: r.items,
    flex: r.flex,
  };
}

// 나눠 둔 모듈을 한곳에서 가져다 쓸 수 있게 다시 내보낸다.
export * from "./items";
export * from "./types";
export * from "./errors";
