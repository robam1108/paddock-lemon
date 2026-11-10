// 탐험 고양이 화면 문구.

import { CAT_FISH_CODES, type CatActResult } from "./game";
import { eulReul, iGa } from "./josa";
import { getRules } from "./server-rules";

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
