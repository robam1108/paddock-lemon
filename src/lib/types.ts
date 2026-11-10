// 서버 RPC 응답 타입 (일일 미션 · 탐험 · 고양이 · 플레이어 상태 · 관리자 · 피드백).

import type { FlexStatus, InventoryItem, ItemGrade, LuckEffect } from "./items";
import type { HighLowStep, HpStatus, TradeItem, TradeStatus } from "./game";

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

/** cat_test() 동작. 서버 public.cat_test 와 같다. */
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
// 코드값은 서버 카탈로그(seed.sql)와 같다.
export const CAT_GIFT_CODES = new Set(["feather", "toy_mouse", "butterfly"]);

/** 소지품 탭이 cat_gifts_pending() 으로 받는 값 */
export type CatStatus = {
  /** 내가 지은 고양이 이름. 아직 없으면 null */
  cat_name: string | null;
  gifts: CatGift[];
  /** 깃털이 판돈을 얹어 줄 남은 판 수 */
  bless_left: number;
  /** 장난감 쥐 — 다음 탐험을 기다리는 중 */
  search_ready: boolean;
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
  status_message: string | null;
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
