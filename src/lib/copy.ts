/**
 * 화면 문구.
 *
 * 어투는 하나다: 짧고 중립적인 UI 문구(존댓말). 상태·판정은 한두 단어로,
 * 안내는 한 문장으로 쓴다. 승패에 과한 축하 연출은 두지 않는다.
 * 사이트 이름·고지 문구는 site.ts 에 있다.
 */

import {
  CARD_LABELS,
  formatDaysLeft,
  formatDuration,
  MIX_TO,
  ROAST_TO,
  type InventoryItem,
  type LaborResult,
  type PlayerState,
  CAT_FISH_CODES,
  type CatActResult,
  type SearchResult,
} from "./game";
import { INSTRUMENTS } from "./gear";
import { getRules } from "./server-rules";
import { LABOR_JOBS, SEARCH_FINDS, searchTier } from "./labor";

/* ── 공통 라벨 ─────────────────────────────────────────────── */

export const LABEL = {
  no: "번호",
  health: "에너지",
  coins: "보유 코인",
  ration: "오늘 남은 판",
  exit: "로그아웃",
  admin: "관리자",
  roster: "접속 중",
  bet: "베팅",
  stake: "건 코인",
  pot: "현재 적립금",
  mult: "배율",
  stage: "단계",
  current: "현재 카드",
  next: "다음 카드",
  rules: "규칙",
  feed: "실시간 결과",
  rank: "코인 순위",
  petitions: "피드백",
  guide: "안내",
} as const;

/** 피드백 안내 — 게임 판정 이의와는 다른 창구라는 것만 밝힌다. */
export const PETITION_NOTE =
  "게임 판정에 대한 이의는 받지 않습니다. 그 밖의 의견이나 문의를 남겨 주세요.";

/** 에너지 상태를 짧은 말로 */
export function healthNote(hp: number, max: number): string {
  if (hp <= 0) return "휴식 중";
  const ratio = hp / Math.max(1, max);
  if (ratio >= 0.8) return "좋음";
  if (ratio >= 0.4) return "보통";
  return "부족";
}

/** 프로필 비고 — 예외 사항만 적는다. 없으면 "없음". */
export function recordNotes(state: PlayerState): string {
  const notes: string[] = [];
  if (state.debt > 0) notes.push(`미상환 대출 ${state.debt} 코인`);
  if (state.suspended)
    notes.push(`이용 정지 (해제까지 ${formatDaysLeft(state.suspended_left)})`);
  if (state.in_ward)
    notes.push(`휴식 중 (종료까지 ${formatDuration(state.ward_left)})`);
  return notes.length > 0 ? notes.join(" · ") : "없음";
}

/* ── 게임 ──────────────────────────────────────────────────── */

export function highLowPrompt(card: number): string {
  return `다음 카드가 ${CARD_LABELS[card]}보다 높을지 · 낮을지 · 같을지 골라 주세요.`;
}

export const POT_WARNING =
  "한 번 틀리면 적립금이 모두 사라집니다. 원할 때 언제든 받을 수 있습니다.";

/** 판정 전, 카드를 뽑는 짧은 순간에만 뜨는 자리표시 문구 */
export const DEALING_NOTE = "뽑는 중";

export function stageNote(stage: number): string {
  if (stage <= 1) return "1단계. 배율은 고른 쪽의 적중률로 정해집니다 — 어려운 쪽일수록 큽니다.";
  if (stage === 2) return "2단계. 같은 확률이라도 배율이 조금 올라갑니다.";
  return "3단계. 배율이 가장 좋습니다.";
}

/** 판정 한 줄. 색이 아니라 단어가 결과를 말한다. */
export const VERDICT = {
  win: { word: "적중", note: "한 장 더 갈 수 있습니다." },
  lose: { word: "실패", note: "적립금이 사라졌습니다." },
  hold: { word: "계속", note: "여기서 받아도 됩니다." },
  cleared: { word: "완주", note: "3단계를 모두 통과했습니다." },
  cashout: { word: "수령", note: "적립금을 받았습니다." },
} as const;

/* ── 키노 ──────────────────────────────────────────────────── */

/** 추첨이 도는 동안. 하이로우의 DEALING_NOTE 와 같은 자리다. */
export const KENO_DRAWING_NOTE = "추첨 중";

/** 다섯을 다 고르기 전에는 판이 안 열린다. 버튼이 이 말을 대신 한다. */
export function kenoPickPrompt(left: number): string {
  return `${left}개 더 고르기`;
}

