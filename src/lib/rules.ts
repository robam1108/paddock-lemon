/**
 * 서식 K-77 부칙.
 *
 * 시설이 붙인 공문이다. 수감자에게 설명하려고 쓴 문장이 아니라 통보하려고 쓴
 * 문장이라, 주어가 없고 존댓말도 없다. 도박판 쪽 문구(게임 안내·판정)와는
 * 어투가 분명히 갈라져야 한다 — 그건 copy.ts 에 있다.
 */

import type { PlayerState } from "./game";
import { canSeeRace } from "./race";

export type Rule = {
  /** "01" ~ "0n". 조건부 항목이 붙어도 번호는 이어서 매긴다. */
  no: string;
  text: string;
  /** 나에게만 해당하는 항목. 손으로 덧붙인 것처럼 강조가 아니라 구분만 한다. */
  personal?: boolean;
};

export function facilityRules(state: PlayerState): Rule[] {
  // 작업 정의 → 보수 → 한도 → 갱신 → 자산 순으로 앞에 두고, 이의 불가
  // 조항만은 개인 항목 뒤 맨 끝에 오도록 따로 붙인다.
  const base: { text: string; personal?: boolean }[] = [
    {
      text:
        "게임 참여는 수형자 간 질서 유지 및 시설 내 자율경제 활동에 기여하는 작업으로 " +
        "간주하며, 참여자에게 일당을 지급한다.",
    },
    {
      text: "일당은 해당 작업의 참여도에 따라 산정되며, 게임의 승패 및 손익과는 별개로 지급한다.",
    },
    { text: `백색구역 게임은 모두 합쳐 1일 ${state.play_limit}판으로 제한한다.` },
    { text: "흑색구역 대전은 배정 횟수에 산입하지 않는다." },
    // 경마장은 정식 오픈 전까지 시험 계정에게만 보인다.
    ...(canSeeRace(state)
      ? [
          {
            text:
              "경마는 1일 2회(10시·22시 KST) 발주하며, 마권 발매는 발주 시각에 마감한다. " +
              "결과는 발주 후 공시하고 배정 횟수·체력을 소모하지 않는다.",
          },
        ]
      : []),
    { text: "배정 횟수는 매일 00시(KST)에 초기화한다." },
    {
      text:
        "구내작업은 한국 시간 13시부터 19시까지 시행하며, 1일 2회로 제한하고 " +
        "작업 간 2시간의 간격을 둔다.",
    },
    { text: "시설 내 탐색은 1일 1회로 제한한다." },
    { text: "작업 및 시설 내 이동에는 체력을 소모한다. 보수는 작업 종료 후 산정한다." },
    {
      text:
        `아이템에 의한 게임 횟수 회복은 식량·의약품·약물을 합쳐 1일 ${state.extra_max}회까지 허용한다.` +
        (state.extra_plays > 0 ? ` (금일 ${state.extra_plays}회 사용)` : ""),
    },
    { text: "코인은 자동 충전되지 않는다." },
    { text: "일부 소지품은 사용 또는 착용 시 그 상태가 타인에게 노출된다." },
  ];

  const personal: { text: string; personal?: boolean }[] = [];
  if (state.win_double > 0) {
    personal.push({
      text: `다음 승리 판돈 2배 ${state.win_double}회가 남아 있다.`,
      personal: true,
    });
  }
  if (state.debt > 0) {
    personal.push({
      text: `미상환 채무 ${state.debt} 코인이 기록되어 있다.`,
      personal: true,
    });
  }
  // 중독·금단 같은 건강 상태는 부칙이 아니라 수감기록 › 신상의 체력 관리 지침에 적는다.

  const lines = [
    ...base,
    ...personal,
    { text: "모든 결과는 단말 서버에서 결정하며 이의를 접수하지 않는다." },
  ];

  return lines.map((l, i) => ({
    no: String(i + 1).padStart(2, "0"),
    text: l.text,
    personal: l.personal,
  }));
}
