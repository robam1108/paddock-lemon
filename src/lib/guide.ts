/**
 * 안내 — 서비스를 설명하는 정적 문서.
 *
 * copy.ts 의 상태 문구·rules.ts 의 규칙과 달리, 이건 상태에 따라 바뀌지
 * 않는다. 소개·장소·룸·일정 넷으로 고정한다.
 */

import { DISCLAIMER, SITE_NAME } from "./site";

export type GuideSectionId = "world" | "layout" | "rooms" | "schedule";

export type GuideSection = {
  id: GuideSectionId;
  label: string;
  /** width/height는 원본 픽셀 크기. aspect-ratio로 박아 로딩 전에도
   *  자리를 미리 잡아 이미지가 뜨면서 레이아웃이 밀리지 않게 한다. */
  photo?: { src: string; alt: string; width: number; height: number };
  /** 사진을 문단 위/아래 어디에 붙일지. 생략하면 "top"(기존 동작). */
  photoPosition?: "top" | "bottom";
  paragraphs: string[];
};

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "world",
    label: "소개",
    paragraphs: [
      SITE_NAME,
      "친구들끼리 즐기는 실시간 멀티플레이 가상 코인 게임입니다. 경마, 네 가지 Casual 게임, 1:1 Arena 대전, 개인 거래가 있습니다.",
      "모든 난수·판정·정산은 **서버에서만** 이루어집니다. 화면은 결과를 보여 줄 뿐이고, 결과를 바꿀 수 없습니다.",
      "코인은 게임 안에서만 쓰이는 포인트입니다. 미션과 탐험으로 모으고, 상점에서 아이템을 사거나 다른 플레이어와 거래할 수 있습니다.",
      `**${DISCLAIMER}.**`,
    ],
  },
  {
    id: "layout",
    label: "장소 안내",
    photo: {
      src: "/guide/layout.svg",
      alt: "장소 안내도",
      width: 1000,
      height: 1071,
    },
    paragraphs: [
      "¹ 라운지 - 플레이어들이 머무는 공용 공간. 탐험 장소 중 하나입니다.",
      "² 수돗가 - 공용 세면 공간. 탐험 장소 중 하나입니다.",
      "³ 식당 - 도시락이 지급되는 공간. 탐험 장소 중 하나입니다.",
      "⁴ 광장 (단체 채팅방) - 교류와 거래가 가장 활발한 곳입니다.",
      "⁵ 공방 - 일일 미션이 진행되는 공간. 미션은 오후 1시부터 7시까지 열립니다.",
      "⁶ 휴게실 - 에너지가 바닥나면 쉬어 가는 공간입니다.",
    ],
  },
  {
    id: "rooms",
    label: "룸 배치",
    // 이 탭만 아래에 실제 명단이 붙는다(GuidePopup). 문구는 그 앞머리다.
    paragraphs: [
      "3인 1룸. 매주 월요일 오전 6시에 전원이 무작위로 다시 배치됩니다.",
      "룸과 룸메이트는 직접 고를 수 없습니다.",
    ],
  },
  {
    id: "schedule",
    label: "일정",
    photo: { src: "/guide/schedule.svg", alt: "일정표", width: 1000, height: 1284 },
    photoPosition: "bottom",
    paragraphs: ["도시락 08:00 · 12:00 · 19:00 / 미션 13:00~19:00 / 경마 10:00 · 22:00 (KST)"],
  },
];