/** 판이 끝난 뒤 숫자판 아래 한 줄. */
export function kenoMatchLine(match: number): string {
  if (match === 0) return "맞힌 숫자가 없습니다.";
  if (match >= 5) return "다섯 개 모두 맞혔습니다.";
  return `${match}개 맞혔습니다.`;
}

/* ── 막힌 상태 ──────────────────────────────────────────────────
   배너를 따로 두지 않는다. 3버튼 자리를 이 한 줄로 갈아 끼우고
   화면 전체를 한 톤 죽인다.
   ────────────────────────────────────────────────────────────── */

export type Blocked = {
  why: "suspended" | "ward" | "quota" | "broke";
  line: string;
  sub: string;
};

export function blockedState(
  state: PlayerState,
  outOfPlays: boolean,
  broke: boolean,
): Blocked | null {
  if (state.suspended) {
    return {
      why: "suspended",
      line: "이용 정지 중입니다. 해제될 때까지 게임을 할 수 없습니다.",
      sub: `해제까지 ${formatDaysLeft(state.suspended_left)}${state.suspend_reason ? ` · 사유: ${state.suspend_reason}` : ""
        } · 문의는 피드백으로`,
    };
  }
  if (state.in_ward) {
    return {
      why: "ward",
      line: "휴식 중입니다. 휴식이 끝나면 다시 할 수 있습니다.",
      sub: `종료까지 ${formatDuration(state.ward_left)} · 종료 시 에너지 80`,
    };
  }
  if (outOfPlays) {
    return {
      why: "quota",
      line: "오늘 플레이 횟수를 모두 썼습니다. 자정(KST)에 다시 채워집니다.",
      sub: `오늘 남은 판 0/${state.play_limit} · Arena 대전은 횟수를 쓰지 않습니다`,
    };
  }
  if (broke) {
    return {
      why: "broke",
      line: "코인이 없습니다. 코인은 자동으로 충전되지 않습니다.",
      sub: "미션·탐험으로 코인을 모을 수 있습니다",
    };
  }
  return null;
}

/**
 * 미션·탐험은 게임이 아니라서 "게임을 할 수 없다"는 문구가 어색하다. 이 두
 * 화면은 항상 blockedState(state, false, false) 로만 부르므로 quota/broke
 * 는 여기 오지 않는다. sub(남은 시간)는 그대로 쓴다.
 */
export function nonGameBlockedLine(blocked: Blocked): string {
  if (blocked.why === "suspended") return "이용 정지 중입니다. 해제될 때까지 할 수 없습니다.";
  if (blocked.why === "ward") return "휴식 중입니다. 휴식이 끝나면 할 수 있습니다.";
  return blocked.line;
}

/* ── 기호를 글자로 ──────────────────────────────────────────────
   릴의 그림은 두 글자 코드로 찍는다(등폭 글꼴로 정렬을 맞추기 위해).
   ────────────────────────────────────────────────────────────── */

export const SLOT_CODE: Record<string, string> = {
  cherry: "CH",
  lemon: "LM",
  bell: "BL",
  star: "ST",
  seven: "07",
  diamond: "DM",
};

export const GAME_CODE: Record<string, string> = {
  roulette: "룰렛",
  slots: "슬롯",
  keno: "키노",
  highlow: "하이로우",
  dice: "주사위",
  indian: "인디언",
  blackjack: "블랙잭",
  race: "경마",
};

/* ── 일일 미션 · 탐험 ──────────────────────────────────────── */

/** 미션 결과. 왜 그만큼이었는지(band) 먼저, 실제 액수는 그 아래. */
export function laborLines(r: LaborResult): string[] {
  const lines = [
    (LABOR_JOBS[r.code]?.lines[r.band] ?? "미션을 마쳤습니다.").replace(
      "{who}",
      r.visitor ?? "누군가",
    ),
    `보상 ${r.pay}코인 · 에너지 -${r.hp_cut}`,
  ];
  if (r.item) {
    const where =
      r.code === "fishing" ? "그물에 걸린" : r.code === "pens" ? "목장 구석에서" : "밭 귀퉁이에서";
    lines.push(`${where} ${r.item.name}${eulReul(r.item.name)} 챙겼습니다.`);
  }
  return lines;
}

