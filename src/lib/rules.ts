/**
 * 게임 규칙 요약. 사이드 패널에 번호를 붙여 항상 펼쳐 둔다.
 * 수치는 서버가 내려준 state 값을 그대로 쓴다.
 */

import type { PlayerState } from "./game";
import { canSeeRace } from "./race";

export type Rule = {
  /** "01" ~ "0n". 조건부 항목이 붙어도 번호는 이어서 매긴다. */
  no: string;
  text: string;
  /** 나에게만 해당하는 항목. 강조가 아니라 구분만 한다. */
  personal?: boolean;
};

export function gameRules(state: PlayerState): Rule[] {
  // 보상 → 한도 → 갱신 → 자산 순으로 앞에 두고, 판정 이의 불가 조항만은
  // 개인 항목 뒤 맨 끝에 오도록 따로 붙인다.
  const base: { text: string; personal?: boolean }[] = [
    {
      text: "Casual 게임은 참여할 때마다 판돈의 절반만큼(상한 있음) 참가 보상을 받습니다. 승패와는 별개입니다.",
    },
    { text: `Casual 게임은 모두 합쳐 하루 ${state.play_limit}판까지 할 수 있습니다.` },
    { text: "Arena 대전은 플레이 횟수를 쓰지 않습니다." },
    // 경마장은 정식 오픈 전까지 시험 계정에게만 보인다.
    ...(canSeeRace(state)
      ? [
          {
            text:
              "경마는 하루 2회(10시·22시 KST) 출발하며, 베팅은 출발 시각에 마감됩니다. " +
              "결과는 출발 후 공개되고 플레이 횟수·에너지를 쓰지 않습니다.",
          },
        ]
      : []),
    { text: "플레이 횟수는 매일 00시(KST)에 초기화됩니다." },
    {
      text: "일일 미션은 13시부터 19시(KST)까지 하루 2회, 미션 사이에 2시간 간격을 둡니다.",
    },
    { text: "탐험은 하루 1회입니다." },
    { text: "미션과 탐험에는 에너지가 듭니다. 보상은 끝난 뒤 정해집니다." },
    {
      text:
        `아이템으로 되살리는 게임 횟수는 하루 ${state.extra_max}회까지입니다.` +
        (state.extra_plays > 0 ? ` (오늘 ${state.extra_plays}회 사용)` : ""),
    },
    { text: "코인은 자동으로 충전되지 않습니다." },
    { text: "일부 아이템은 사용하거나 장착하면 프로필에 표시됩니다." },
  ];

  const personal: { text: string; personal?: boolean }[] = [];
  if (state.win_double > 0) {
    personal.push({
      text: `다음 승리 판돈 2배가 ${state.win_double}회 남아 있습니다.`,
      personal: true,
    });
  }
  if (state.debt > 0) {
    personal.push({
      text: `미상환 대출 ${state.debt} 코인이 있습니다.`,
      personal: true,
    });
  }

  const lines = [
    ...base,
    ...personal,
    { text: "모든 결과는 서버에서 결정되며 판정에 대한 이의는 받지 않습니다." },
  ];

  return lines.map((l, i) => ({
    no: String(i + 1).padStart(2, "0"),
    text: l.text,
    personal: l.personal,
  }));
}
