/* 프로필 구역 공통 — 응답 타입, 탭 목록, 버튼 클래스, 기록 줄 도우미. */

import {
  ADMIN_REASON_LABEL,
  CARD_LABELS,
  type HighLowStep,
  rouletteChoiceLabel,
  SLOT_EMOJI,
  type SlotSymbol,
  slotTripleMult,
} from "@/lib/game";
import { VERDICT } from "@/lib/copy";

export type RelationEntry = {
  id: number;
  username: string;
  partner: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reject_reason: string | null;
  mine: boolean;
  kind: "user";
  expires_in: number | null;
};

/** 프로필 "친구" 칸이 쓰는 축약형 — 승인된 관계만, 상대 이름 기준으로 정리한다. */
export type RelationRow = { id: number; other: string; body: string };

export function approvedRelationsFor(
  username: string,
  all: RelationEntry[],
): RelationRow[] {
  return all
    .filter(
      (r) =>
        r.status === "approved" &&
        (r.username === username || r.partner === username),
    )
    .map((r) => ({
      id: r.id,
      other: r.username === username ? r.partner : r.username,
      body: r.body,
    }));
}

/** 플레이어 명단 한 줄 — 친구 탭 목록과 그 아래 상세 보기가 공유한다. */
export type RosterEntry = {
  username: string;
  avatar_path: string | null;
  hp: number;
  hp_max: number;
  in_ward: boolean;
  status_message: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  bio: string | null;
  /** 문장만 담긴 배열. 만료 시각·아이템 코드는 절대 안 온다(본인 것만 state.flex 에 있다) */
  flex: string[];
};

export type Tab = "profile" | "items" | "roster" | "history";
/** 친구 탭 안의 하위 카테고리 — 친구 피드 · 플레이어 목록. */
export type RosterSub = "relations" | "list";

export const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "내 정보" },
  { id: "items", label: "소지품" },
  { id: "roster", label: "친구" },
  { id: "history", label: "기록" },
];

export const ROSTER_SUBS: { id: RosterSub; label: string }[] = [
  { id: "relations", label: "친구 피드" },
  { id: "list", label: "플레이어 목록" },
];

export const inputField =
  "mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line w-full min-w-0 border px-3 py-2.5 outline-none";
export const smallAction =
  "label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

export const action =
  "label-11 state-fade border-line border bg-surface-hi px-3 py-2.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

/** 기록 목록에서 제목을 줄여 쓴다. "하이로우 사다리" → "하이로우". */
export function gameTitle(title: string): string {
  return title === "하이로우 사다리" ? "하이로우" : title;
}

/**
 * 관리자가 주거나 거둔 줄의 둘째 줄 — "[이벤트] 주말 보너스".
 * 분류도 메모도 없으면(SQL Editor 에서 사유 없이 부른 경우) 아무것도 적지 않는다.
 */
export function adminLine(detail: Record<string, unknown>): string | null {
  const category = detail?.category as string | undefined;
  const note = (detail?.note as string | undefined)?.trim();
  const tag = category ? `[${ADMIN_REASON_LABEL[category] ?? category}]` : null;
  if (tag && note) return `${tag} ${note}`;
  return tag ?? note ?? null;
}

/**
 * 기록 목록 둘째 줄 — "판돈 → 결과"를 게임별로 한 줄 요약한다.
 * 배당 배수는 슬롯 세 칸 일치일 때만 붙인다. 나머지는 배수를 적지 않는다.
 */
export function gameLine(title: string, detail: Record<string, unknown>): string | null {
  const outcome = detail?.outcome as Record<string, unknown> | undefined;
  const bet = detail?.bet as number | undefined;
  if (!outcome || bet == null) return null;

  if (title === "슬롯머신") {
    const reels = outcome.reels as SlotSymbol[] | undefined;
    const kind = outcome.kind as "triple" | "pair" | "none" | undefined;
    if (!reels || !kind) return null;
    const icons = reels.map((r) => SLOT_EMOJI[r]).join("");
    const result =
      kind === "triple"
        ? `세 칸 ×${slotTripleMult(reels[0])}`
        : kind === "pair"
          ? "두 칸"
          : "꽝";
    return `${bet} → ${icons} ${result}`;
  }

  if (title === "룰렛") {
    const slot = outcome.slot as number | undefined;
    const color = outcome.color as "red" | "black" | "green" | undefined;
    if (slot == null || !color) return null;
    const colorLabel = color === "red" ? "빨강" : color === "black" ? "검정" : "초록";
    const choice = detail?.choice as string | null | undefined;
    const choiceLabel = choice ? rouletteChoiceLabel(choice) : null;
    return choiceLabel
      ? `${bet} → ${choiceLabel} / ${colorLabel} ${slot}`
      : `${bet} → ${colorLabel} ${slot}`;
  }

  // 판을 여는 줄. 아직 판정이 없어 steps 가 비어 있으므로 아래 분기로 보내면
  // 둘째 줄이 통째로 빈다. 연 패만 적는다.
  if (title === "하이로우 개시") {
    const next = outcome.next as number | undefined;
    if (next == null) return null;
    return `${bet} → ${CARD_LABELS[next]} 개시`;
  }

  if (title === "하이로우 사다리" || title === "하이로우 수령") {
    const steps = outcome.steps as HighLowStep[] | undefined;
    if (!steps || steps.length === 0) return null;
    const chain = [
      CARD_LABELS[steps[0].from],
      ...steps.map((s) => CARD_LABELS[s.next]),
    ].join("→");
    const result = outcome.result as string | undefined;
    const verdict = result && result in VERDICT ? VERDICT[result as keyof typeof VERDICT].word : null;
    return `${bet} → ${chain} ${steps.length}단계${verdict ? ` · ${verdict}` : ""}`;
  }

  if (title === "키노") {
    const picks = outcome.picks as number[] | undefined;
    const hits = outcome.hits as number[] | undefined;
    const match = outcome.match as number | undefined;
    if (!picks || match == null) return null;
    const tail = match > 0 && hits?.length ? ` (${hits.join(",")})` : "";
    return `${bet} → ${picks.join(",")} · ${match}/5 적중${tail}`;
  }

  return null;
}