/** 탐험 결과. 장소 × 값어치로 고른 한 문장 먼저, 둘째 줄은 얻은 물건 또는 "빈손". */
export function searchLines(r: SearchResult): string[] {
  const tier = searchTier(r);
  return [
    SEARCH_FINDS[r.place]?.[tier] ?? "무언가를 찾았습니다.",
    r.item ? `${r.item.name} · 에너지 -${r.hp_cut}` : `빈손 · 에너지 -${r.hp_cut}`,
  ];
}

/* ── 탐험 고양이 ────────────────────────────────────────────── */
/* 고양이가 실제로 할 법한 자리·행동만 쓴다. 결과마다 문장을 몇 벌 두고 seed 로
   고른다 — seed 는 팝업이 열릴 때 한 번 정해(CatPopup · CatGiftPopup) 다시 그려도
   문장이 바뀌지 않는다. 모든 결과는 두 줄이다. */

/** 이름이 아직 없으면 그냥 "고양이". */
export function catName(name: string | null | undefined): string {
  return name?.trim() || "고양이";
}

/** 팝업이 열릴 때 한 번 뽑아 두는 문장 고르기 값. */
export function catSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function pick<T>(list: T[], seed: number): T {
  return list[seed % list.length];
}

type CatLine = (n: string, ga: string) => string;

/** 장소마다 고양이가 있는 자리. 첫 줄은 이 표에서만 나온다. 키는 서버 장소 코드다. */
const CAT_MEET: Record<string, CatLine[]> = {
  cell: [
    (n, ga) => `라운지 소파 한가운데 ${n}${ga} 앉아 있다.`,
    (n, ga) => `창가 쿠션 위에서 ${n}${ga} 동그랗게 몸을 말고 자고 있다.`,
  ],
  mess: [
    (n, ga) => `식당 뒷문 옆에서 ${n}${ga} 생선 냄새를 맡고 있다.`,
    (n, ga) => `테이블 밑에 엎드린 ${n}${ga} 떨어진 빵 부스러기를 살피고 있다.`,
  ],
  shower: [
    (n, ga) => `수돗가 옆에 웅크린 ${n}${ga} 고인 물을 핥고 있다.`,
    (n, ga) => `수건 선반 밑 마른 자리에서 ${n}${ga} 앞발로 세수하고 있다.`,
  ],
  works: [
    (n, ga) => `공방 선반 위에 ${n}${ga} 길게 엎드려 있다.`,
    (n, ga) => `톱밥 더미 위에서 ${n}${ga} 뒹굴다 이쪽을 돌아봤다.`,
  ],
  infirm: [
    (n, ga) => `휴게실 라디에이터 위에서 ${n}${ga} 몸을 말고 졸고 있다.`,
    (n, ga) => `빈 소파 담요 위에서 ${n}${ga} 꾹꾹이를 하고 있다.`,
  ],
};

const CAT_MEET_TAIL = [
  "꼬리를 살랑이며 이쪽을 빤히 본다",
  "귀를 쫑긋 세우고 눈을 동그랗게 떴다",
  "이쪽을 보더니 '냥' 하고 짧게 울었다",
];

/** 고양이 자리를 골랐을 때 팝업 첫 화면. */
export function catMeetLines(
  place: string,
  name: string | null,
  hpCut: number,
  seed: number,
): string[] {
  const n = catName(name);
  const first = pick(CAT_MEET[place] ?? CAT_MEET.cell, seed);
  const tail = pick(CAT_MEET_TAIL, seed >> 3);
  return [first(n, iGa(n)), hpCut > 0 ? `${tail} · 에너지 -${hpCut}` : tail];
}

const CAT_FED: CatLine[] = [
  (n, ga) => `${n}${ga} 츄르를 할짝할짝 핥더니 행복한 듯 눈을 가늘게 떴다.`,
  (n, ga) => `봉지를 뜯자마자 ${n}${ga} 달려와 츄르를 정신없이 핥아 먹었다.`,
  (n, ga) => `${n}${ga} 마지막 한 방울까지 핥아 먹고 입맛을 쩝쩝 다셨다.`,
];
/** 생선을 줬을 때. 세 번째 인자는 생선 이름(고등어 · 전갱이). */
const CAT_FED_FISH: ((n: string, ga: string, fish: string) => string)[] = [
  (n, ga, fish) => `${n}${ga} ${fish}${eulReul(fish)} 덥석 물고 구석으로 가서 뼈만 남기고 먹었다.`,
  (n, ga, fish) => `${fish} 냄새에 ${n}${ga} 눈을 반짝이며 달려와 허겁지겁 뜯어 먹었다.`,
  (n, ga, fish) => `${n}${ga} 앞발로 ${fish}${eulReul(fish)} 꾹 누르고 머리부터 오독오독 씹어 먹었다.`,
];
/** 우유를 줬을 때. */
const CAT_FED_MILK: CatLine[] = [
  (n, ga) => `${n}${ga} 우유에 코를 박고 할짝할짝 바닥이 보일 때까지 핥았다.`,
  (n, ga) => `우유 냄새에 ${n}${ga} 꼬리를 세우고 달려와 수염을 적시며 마셨다.`,
  (n, ga) => `${n}${ga} 우유를 다 마시고 입가를 혀로 한참 닦았다.`,
];
const CAT_NO_SNACK: CatLine[] = [
  () => "주머니를 뒤졌지만 간식이 없다.",
  () => "츄르를 꺼내려 했는데 주머니가 비어 있다.",
];
const CAT_NO_SNACK_TAIL: CatLine[] = [
  (n, ga) => `실망한 ${n}${ga} 꼬리를 탁 치고 가 버렸다.`,
  (n, ga) => `빈손을 킁킁 맡아 본 ${n}${ga} 고개를 돌리고 가 버렸다.`,
];
const CAT_SHY: CatLine[] = [
  (n, ga) => `손을 뻗자 ${n}${ga} 털을 바짝 세웠다.`,
  (n, ga) => `가까이 다가가자 ${n}${ga} 귀를 뒤로 납작하게 젖혔다.`,
];
const CAT_SHY_TAIL = [
  "아직 친하지 않다. 하악질을 하고 도망갔다",
  "아직 친하지 않다. 순식간에 달아나 버렸다",
];
const CAT_PETTED: CatLine[] = [
  (n, ga) => `${n}${ga} 손바닥에 머리를 비비며 골골거린다.`,
  (n, ga) => `턱 밑을 긁어 주자 ${n}${ga} 눈을 감고 골골 소리를 냈다.`,
  (n, ga) => `등을 쓰다듬자 ${n}${ga} 꼬리를 바짝 세우고 다리에 몸을 비볐다.`,
];
const CAT_PETTED_TAIL = [
  "배를 보이고 발라당 누웠다",
  "앞발로 꾹꾹이를 하며 한참을 곁에 머물렀다",
  "느릿하게 눈을 깜빡였다. 고양이식 인사다",
];

/** 간식주기 · 쓰다듬기 결과. 첫 줄은 장면, 둘째 줄은 반응과 친밀도. */
export function catActLines(r: CatActResult, seed: number): string[] {
  const n = catName(r.cat_name);
  const ga = iGa(n);
  // 넘친 친밀도는 보여 주지 않는다 — 다 찼으면 need/need.
  const friend = `친밀도 ${Math.min(r.churu_given, r.need)}/${r.need}`;
  const fish = r.snack && CAT_FISH_CODES.has(r.snack) ? (r.snack_name ?? "생선") : null;
  switch (r.outcome) {
    case "no_snack":
      return [pick(CAT_NO_SNACK, seed)(n, ga), pick(CAT_NO_SNACK_TAIL, seed >> 3)(n, ga)];
    case "shy":
      return [pick(CAT_SHY, seed)(n, ga), `${pick(CAT_SHY_TAIL, seed >> 3)} · ${friend}`];
    case "fed":
      return [
        r.snack === "milk"
          ? pick(CAT_FED_MILK, seed)(n, ga)
          : fish
            ? pick(CAT_FED_FISH, seed)(n, ga, fish)
            : pick(CAT_FED, seed)(n, ga),
        r.churu_given < r.need
          ? `${friend} · 경계를 풀고 조금 가까이 와서 앉았다`
          : r.cat_name
            ? "기분이 좋은지 꼬리를 바짝 세웠다"
            : "골골 소리가 여기까지 들린다. 이제 만져도 될 것 같다",
      ];
    case "petted":
      return [
        pick(CAT_PETTED, seed)(n, ga),
        r.can_name
          ? "마음을 열어 주었다. 부를 이름을 지어 주자."
          : pick(CAT_PETTED_TAIL, seed >> 3),
      ];
  }
}

/** 이름을 정한 직후. */
export function catNamedLines(name: string): string[] {
  return [
    `이제부터 이 고양이의 이름은 ${name}.`,
    `${name}${iGa(name)} 대답하듯 '냥' 하고 울었다.`,
  ];
}

/** 소지품 탭에 선물이 도착했을 때. */
export function catGiftLines(name: string | null, itemName: string, seed: number): string[] {
  const n = catName(name);
  return [
    `${n}${iGa(n)} ${itemName}${eulReul(itemName)} 물어다 발밑에 내려놓았다.`,
    pick(
      [
        "칭찬해 달라는 듯 올려다본다.",
        "꼬리를 세우고 자랑스럽게 앉아 있다.",
        "앞발로 툭툭 밀어 이쪽으로 보낸다.",
      ],
      seed,
    ),
  ];
}

/** 선물을 받거나 돌려준 뒤. */
export function catGiftResolvedLines(name: string | null, itemName: string, kept: boolean): string[] {
  const n = catName(name);
  return kept
    ? [`${itemName}${eulReul(itemName)} 소지품에 넣었다.`, `${n}${iGa(n)} 뿌듯한 듯 꼬리를 흔든다.`]
    : [
        `${itemName}${eulReul(itemName)} 정중히 돌려주었다.`,
        `${n}${iGa(n)} 조금 서운한 듯 등을 돌리고 가 버렸다.`,
      ];
}

/** 선물을 가장 많이 가진 사람의 프로필 맨 아래 줄(public.cat_favorite). */
export const CAT_FAVORITE_LINE = "떠돌이 고양이에게 가장 사랑받는다.";

/** 소지품에서 몰래 정리한 뒤. */
export function catTossLines(name: string | null, itemName: string, seed: number): string[] {
  const n = catName(name);
  return [
    pick(
      [
        `아무도 모르게 ${itemName}${eulReul(itemName)} 정리했다.`,
        `주위를 살핀 뒤 ${itemName}${eulReul(itemName)} 상자 깊숙이 넣어 두었다.`,
      ],
      seed,
    ),
    `${n}${iGa(n)} 눈치채지 못한 것 같다.`,
  ];
}

/**
 * 선물 사용 팝업(쓰기 전). 두 줄의 묘사만 — 효과는 쓴 뒤(catGiftUsedLines)에 알려 준다.
 * 코드: feather = 깃털, toy_mouse = 장난감 쥐, butterfly = 나비.
 */
export function catGiftUseInfo(code: string, name: string | null): { lines: string[] } {
  const n = catName(name);
  switch (code) {
    case "feather":
      return {
        lines: ["작은 깃털이 아직 바람결을 기억하고 있다.", `${n}${iGa(n)} 하늘에서 떨어진 운을 물어 왔다.`],
      };
    case "toy_mouse":
      return {
        lines: ["실밥이 풀린 장난감 쥐다. 여기저기 끌고 다닌 흔적이 있다.", `${n}${iGa(n)} 숨은 물건을 찾는 법을 알려 주려는 것 같다.`],
      };
    default:
      return {
        lines: ["손등에 내려앉은 나비가 날개를 천천히 접었다 편다.", `${n}${iGa(n)} 부지런함을 물어다 놓았다.`],
      };
  }
}

/** 선물 효과가 아직 남아 있어 다시 쓸 수 없을 때 사용 팝업에 붙는 줄. */
export const CAT_GIFT_ACTIVE_LINE = "앞서 쓴 선물의 효과가 아직 남아 있다.";

/** 선물을 쓴 뒤. */
export function catGiftUsedLines(code: string): string[] {
  switch (code) {
    case "feather":
      return ["깃털을 가슴께에 꽂았다. 판 위에 바람이 분다.", `앞으로 ${getRules().cat.bird_plays}판, 판돈 +${getRules().cat.bird_stake}`];
    case "toy_mouse":
      return ["장난감 쥐를 주머니에 넣었다. 눈이 밝아진 것 같다.", "다음 탐험 한 번, 좋은 물건이 나올 확률이 오른다"];
    default:
      return ["나비를 날려 보내고 잠시 바라봤다. 어깨에 힘이 들어간다.", "다음 미션 한 번, 보상이 후해진다"];
  }
}

/* ── 결과 표기 ──────────────────────────────────────────────── */

/** 판이 끝난 뒤 남기는 한 줄. */
export function settleLine(net: number, payout: number): string {
  if (net > 0) return `${payout} 코인 수령 · 순이익 +${net}`;
  if (net < 0) return `${-net} 코인 손실`;
  return "본전. 건 코인을 그대로 돌려받았습니다.";
}

/** "HH:MM" (기기 시각) */
export function clockText(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 네잎클로버 등이 이 판 판돈에 얹혔을 때 결과줄 뒤에 붙는 꼬리. 안 얹혔으면 빈 문자열. */
export function bonusTail(bonus: number | undefined, luckEndsAt: string | undefined): string {
  if (!bonus) return "";
  if (luckEndsAt) return ` · 클로버 +${bonus} (${clockText(luckEndsAt)}까지)`;
  return ` · 판돈 +${bonus}`;
}

/* ── 소지품 사용 ────────────────────────────────────────────── */

/** 목적격 조사. 끝 글자에 받침이 있으면 "을", 없으면 "를". 한글로 안 끝나면 "을(를)". */
export function eulReul(word: string): string {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? "을" : "를";
  return "을(를)";
}

/** 공동격 조사. 끝 글자에 받침이 있으면 "과", 없으면 "와". 한글로 안 끝나면 "와(과)". */
export function waGwa(word: string): string {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? "과" : "와";
  return "와(과)";
}

export type UsedVia =
  | "use"
  | "flex_use"
  | "flex_equip"
  | "flex_unequip"
  | "together"
  | "gear_on"
  | "gear_off"
  | "roast"
  | "mix";

/**
 * 소지품에서 쓰거나 착용한 뒤 팝업에 띄울 문장. before 는 누르기 직전 상태,
 * after 는 RPC 응답이다. lines 는 무엇을 했고 수치가 어떻게 바뀌었는지,
 * notes 는 이번에 붙은 프로필 표시 문구다.
 */
export function usedItemLines(
  item: InventoryItem,
  via: UsedVia,
  before: PlayerState,
  after: PlayerState,
): { lines: string[]; notes: string[] } {
  const obj = `${item.name}${eulReul(item.name)}`;
  // use_item 은 서버가 효과 직전 에너지(hp_before)를 준다 — 그 사이 자연 감소가 끼어도 맞는다.
  const hpFrom = via === "use" || via === "together" ? (after.hp_before ?? before.hp) : before.hp;
  const hpTo = after.hp;
  const healed = hpTo > hpFrom;
  const gained = after.plays_gained ?? 0;

  let head: string;
  if (via === "flex_equip") head = `${obj} 장착했습니다.`;
  else if (via === "flex_unequip") head = `${obj} 해제했습니다.`;
  else if (via === "gear_on")
    head = INSTRUMENTS.has(item.code) ? `${obj} 꺼내 연주를 시작했습니다.` : `${obj} 들고 운동을 시작했습니다.`;
  else if (via === "gear_off")
    head = INSTRUMENTS.has(item.code) ? `${obj} 내려놓았습니다.` : `${obj} 내려놓고 운동을 마쳤습니다.`;
  else if (via === "roast") {
    const roasted = after.items.find((i) => i.code === ROAST_TO[item.code])?.name;
    head = roasted ? `${obj} 구워 ${roasted}${eulReul(roasted)} 만들었습니다.` : `${obj} 구웠습니다.`;
  }
  else if (via === "mix") {
    // item 은 우유에 섞은 음료(커피 등) 쪽이다.
    const mixed = after.items.find((i) => i.code === MIX_TO[item.code])?.name;
    head = mixed
      ? `우유에 ${obj} 섞어 ${mixed}${eulReul(mixed)} 만들었습니다.`
      : `우유에 ${obj} 섞었습니다.`;
  }
  else if (item.kind === "food" || item.kind === "treat")
    head = healed ? `${obj} 먹고 기운이 났습니다.` : `${obj} 먹었습니다.`;
  else if (item.kind === "medicine") {
    if (item.ward_cut > 0) head = `${obj} 써서 휴식 시간이 줄었습니다.`;
    else if (healed) head = `${obj} 써서 에너지가 회복됐습니다.`;
    else head = `${obj} 썼습니다.`;
  } else head = `${obj} 사용했습니다.`;

  const lines = [head];
  if (via === "gear_on") lines.push("1시간 동안 이어집니다.");
  if (via === "together" && after.with)
    lines.push(
      `${after.with}${waGwa(after.with)} 함께 ${
        item.kind === "liquor" ? "마셨습니다" : item.kind === "food" ? "나눠 먹었습니다" : "했습니다"
      }.`,
    );
  if (via === "together" && after.with && (after.mate_heal || after.mate_plays)) {
    const got: string[] = [];
    if (after.mate_heal) got.push(`에너지 +${after.mate_heal}`);
    if (after.mate_plays) got.push(`게임 횟수 +${after.mate_plays}`);
    lines.push(`${after.with}도 ${got.join(" · ")}`);
  }
  if (hpTo !== hpFrom) lines.push(`에너지 ${hpFrom} → ${hpTo}`);
  if (gained > 0) lines.push(`게임 횟수 ${after.plays_left - gained} → ${after.plays_left}`);
  if (item.ward_cut > 0 && before.in_ward) {
    lines.push(
      after.in_ward
        ? `휴식 남은 시간 ${formatDuration(before.ward_left)} → ${formatDuration(after.ward_left)}`
        : "휴식이 끝났습니다.",
    );
  }
  if (item.win_double > 0) lines.push(`다음 승리 판돈 2배 · 남은 ${after.win_double}회`);
  if (item.kind === "charm") lines.push(`판돈 +${getRules().clover_stake} · ${item.flex_hours ?? 6}시간`);
  if (via === "flex_equip" || via === "flex_unequip") {
    // 겹쳐 장착한 것은 state_json 이 그 수만큼 줄을 펼쳐 보내므로 줄 수가 곧 칸 수다.
    const worn = (after.flex ?? []).filter((f) => f.expires_at === null).length;
    lines.push(`장착 ${worn}${after.wear_limit ? ` / ${after.wear_limit}` : ""}`);
  }

  const notes: string[] = [];
  const flex =
    via === "flex_unequip" || via === "gear_off" || via === "roast" || via === "mix"
      ? undefined
      : after.flex?.find((f) => f.code === item.code)?.text;
  if (flex) notes.push(flex);

  return { lines, notes };
}

/* ── 경마 쪽 ──────────────────────────────────────────────── */

/** 받침 있으면 "이", 없으면 "가". 한글로 안 끝나면 "이(가)". */
export function iGa(word: string): string {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? "이" : "가";
  return "이(가)";
}

/**
 * 인사이더 팁. 컨디션 단계(0 최상 ~ 4 최악)마다 말투를 몇 벌 두고,
 * 경주·게이트로 하나를 고른다 — 같은 소식은 다시 켜도 같은 기사로 나온다.
 * 기사는 참이다. 다만 신문답게 돌려 말한다.
 */
const RACE_NEWS: ((n: string, g: number) => [string, string])[][] = [
  [
    (n, g) => [`[단독] ${g}번 '${n}', 새벽 조교서 시즌 최고 타임`, `관계자는 "몸이 가볍다. 이번엔 해볼 만하다"며 자신감을 숨기지 않았다.`],
    (n) => [`${n}, 컨디션 절정… 마방 관계자 "근래 들어 최고"`, `사료를 한 톨도 남기지 않았고, 조교 내내 기수가 고삐를 당겨야 할 만큼 의욕이 넘쳤다는 후문이다.`],
    (n) => [`'${n}' 진영, 이례적인 낙관론`, `평소 말을 아끼던 조교사가 "오늘은 걱정할 게 없다"고 짧게 말했다.`],
  ],
  [
    (n) => [`${n}, 순조로운 조교… "평소보다 반 박자 빠르다"`, `큰 이상 없이 마지막 점검을 마쳤다. 발걸음이 가볍다는 평이다.`],
    (n, g) => [`${g}번 ${n}, 상승세 감지`, `최근 훈련에서 꾸준히 좋은 타임을 내고 있다는 소식이다.`],
    (n) => [`${n} 기수 "말이 먼저 가려고 한다"`, `전담 기수가 조교 뒤 만족스러운 표정이었다고 현장 관계자가 전했다.`],
  ],
  [
    (n) => [`${n}, 특이사항 없음… "평소대로"`, `마방 측은 "늘 하던 대로 준비했다"는 원론적인 입장만 밝혔다.`],
    (n, g) => [`${g}번 ${n}, 무난한 최종 점검`, `좋지도 나쁘지도 않다는 것이 현장의 대체적인 평가다.`],
    (n) => [`'${n}' 조교 타임 평이`, `기록상 눈에 띄는 변화는 없었다.`],
  ],
  [
    (n) => [`${n}, 조교 중 집중력 저하 기색`, `몇 차례 고개를 젓는 모습이 포착됐다. 관계자는 "큰 문제는 아니다"라며 말을 아꼈다.`],
    (n, g) => [`${g}번 ${n} 진영, 표정 어두워`, `최근 사료를 남기는 날이 늘었다는 이야기가 마방 주변에서 흘러나온다.`],
    (n) => [`${n}, 컨디션 난조설… 관계자 "지켜봐야"`, `마지막 조교를 예정보다 일찍 끝낸 것으로 알려졌다.`],
  ],
  [
    (n, g) => [`${g}번 '${n}', 조교 중 왼 앞다리 불편 기색… 출전 강행 주목`, `수의사가 오전 내내 마방에 머문 것으로 전해졌다. 진영은 "출전에는 지장 없다"는 입장이다.`],
    (n) => [`${n}, 밤새 마방 소란… 컨디션 최악설`, `잠을 설쳤다는 목격담이 나왔다. 관계자는 답변을 피했다.`],
    (n) => [`[속보] ${n} 진영 "솔직히 어렵다"`, `조교사가 사석에서 "이번엔 기대하지 말라"고 털어놓았다는 전언이다.`],
  ],
];

export function raceNews(raceId: number, gate: number, name: string, level: number): [string, string] {
  const pool = RACE_NEWS[Math.min(4, Math.max(0, level))];
  return pool[(raceId * 7 + gate * 3) % pool.length](name, gate);
}

/** 인사이더 팁이 아직 소식을 못 받았을 때 */
export const RACE_NEWS_EMPTY = "오늘은 더 전할 소식이 없습니다. 이상, Paddock 경마 소식이었습니다.";
export const RACE_NEWS_NONE = "편성된 경주가 없습니다. 다음 출전표가 나오면 다시 전해 드리겠습니다.";

/**
 * 중계 자막. 구간(10개)마다 그 시점 순위를 보고 한 줄씩 만든다.
 * names[gate-1] = 마명. splits 는 게이트별 누적 타임.
 * 돌려주는 at 은 경주 시각(초) — 선두가 그 구간을 지나는 순간.
 */
export function raceCalls(
  splits: number[][],
  names: string[],
  distance: number,
): { at: number; text: string }[] {
  const n = splits.length;
  const orderAt = (k: number) =>
    Array.from({ length: n }, (_, i) => i).sort((a, b) => splits[a][k] - splits[b][k]);
  const tag = (i: number) => `${i + 1}번 ${names[i]}`;
  const lenGap = (k: number, a: number, b: number) =>
    ((splits[b][k] - splits[a][k]) * distance) / splits[a][9] / 2.4;

  const out: { at: number; text: string }[] = [{ at: 0, text: "출발했습니다!" }];
  let prev = orderAt(0);
  out.push({ at: splits[prev[0]][0], text: `${tag(prev[0])}, 좋은 출발로 앞으로 나섭니다.` });

  for (let k = 2; k <= 8; k += 2) {
    const ord = orderAt(k);
    const at = splits[ord[0]][k];
    const left = Math.round(distance - (distance / 10) * (k + 1));
    let text: string;
    if (ord[0] !== prev[0]) {
      text = `선두가 바뀝니다! ${tag(ord[0])}${iGa(names[ord[0]])} 앞으로!`;
    } else {
      // 가장 많이 올라온 말
      let best = -1;
      let gain = 0;
      for (let i = 0; i < n; i++) {
        const d = prev.indexOf(i) - ord.indexOf(i);
        if (d > gain) {
          gain = d;
          best = i;
        }
      }
      if (k >= 6 && best >= 0 && gain >= 2) {
        text = `${tag(best)}, 바깥쪽에서 무섭게 치고 올라옵니다!`;
      } else {
        const g = lenGap(k, ord[0], ord[1]);
        text =
          g < 0.5
            ? `${names[ord[0]]}${waGwa(names[ord[0]])} ${names[ord[1]]}, 나란히! 접전입니다.`
            : `${names[ord[0]]} 여전히 선두, ${names[ord[1]]}${iGa(names[ord[1]])} ${Math.max(1, Math.round(g))}마신 차로 따라붙습니다.`;
      }
    }
    if (k === 6) text = `마지막 코너! ${text}`;
    out.push({ at, text: left > 0 && k === 8 ? `결승까지 ${left}m. ${text}` : text });
    prev = ord;
  }

  const fin = orderAt(9);
  const g = lenGap(9, fin[0], fin[1]);
  out.push({
    at: splits[fin[0]][9],
    text:
      g < 0.2
        ? `${names[fin[0]]}, ${names[fin[1]]} 거의 동시에 들어옵니다! 사진 판정!`
        : `${tag(fin[0])}, 1위로 결승선 통과!`,
  });
  return out;
}

