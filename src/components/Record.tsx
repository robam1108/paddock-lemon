"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CARD_LABELS,
  ITEM_GRADE_LABEL,
  ADMIN_REASON_LABEL,
  LEDGER_KIND_LABEL,
  rouletteChoiceLabel,
  SLOT_EMOJI,
  slotTripleMult,
  formatDaysLeft,
  formatDuration,
  hasLighter,
  isUsable,
  itemAction,
  itemEffect,
  MILK,
  MIX_NAME,
  MIX_TO,
  ROAST_TO,
  toKoreanError,
  ITEM_KIND_LABEL,
  type HighLowStep,
  type LedgerEntry,
  type PlayerState,
  type SlotSymbol,
} from "@/lib/game";
import {
  CAT_GIFT_CODES,
  type CatStatus,
} from "@/lib/game";
import { INSTRUMENTS } from "@/lib/gear";
import { SEARCH_PLACES, laborTitle } from "@/lib/labor";
import {
  CAT_FAVORITE_LINE,
  CAT_GIFT_ACTIVE_LINE,
  catGiftUseInfo,
  catGiftUsedLines,
  catSeed,
  catTossLines,
} from "@/lib/copy";
import CatGiftPopup from "./CatGiftPopup";
import ResultPopup from "./ui/ResultPopup";

type RelationEntry = {
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
type RelationRow = { id: number; other: string; body: string };

function approvedRelationsFor(
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
type RosterEntry = {
  username: string;
  avatar_path: string | null;
  hp: number;
  hp_max: number;
  in_ward: boolean;
  cell_id: number | null;
  cell: string | null;
  status_message: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  bio: string | null;
  /** 문장만 담긴 배열. 만료 시각·아이템 코드는 절대 안 온다(본인 것만 state.flex 에 있다) */
  flex: string[];
};
import { identityOf } from "@/lib/identity";
import { VERDICT, healthNote, recordNotes } from "@/lib/copy";
import { SITE_NAME } from "@/lib/site";
import { useIsMobile } from "@/hooks/useIsMobile";
import TabRail from "./ui/TabRail";
import Panel from "./ui/Panel";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";
import AvatarCropper from "./AvatarCropper";

/**
 * 프로필 — 내 정보 · 소지품 · 친구 · 기록.
 *
 * 이 구역만 색상각이 없다(chroma 0). 놋쇠 토큰까지 무채색으로 덮여 있어서
 * 여기서는 강조색이 나오지 않는다. 전부 등폭이고, 배치는 표다.
 */

type Tab = "profile" | "items" | "roster" | "history";
/** 친구 탭 안의 하위 카테고리 — 친구 피드 · 플레이어 목록. */
type RosterSub = "relations" | "list";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "내 정보" },
  { id: "items", label: "소지품" },
  { id: "roster", label: "친구" },
  { id: "history", label: "기록" },
];

const ROSTER_SUBS: { id: RosterSub; label: string }[] = [
  { id: "relations", label: "친구 피드" },
  { id: "list", label: "플레이어 목록" },
];

const inputField =
  "mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line w-full min-w-0 border px-3 py-2.5 outline-none";
const smallAction =
  "label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

/** 기록 목록에서 제목을 줄여 쓴다. "하이로우 사다리" → "하이로우". */
function gameTitle(title: string): string {
  return title === "하이로우 사다리" ? "하이로우" : title;
}

/** 기록 목록 둘째 줄 — 미션은 보상 한 줄, 탐험은 장소 한 줄. */
function laborLine(detail: Record<string, unknown>): string | null {
  const band = detail?.band as string | undefined;
  const bandLabel =
    band === "low" ? "적게" : band === "high" ? "많이" : band === "mid" ? "보통으로" : null;
  return bandLabel ? `보상을 ${bandLabel} 받았습니다` : null;
}

/**
 * 관리자가 주거나 거둔 줄의 둘째 줄 — "[이벤트] 주말 보너스".
 * 분류도 메모도 없으면(SQL Editor 에서 사유 없이 부른 경우) 아무것도 적지 않는다.
 */
function adminLine(detail: Record<string, unknown>): string | null {
  const category = detail?.category as string | undefined;
  const note = (detail?.note as string | undefined)?.trim();
  const tag = category ? `[${ADMIN_REASON_LABEL[category] ?? category}]` : null;
  if (tag && note) return `${tag} ${note}`;
  return tag ?? note ?? null;
}

function searchLine(detail: Record<string, unknown>): string | null {
  const place = detail?.place as string | undefined;
  const ration = detail?.ration as boolean | undefined;
  const miss = detail?.miss as boolean | undefined;
  const placeLabel = place ? (SEARCH_PLACES.find((p) => p.id === place)?.label ?? place) : null;
  if (!placeLabel) return null;
  if (detail?.cat) return `${placeLabel}에서 고양이를 만났습니다`;
  if (miss) return `${placeLabel} 탐험 · 빈손`;
  return ration ? `${placeLabel}에서 간식을 찾았습니다` : `${placeLabel} 탐험`;
}

/**
 * 기록 목록 둘째 줄 — "판돈 → 결과"를 게임별로 한 줄 요약한다.
 * 배당 배수는 슬롯 세 칸 일치일 때만 붙인다. 나머지는 배수를 적지 않는다.
 */
function gameLine(title: string, detail: Record<string, unknown>): string | null {
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

/**
 * 압축 표의 한 칸. 라벨이 위, 값이 아래로 붙는다.
 * 칸끼리의 1px 선은 각 칸이 아니라 감싼 격자의 gap 이 낸다.
 */
function Cell({
  label,
  wide,
  quiet,
  children,
}: {
  label: string;
  /** 비고처럼 한 줄을 통째로 쓰는 칸 */
  wide?: boolean;
  /** 예외 표기 칸. 값을 키우지 않는다. */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`scanline-faint bg-bg-1 flex min-w-0 flex-col gap-1 p-3 tab:p-4 ${wide ? "col-span-2" : ""
        }`}
    >
      <MonoLabel tone="low">{label}</MonoLabel>
      <div className={quiet ? "body-15 text-fg" : "title-19 text-fg-hi"}>
        {children}
      </div>
    </div>
  );
}

/**
 * 프로필 카드 — 내 정보 탭과 친구 탭의 상세 보기가 함께 쓰는 표현 컴포넌트.
 * `photo`/`footer` 를 넘기지 않으면(= 남의 프로필을 볼 때) 사진 교체·수정
 * 버튼이 저절로 빠진다.
 */
function ProfileCard({
  no,
  username,
  avatarUrl,
  cell,
  status_message,
  age,
  heightCm,
  weightKg,
  hp,
  hpMax,
  bio,
  flex,
  relations,
  notes,
  photo,
  footer,
  catLoved,
}: {
  no: string;
  username: string;
  avatarUrl: string | null;
  cell: string | null;
  status_message: string | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  hp: number;
  hpMax: number;
  bio: string | null;
  /** 프로필 표시 문장들. 없으면 빈 배열.
   *  `time` 은 본인 프로필에서만 채워 넣는다 — 소모형 표시의 남은 시간은
   *  본인에게만 보이고, 남의 프로필에는 문장만(시간 없이) 나간다. */
  flex: { text: string; time?: string }[];
  /** 관리자가 승인한 관계만. 신청 중·반려는 여기 넣지 않는다. */
  relations: RelationRow[];
  /** 상태 표시(recordNotes). 남의 프로필에는 넘기지 않는다. */
  notes?: string;
  /** 내 프로필일 때만: 사진 칸에 교체 버튼을 끼운다. 없으면 정적 사진 칸. */
  photo?: React.ReactNode;
  /** 내 프로필일 때만: 소개 칸 아래 우측에 붙는 '수정' 버튼. */
  footer?: React.ReactNode;
  /** 떠돌이 고양이에게 가장 사랑받는 사람이면 상태 맨 아래에 한 줄을 더한다. */
  catLoved?: boolean;
}) {
  const flexLines = catLoved ? [...flex, { text: CAT_FAVORITE_LINE }] : flex;
  const heightWeight =
    heightCm != null && weightKg != null ? `${heightCm} / ${weightKg}` : "-";
  const extraNote = notes && notes !== "없음" ? notes : null;

  return (
    <div className="grid grid-cols-1 gap-2 tab:grid-cols-[220px_minmax(0,1fr)]">
      {/* ── 프로필 카드 ── */}
      <Panel className="flex flex-col gap-3 text-center">
        <MonoLabel tone="low">{SITE_NAME} 프로필</MonoLabel>

        {photo ?? (
          <div className="scanline-faint border-line relative mx-auto flex h-[152px] w-[132px] items-center justify-center overflow-hidden border border-dashed bg-bg-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="mono-13 text-fg-low">사진 없음</span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="num-lg text-fg-hi tabular-nums">{no}</span>
          <span className="title-19 text-fg-hi truncate">{username}</span>
        </div>

        {/* 상태 메시지 → 룸 */}
        <div className="border-line-soft mt-auto flex flex-col gap-1 border-t pt-3">
          <span className="mono-13 text-fg-mid truncate">{status_message || "상태 메시지 없음"}</span>
          {cell && <span className="mono-13 text-fg-mid">룸 {cell}</span>}
        </div>
      </Panel>

      {/* ── 나이 · 키/체중 · 컨디션 · 소개 ── */}
      <div className="flex flex-col gap-2">
        <div className="border-line-soft grid grid-cols-2 gap-px border bg-line-soft">
          <Cell label="나이">
            {age != null ? (
              <>
                <span className="tabular-nums">{age}</span>세
              </>
            ) : (
              "-"
            )}
          </Cell>
          <Cell label="키 / 체중">{heightWeight}</Cell>
          <Cell label="컨디션" quiet>
            <span className="body-15 text-fg">{healthNote(hp, hpMax)}</span>
            {extraNote && (
              <span className="body-15 text-fg-low mt-0.5 block">
                {extraNote}
              </span>
            )}
          </Cell>
          <Cell label="소개" wide quiet>
            {bio ? (
              <span className="whitespace-pre-line break-words">{bio}</span>
            ) : (
              "없음"
            )}
          </Cell>
          <Cell label="상태" wide quiet>
            {flexLines.length === 0 ? (
              "없음"
            ) : (
              <ul className="flex flex-col gap-0.5">
                {flexLines.map((line, idx) => (
                  <li key={idx} className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words">{line.text}</span>
                    {line.time && (
                      <span className="mono-13 text-fg-low shrink-0">
                        {line.time}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Cell>
          <Cell label="친구" wide quiet>
            {relations.length === 0 ? (
              "없음"
            ) : (
              <ul className="flex flex-col gap-0.5">
                {relations.map((r) => (
                  <li key={r.id} className="break-words">
                    <span className="text-fg-mid">
                      {identityOf(r.other).no} {r.other}
                    </span>
                    <span className="text-fg-low"> · </span>
                    {r.body}
                  </li>
                ))}
              </ul>
            )}
          </Cell>
        </div>

        {footer && <div className="flex justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export default function Record({
  supabase,
  state,
  busy,
  refreshKey,
  onUse,
  onSell,
  onUnequip,
  onRoast,
  onMix,
  onRefresh,
  onAvatarChange,
  onDetailsChange,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  /** 코인이 움직일 때마다 값이 바뀌어 기록을 다시 읽는다 */
  refreshKey: number;
  onUse: (code: string) => void;
  onSell: (code: string, qty: number) => void;
  /** 장착형 꾸미기 해제 */
  onUnequip: (code: string) => void;
  /** 라이터로 생고구마를 굽는다 */
  onRoast: (code: string) => void;
  /** 우유에 커피·아이스 커피·루이보스티 중 하나(drink)를 섞는다 */
  onMix: (drink: string) => void;
  /** 고양이 선물을 쓰거나 정리한 뒤 코인·소지품을 다시 읽는다 */
  onRefresh: () => Promise<void>;
  /** 사진 경로를 프로필에 반영한다 (실제 업로드는 이 컴포넌트가 직접 한다) */
  onAvatarChange: (path: string | null) => Promise<boolean>;
  /** 상태 메시지·나이·키/체중·소개를 프로필에 반영한다 */
  onDetailsChange: (args: {
    p_status_message: string;
    p_age: number | null;
    p_height_cm: number | null;
    p_weight_kg: number | null;
    p_bio: string;
  }) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const [rosterSub, setRosterSub] = useState<RosterSub>("relations");
  const [log, setLog] = useState<LedgerEntry[]>([]);
  const isMobile = useIsMobile();

  // 프로필 사진
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBust, setAvatarBust] = useState(0);
  const [avatarActionOpen, setAvatarActionOpen] = useState(false);
  // 모바일 + 사진 있음일 때만 쓰는 길게 누르기 타이머
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // 프로필 수정(상태 메시지·나이·키/체중·소개) 팝업
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dCrime, setDCrime] = useState("");
  const [dAge, setDAge] = useState("");
  const [dHeight, setDHeight] = useState("");
  const [dWeight, setDWeight] = useState("");
  const [dBio, setDBio] = useState("");
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // 친구 · 플레이어 목록
  const [relations, setRelations] = useState<RelationEntry[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [relFormOpen, setRelFormOpen] = useState(false);
  const [relPartner, setRelPartner] = useState("");
  const [relDesc, setRelDesc] = useState("");
  const [relBusy, setRelBusy] = useState(false);
  const [relError, setRelError] = useState<string | null>(null);
  // 수정 신청으로 열었을 때만 채워진다 — 채워져 있으면 상대 선택을 잠근다.
  const [relLocked, setRelLocked] = useState(false);
  // 반려된 신청을 고쳐 재신청할 때만 채워진다 — 재신청이 통과하면 이 id의
  // 옛 반려 신청을 지운다.
  const [relReplaceId, setRelReplaceId] = useState<number | null>(null);
  // "보기"로 연 반려 신청 상세 팝업
  const [relRejectedView, setRelRejectedView] = useState<RelationEntry | null>(
    null,
  );

  // 되묻기 팝업 — 관계 삭제 · 소지품 판매는 바로 실행하지 않고 한 번 더 확인한다.
  const [confirm, setConfirm] = useState<
    | { kind: "relation-delete"; id: number; who: string }
    | { kind: "item-sell"; code: string; qty: number; name: string; total: number }
    // 고양이 선물 사용 — 효과 설명은 이 팝업에만 뜬다.
    | { kind: "cat-use"; code: string; name: string }
    // 우유 섞기 — 섞을 음료가 여러 종류일 때만 고르는 창을 띄운다.
    | { kind: "mix" }
    | null
  >(null);

  async function runConfirm() {
    if (!confirm) return;
    if (confirm.kind === "relation-delete") {
      await deleteRelation(confirm.id);
      if (relRejectedView?.id === confirm.id) setRelRejectedView(null);
    } else if (confirm.kind === "cat-use") {
      const c = confirm;
      setConfirm(null);
      await applyCatGift(c.code, c.name);
      return;
    } else if (confirm.kind === "mix") {
      return;
    } else {
      onSell(confirm.code, confirm.qty);
    }
    setConfirm(null);
  }

  const loadLog = useCallback(async () => {
    const { data } = await supabase.rpc("my_ledger", { p_limit: 30 });
    if (data) setLog(data as LedgerEntry[]);
  }, [supabase]);

  const loadNews = useCallback(async () => {
    const feed = await supabase.rpc("relations_feed");
    if (feed.data) setRelations(feed.data as RelationEntry[]);

    const { data: players } = await supabase.rpc("player_roster");
    if (players) setRoster(players as RosterEntry[]);

    // 떠돌이 고양이에게 가장 사랑받는 사람 — 상태 맨 아래 한 줄.
    const fav = await supabase.rpc("cat_favorite");
    setCatFavorite((fav.data as { username: string | null } | null)?.username ?? null);
  }, [supabase]);

  useEffect(() => {
    loadLog();
  }, [loadLog, refreshKey]);

  useEffect(() => {
    if (tab === "profile" || tab === "roster") loadNews();
  }, [tab, loadNews, refreshKey]);

  // 고양이 — 소지품 탭에 들어갈 때마다 도착한 선물이 있는지 보고, 내가 지은 이름
  // (○○의 선물 표기)과 선물 효과의 남은 판 수도 함께 받는다.
  const [catStatus, setCatStatus] = useState<CatStatus | null>(null);
  const [catGiftsOpen, setCatGiftsOpen] = useState(false);
  const [catFavorite, setCatFavorite] = useState<string | null>(null);
  // 몰래 정리 · 선물 쓰기 결과 팝업
  const [catNote, setCatNote] = useState<{ title: string; lines: string[] } | null>(null);
  const loadCat = useCallback(async () => {
    const { data } = await supabase.rpc("cat_gifts_pending");
    const d = data as CatStatus | null;
    if (!d) return null;
    setCatStatus(d);
    return d;
  }, [supabase]);
  useEffect(() => {
    if (tab !== "items") return;
    let live = true;
    loadCat().then((d) => {
      if (live && d && d.gifts.length > 0) setCatGiftsOpen(true);
    });
    return () => {
      live = false;
    };
  }, [tab, loadCat]);

  async function tossCatGift(code: string, name: string) {
    const { error } = await supabase.rpc("cat_gift_toss", { p_code: code });
    if (error) {
      setCatNote({ title: "몰래 정리", lines: [toKoreanError(error.message)] });
      return;
    }
    setCatNote({ title: "몰래 정리", lines: catTossLines(catStatus?.cat_name ?? null, name, catSeed()) });
    await onRefresh();
  }

  // 같은 선물 효과가 아직 남아 있는가 — 사용 팝업이 [쓴다] 를 막는다.
  function catGiftActive(code: string): boolean {
    if (!catStatus) return false;
    if (code === "feather") return catStatus.bless_left > 0;
    if (code === "toy_mouse") return !!catStatus.search_ready;
    return !!catStatus.labor_ready;
  }

  async function applyCatGift(code: string, name: string) {
    const { error } = await supabase.rpc("cat_gift_use", { p_code: code });
    if (error) {
      setCatNote({ title: name, lines: [toKoreanError(error.message)] });
      return;
    }
    setCatNote({ title: name, lines: catGiftUsedLines(code) });
    await onRefresh();
    loadCat();
  }

  // 이미 승인된 관계가 있는 상대 — 신규 신청의 상대 선택창에서 뺀다.
  // 신청자·상대 어느 쪽이었든 상관없이, 나와 이미 승인된 관계가 있으면 대상이다.
  const relatedPartners = useMemo(() => {
    const set = new Set<string>();
    for (const r of relations) {
      if (r.status !== "approved") continue;
      if (r.username === state.username) set.add(r.partner);
      else if (r.partner === state.username) set.add(r.username);
    }
    return set;
  }, [relations, state.username]);

  async function submitRelation() {
    const desc = relDesc.trim();
    if (!relPartner || !desc || relBusy) return;
    setRelBusy(true);
    setRelError(null);
    const { data, error } = await supabase.rpc("relation_submit", {
      p_partner: relPartner,
      p_body: desc,
    });
    if (error) {
      setRelBusy(false);
      setRelError(toKoreanError(error.message));
      return;
    }
    let result = data as RelationEntry[] | null;
    // 반려된 신청을 고쳐 다시 낸 것이면, 통과한 뒤 옛 반려 신청은 지운다.
    if (relReplaceId != null) {
      const del = await supabase.rpc("relation_delete", {
        p_id: relReplaceId,
      });
      if (del.data) result = del.data as RelationEntry[];
    }
    setRelBusy(false);
    if (result) setRelations(result);
    setRelPartner("");
    setRelDesc("");
    setRelLocked(false);
    setRelReplaceId(null);
    setRelFormOpen(false);
  }

  /**
   * 이미 있는 관계에 대해 상대와 내용을 채운 채 수정 신청을 연다.
   * replace 가 true 면(반려된 신청 수정) 재신청이 통과한 뒤 옛 신청을 지운다.
   */
  function openRelationEdit(r: RelationEntry, replace = false) {
    setRelError(null);
    // 상대가 여는 경우, "그쪽에서 본 상대"는 원래 신청자(username) 쪽이다.
    const other = r.username === state.username ? r.partner : r.username;
    setRelPartner(other);
    setRelDesc(r.body);
    setRelLocked(true);
    setRelReplaceId(replace ? r.id : null);
    setRelFormOpen(true);
  }

  async function deleteRelation(id: number) {
    if (relBusy) return;
    setRelBusy(true);
    setRelError(null);
    const { data, error } = await supabase.rpc("relation_delete", {
      p_id: id,
    });
    setRelBusy(false);
    if (error) {
      setRelError(toKoreanError(error.message));
      return;
    }
    if (data) setRelations(data as RelationEntry[]);
  }

  // avatar_path 는 Storage 안의 경로일 뿐이라, 실제 주소는 매번 여기서 만든다.
  // avatarBust 는 같은 경로에 새 파일을 덮어썼을 때 브라우저 캐시를 피하려는 용도.
  const avatarUrl = useMemo(() => {
    if (!state.avatar_path) return null;
    const { data } = supabase.storage
      .from("avatars")
      .getPublicUrl(state.avatar_path);
    return avatarBust ? `${data.publicUrl}?v=${avatarBust}` : data.publicUrl;
  }, [supabase, state.avatar_path, avatarBust]);

  const playerAvatarUrl = useCallback(
    (path: string | null) => {
      if (!path) return null;
      return supabase.storage.from("avatars").getPublicUrl(path).data
        .publicUrl;
    },
    [supabase],
  );

  function onAvatarFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setAvatarError("이미지 파일만 올릴 수 있습니다.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setAvatarError("파일이 너무 큽니다. 20MB 이하로 골라 주세요.");
      return;
    }
    setAvatarError(null);
    setPendingFile(f);
  }

  /**
   * 사진 칸 탭 처리.
   *   사진 없음        → 어느 기기든 바로 파일을 고른다.
   *   사진 있음 · PC   → 클릭으로 수정 팝업을 연다 (평소엔 라벨이 호버에만 보인다).
   *   사진 있음 · 모바일 → 짧게 누르면 아무 일도 없다. 길게 눌러야 팝업이 뜬다
   *                       (호버가 없는 기기라 항상 뜨는 라벨을 두지 않는다).
   */
  function onPhotoClick() {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    setAvatarError(null);
    if (!avatarUrl) {
      fileInputRef.current?.click();
    } else if (!isMobile) {
      setAvatarActionOpen(true);
    }
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onPhotoPointerDown() {
    if (!isMobile || !avatarUrl) return;
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setAvatarError(null);
      setAvatarActionOpen(true);
    }, 550);
  }

  /** 잘라낸 조각을 올리고, 경로만 프로필에 반영한다. */
  async function uploadAvatar(blob: Blob) {
    setAvatarBusy(true);
    setAvatarError(null);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (userErr || !uid) {
      setAvatarError("로그인 정보를 확인할 수 없습니다.");
      setAvatarBusy(false);
      return;
    }

    // 사람마다 파일 하나뿐이라 항상 같은 이름으로 덮어쓴다.
    const path = `${uid}/avatar.jpg`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (upErr) {
      setAvatarError(toKoreanError(upErr.message));
      setAvatarBusy(false);
      return;
    }

    const ok = await onAvatarChange(path);
    setAvatarBusy(false);
    if (!ok) {
      setAvatarError("등록하지 못했습니다.");
      return;
    }
    setAvatarBust(Date.now());
    setPendingFile(null);
  }

  async function removeAvatar(): Promise<boolean> {
    if (!state.avatar_path || avatarBusy) return false;
    setAvatarBusy(true);
    setAvatarError(null);
    await supabase.storage.from("avatars").remove([state.avatar_path]);
    const ok = await onAvatarChange(null);
    setAvatarBusy(false);
    if (!ok) setAvatarError("지우지 못했습니다.");
    return ok;
  }

  function openDetailsForm() {
    setDetailsError(null);
    setDCrime(state.status_message ?? "");
    setDAge(state.age != null ? String(state.age) : "");
    setDHeight(state.height_cm != null ? String(state.height_cm) : "");
    setDWeight(state.weight_kg != null ? String(state.weight_kg) : "");
    setDBio(state.bio ?? "");
    setDetailsOpen(true);
  }

  async function saveDetails() {
    if (detailsBusy) return;
    setDetailsBusy(true);
    setDetailsError(null);
    const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
    const ok = await onDetailsChange({
      p_status_message: dCrime.trim(),
      p_age: toNum(dAge),
      p_height_cm: toNum(dHeight),
      p_weight_kg: toNum(dWeight),
      p_bio: dBio.trim(),
    });
    setDetailsBusy(false);
    if (!ok) {
      setDetailsError("등록하지 못했습니다.");
      return;
    }
    setDetailsOpen(false);
  }

  const items = state.items ?? [];
  const flexStatus = state.flex ?? [];
  // 장착형(wear)은 expires_at 이 null 이다 — 소모형(consume)의 카운트다운과 구분한다.
  // 같은 물건을 겹쳐 장착하면 서버가 그 수만큼 줄을 보내므로 줄 수가 곧 장착 수다.
  const equippedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of flexStatus)
      if (f.expires_at === null) m.set(f.code, (m.get(f.code) ?? 0) + 1);
    return m;
  }, [flexStatus]);
  // 운동기구는 consume 이라 착용 중이면 만료 시각이 남아 있다 — 그동안은 `해제` 를 띄운다.
  const gearOn = (code: string) =>
    flexStatus.some(
      (f) =>
        f.code === code &&
        f.expires_at !== null &&
        new Date(f.expires_at).getTime() > Date.now(),
    );
  // 굽기에는 라이터가 있어야 한다. 라이터는 장착해도 인벤에 남으므로 보유 수량만 본다.
  const lighterHeld = useMemo(() => hasLighter(items), [items]);
  // 우유에 섞을 수 있는 음료 중 지금 가진 것.
  const mixDrinks = useMemo(() => items.filter((i) => MIX_TO[i.code] && i.qty > 0), [items]);
  const me = identityOf(state.username);
  const action =
    "label-11 state-fade border-line border bg-surface-hi px-3 py-2.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

  const picked = roster.find((r) => r.username === openPlayer) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <TabRail
        items={TABS}
        value={tab}
        onChange={setTab}
        marker="left"
        columns="grid-cols-4"
        height="h-10"
      />

      {/* ── 내 정보 ──
          좌측은 프로필 카드, 우측은 헤더에 없는 항목만 남긴 표다.
          에너지 · 보유 코인 · 남은 판은 헤더가 담당하므로 여기서 다시 적지 않는다. */}
      {tab === "profile" && (
        <div className="flex flex-col gap-2">
          <ProfileCard
            catLoved={catFavorite === state.username}
            no={me.no}
            username={state.username}
            avatarUrl={avatarUrl}
            cell={state.cell}
            status_message={state.status_message}
            age={state.age}
            heightCm={state.height_cm}
            weightKg={state.weight_kg}
            hp={state.hp}
            hpMax={state.hp_max}
            bio={state.bio}
            flex={[
              ...flexStatus.map((f) =>
                f.expires_at !== null
                  ? {
                    text: f.text,
                    time: `${formatDuration(
                      Math.max(
                        0,
                        (new Date(f.expires_at).getTime() - Date.now()) / 1000,
                      ),
                    )} 남음`,
                  }
                  : { text: f.text },
              ),
            ]}
            relations={approvedRelationsFor(state.username, relations)}
            notes={recordNotes(state)}
            footer={
              <button type="button" onClick={openDetailsForm} className={smallAction}>
                수정
              </button>
            }
            photo={
              <>
                {/* 사진은 본인이 직접 올린다.
                    사진이 있으면 "수정"이 바꾸기/삭제하기 선택 팝업을 열고,
                    없으면 바로 파일을 고르게 한다. */}
                <button
                  type="button"
                  onClick={onPhotoClick}
                  onPointerDown={onPhotoPointerDown}
                  onPointerUp={clearLongPress}
                  onPointerLeave={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onContextMenu={(e) => {
                    if (isMobile && avatarUrl) e.preventDefault();
                  }}
                  disabled={avatarBusy}
                  style={
                    isMobile && avatarUrl
                      ? { WebkitTouchCallout: "none" }
                      : undefined
                  }
                  className="scanline-faint border-line group relative mx-auto flex h-[152px] w-[132px] select-none items-center justify-center overflow-hidden border border-dashed bg-bg-0 disabled:opacity-70"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="mono-13 text-fg-low">사진 없음</span>
                  )}
                  {/* 사진 없음 → 항상 보임. 사진 있음 · PC → 호버에만. 사진 있음 · 모바일 → 아예 안 그린다(길게 누르기로 대체). */}
                  {(!avatarUrl || !isMobile) && (
                    <span
                      className={`label-11 bg-bg-0/85 text-fg-hi absolute inset-x-0 bottom-0 py-1 ${avatarUrl
                        ? "opacity-0 transition-opacity group-hover:opacity-100"
                        : ""
                        }`}
                    >
                      수정
                    </span>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onAvatarFileSelected}
                />
              </>
            }
          />

          <Panel className="flex-1">
            <MonoLabel tone="low">에너지 안내</MonoLabel>
            <ul className="mt-2 flex flex-col gap-1">
              {[
                "에너지는 2시간마다 3, 1판마다 1씩 줄어듭니다.",
                "도시락은 08:00 · 12:00 · 19:00에 지급됩니다.",
                "회복 아이템은 소지품에서 직접 사용해야 반영됩니다.",
                "에너지가 0이 되면 휴식 쿨다운이 시작됩니다. 휴식 중에는 게임·미션·탐험을 할 수 없습니다.",
                "휴식이 끝나면 에너지 80으로 돌아옵니다.",
                "휴식 중에는 도시락이 지급되지 않습니다.",
              ].map((line, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[26px_minmax(0,1fr)] gap-2"
                >
                  <span className="mono-13 text-fg-low tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="body-15 text-fg-mid">{line}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* ── 소지품 ── */}
      {tab === "items" && (
        <section className="bg-bg-1 flex flex-col gap-2 p-4">
          <p className="body-15 text-fg-mid">
            판매하면 상점이 정해진 값에 되사 갑니다.
            다른 플레이어와 주고받으려면 상점·거래의 개인 거래를 이용하세요.
          </p>

          {items.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              소지품 없음
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {items.map((it) => (
                <li key={it.code} className="bg-surface flex flex-col gap-2 p-3">
                  <div className="flex items-center gap-2.5">
                    <ItemMark kind={it.kind} grade={it.grade} emoji={it.emoji} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="body-15 text-fg-hi">{it.name}</span>
                        <MonoLabel tone="low">
                          {ITEM_GRADE_LABEL[it.grade]} ·{" "}
                          {ITEM_KIND_LABEL[it.kind] ?? it.kind}
                        </MonoLabel>
                      </div>
                      <p className="mono-13 text-fg-mid">
                        {itemEffect(it)}

                        {(equippedCount.get(it.code) ?? 0) > 0 &&
                          ` · ${equippedCount.get(it.code)}개 장착 중`}
                        {!it.tradable && " · 거래 불가"}
                      </p>
                    </div>
                    <span className="flex flex-col items-end leading-tight">
                      {it.qty > 0 && (
                        <span className="num-md text-fg-hi tabular-nums">{it.qty}</span>
                      )}
                      {!!it.open_left && (
                        <span className="mono-13 text-fg-mid tabular-nums">
                          {it.qty > 0 ? "+" : ""}
                          {it.open_left}회분
                        </span>
                      )}
                    </span>
                  </div>

                  {it.description && (
                    <p className="body-15 text-fg-low">{it.description}</p>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {itemAction(it) === "flex_equip" ? (
                      <>
                        {/* 가진 수량까지 겹쳐 장착할 수 있어 장착·해제가 함께 뜰 수 있다. */}
                        {(equippedCount.get(it.code) ?? 0) > 0 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onUnequip(it.code)}
                            className={`${action} flex-1`}
                          >
                            해제
                          </button>
                        )}
                        {it.qty > (equippedCount.get(it.code) ?? 0) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onUse(it.code)}
                            className={`${action} flex-1`}
                          >
                            {(equippedCount.get(it.code) ?? 0) > 0 ? "하나 더 장착" : "장착"}
                          </button>
                        )}
                      </>
                    ) : itemAction(it) === "gear" && gearOn(it.code) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onUnequip(it.code)}
                        className={`${action} flex-1`}
                      >
                        해제
                      </button>
                    ) : (
                      isUsable(it) && (
                        <button
                          type="button"
                          // 휴식을 줄이는 물건은 휴식 중일 때만, 나머지 효과 아이템은
                          // 휴식 밖에서만 — 순수 꾸미기 소모품(flex_use)은 가리지 않는다.
                          disabled={
                            busy ||
                            // 네잎클로버는 한 번에 하나 — 켜진 동안은 막는다.
                            (it.kind === "charm" && !!state.luck) ||
                            (itemAction(it) === "use" &&
                              (it.ward_cut > 0 ? !state.in_ward : state.in_ward))
                          }
                          onClick={() => onUse(it.code)}
                          className={`${action} flex-1`}
                        >
                          {itemAction(it) === "radio"
                              ? "켜기"
                              : itemAction(it) === "gear"
                                ? INSTRUMENTS.has(it.code)
                                  ? "연주"
                                  : "착용"
                                : it.uses && it.uses > 1
                                ? `사용 (${it.open_left || it.uses}/${it.uses} 남음)`
                                : "사용"}
                        </button>
                      )
                    )}
                    {CAT_GIFT_CODES.has(it.code) && it.qty > 0 && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm({ kind: "cat-use", code: it.code, name: it.name })}
                          className={`${action} flex-1`}
                        >
                          사용
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => tossCatGift(it.code, it.name)}
                          className={`${action} flex-1`}
                        >
                          몰래 정리
                        </button>
                      </>
                    )}
                    {ROAST_TO[it.code] && lighterHeld && it.qty > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRoast(it.code)}
                        className={`${action} flex-1`}
                      >
                        굽기
                      </button>
                    )}
                    {it.code === MILK && it.qty > 0 && mixDrinks.length > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          mixDrinks.length === 1 ? onMix(mixDrinks[0].code) : setConfirm({ kind: "mix" })
                        }
                        className={`${action} flex-1`}
                      >
                        섞기
                      </button>
                    )}
                    {it.sell_price !== null && it.qty > 0 && (
                      <>
                        <button
                          type="button"
                          disabled={busy || it.qty <= (equippedCount.get(it.code) ?? 0)}
                          onClick={() =>
                            setConfirm({
                              kind: "item-sell",
                              code: it.code,
                              qty: 1,
                              name: it.name,
                              total: it.sell_price!,
                            })
                          }
                          className={`${action} flex-1`}
                        >
                          1개 판매 {it.sell_price}
                        </button>
                        {it.qty > 1 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                kind: "item-sell",
                                code: it.code,
                                qty: it.qty,
                                name: it.name,
                                total: it.sell_price! * it.qty,
                              })
                            }
                            className={`${action} flex-1`}
                          >
                            전부 판매 {it.sell_price * it.qty}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {state.in_ward && (
            <p className="scanline-faint mono-13 text-fg border-line border border-dashed px-3 py-2.5">
              휴식 중에는 휴식을 줄이는 아이템만 사용할 수 있습니다.
            </p>
          )}
        </section>
      )}

      {/* ── 친구 ── */}
      {tab === "roster" && (
        <div className="flex flex-col gap-2">
          <TabRail
            items={ROSTER_SUBS}
            value={rosterSub}
            onChange={setRosterSub}
            marker="left"
            columns="grid-cols-2"
            height="h-9"
          />

          {rosterSub === "relations" && (
            <>
          {/* 반려된 친구 신청 — 내 신청 중 반려된 것만, 있을 때만 보인다 */}
          {relations.filter((r) => r.mine && r.status === "rejected").length >
            0 && (
              <section className="bg-bg-1 flex flex-col gap-2 p-4">
                <MonoLabel tone="low">반려된 친구 신청</MonoLabel>
                <ul className="flex flex-col gap-1.5">
                  {relations
                    .filter((r) => r.mine && r.status === "rejected")
                    .map((r) => (
                      <li
                        key={r.id}
                        className="bg-surface flex items-center gap-2 p-3"
                      >
                        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1.5">
                          <MonoLabel tone="low">
                            {identityOf(r.username).no} {r.username}
                          </MonoLabel>
                          {r.partner && (
                            <>
                              <span className="text-fg-low">↔</span>
                              <MonoLabel tone="low">
                                {identityOf(r.partner).no} {r.partner}
                              </MonoLabel>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setRelRejectedView(r)}
                          className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi"
                        >
                          보기
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            )}

          {/* 친구 피드 — 관리자가 승인한 것만, 모두에게 보인다 */}
          <section className="bg-bg-1 flex flex-col gap-2 p-4">
            <MonoLabel tone="low">친구 피드</MonoLabel>

            {relError && <p className="mono-13 text-loss">{relError}</p>}

            {relations.filter((r) => r.status === "approved").length === 0 ? (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-8 text-center">
                아직 등록된 친구가 없습니다
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {relations
                  .filter((r) => r.status === "approved")
                  .map((r) => {
                    const isPartner = !!r.partner && r.partner === state.username;
                    // 작성자·상대는 수정·삭제 모두, 관리자는 삭제만 가능하다.
                    const canEdit = (r.mine || isPartner) && !!r.partner;
                    const canDelete = r.mine || isPartner || state.is_admin;
                    return (
                      <li key={r.id} className="bg-surface flex flex-col gap-1 p-3">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                          <MonoLabel tone="low" className="min-w-0 truncate">
                            {`${identityOf(r.username).no} ${r.username}`}
                          </MonoLabel>
                          {r.partner && (
                            <>
                              <span className="text-fg-low">↔</span>
                              <MonoLabel tone="low" className="min-w-0 truncate">
                                {`${identityOf(r.partner).no} ${r.partner}`}
                              </MonoLabel>
                            </>
                          )}
                        </div>
                        <p className="body-15 text-fg whitespace-pre-wrap break-words">{r.body}</p>
                        {canDelete && (
                          <div className="mt-1 flex justify-end gap-1.5">
                            {canEdit && (
                              <button
                                type="button"
                                disabled={relBusy}
                                onClick={() => openRelationEdit(r)}
                                className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low"
                              >
                                수정
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={relBusy}
                              onClick={() =>
                                setConfirm({
                                  kind: "relation-delete",
                                  id: r.id,
                                  who: r.partner ? `${r.username} ↔ ${r.partner}` : r.username,
                                })
                              }
                              className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}

            {/* 내 신청 중 아직 심사 전인 것 */}
            {relations.filter((r) => r.mine && r.status === "pending").length >
              0 && (
                <div className="flex flex-col gap-1.5">
                  {relations
                    .filter((r) => r.mine && r.status === "pending")
                    .map((r) => (
                      <div
                        key={r.id}
                        className="mono-13 text-fg-mid border-line-soft flex items-center gap-2 border px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {r.partner && `${r.partner} · `}
                          {r.body}
                          <span className="text-fg-low"> · 관리자 승인 대기</span>
                        </span>
                        <button
                          type="button"
                          disabled={relBusy}
                          onClick={() => deleteRelation(r.id)}
                          className="label-11 text-fg-low hover:text-loss disabled:text-fg-low shrink-0"
                        >
                          취소
                        </button>
                      </div>
                    ))}
                </div>
              )}

            <button
              type="button"
              onClick={() => {
                setRelError(null);
                setRelPartner("");
                setRelDesc("");
                setRelLocked(false);
                setRelReplaceId(null);
                setRelFormOpen(true);
              }}
              className={action}
            >
              친구 등록
            </button>
          </section>
            </>
          )}

          {rosterSub === "list" && (
            <>
          {/* 플레이어 목록 — 번호·이름·상태. 이름을 누르면 바로 아래에 그 사람의 프로필이 펼쳐진다. */}
          <section className="bg-bg-1 flex flex-col gap-2 p-4">
            <MonoLabel tone="low">플레이어 {roster.length}명</MonoLabel>
            {roster.length === 0 ? (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
                플레이어 없음
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-3 tab:grid-cols-1">
                {roster.map((p) => {
                  const id = identityOf(p.username);
                  const sameCell =
                    p.cell_id != null &&
                    p.cell_id === state.cell_id &&
                    p.username !== state.username;
                  return (
                    <li
                      key={p.username}
                      className="mono-13 border-line-soft grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-2 border-b py-2 tab:grid-cols-[52px_minmax(0,1fr)] tab:gap-3"
                    >
                      <span className="text-fg-low tabular-nums">{id.no}</span>
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenPlayer((u) =>
                              u === p.username ? null : p.username,
                            )
                          }
                          className="min-w-0 truncate text-left text-fg hover:text-fg-hi"
                        >
                          {p.username}
                        </button>
                        {sameCell && (
                          <span className="label-11 border-line-soft text-fg-low shrink-0 border px-1 py-px">
                            같은 룸
                          </span>
                        )}
                        {p.in_ward && (
                          <span className="label-11 border-loss/40 text-loss shrink-0 border px-1 py-px">
                            휴식
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {picked && (
            <ProfileCard
              no={identityOf(picked.username).no}
              username={picked.username}
              avatarUrl={playerAvatarUrl(picked.avatar_path)}
              cell={picked.cell}
              status_message={picked.status_message}
              age={picked.age}
              heightCm={picked.height_cm}
              weightKg={picked.weight_kg}
              hp={picked.hp}
              hpMax={picked.hp_max}
              bio={picked.bio}
              flex={picked.flex.map((text) => ({ text }))}
              catLoved={catFavorite === picked.username}
              relations={approvedRelationsFor(picked.username, relations)}
            />
          )}
            </>
          )}
        </div>
      )}

      {/* ── 기록 ── */}
      {tab === "history" && (
        <section className="bg-bg-1 flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <MonoLabel tone="low">최근 30건</MonoLabel>
            <button type="button" onClick={loadLog} className={action}>
              다시 조회
            </button>
          </div>

          {log.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              기록 없음
            </p>
          ) : (
            <ul className="flex flex-col">
              {log.map((e) => {
                const line =
                  e.kind === "game"
                    ? gameLine(e.title, e.detail)
                    : e.kind === "labor"
                      ? laborLine(e.detail)
                      : e.kind === "search"
                        ? searchLine(e.detail)
                        : e.kind === "admin"
                          ? adminLine(e.detail)
                          : null;
                const title =
                  e.kind === "labor" ? laborTitle(e.title) : gameTitle(e.title);
                return (
                  <li
                    key={e.id}
                    className="mono-13 border-line-soft grid grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 border-b py-2 tab:grid-cols-[52px_minmax(0,1fr)_auto_auto]"
                  >
                    <span className="text-fg-low truncate">
                      {LEDGER_KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <span className="text-fg truncate">{title}</span>
                    <span
                      className={`text-right tabular-nums ${e.coin_delta < 0 ? "text-loss" : "text-fg-hi"
                        }`}
                    >
                      {e.coin_delta > 0 ? `+${e.coin_delta}` : e.coin_delta}
                    </span>
                    {/* 총 소유금액 — 태블릿 이상에서만. 모바일은 폭이 좁아 잘리므로 감춘다. */}
                    <span className="text-fg-low hidden text-right tabular-nums tab:block">
                      {e.coin_after}
                    </span>
                    {line && (
                      <span className="text-fg-low col-start-2 col-end-[-1] whitespace-normal">
                        {line}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {catGiftsOpen && catStatus && (
        <CatGiftPopup
          supabase={supabase}
          gifts={catStatus.gifts}
          name={catStatus.cat_name}
          onKept={() => {
            onRefresh();
          }}
          onClose={() => {
            setCatGiftsOpen(false);
            loadCat();
          }}
        />
      )}

      {catNote && (
        <ResultPopup title={catNote.title} lines={catNote.lines} onClose={() => setCatNote(null)} />
      )}

      {/* 친구 등록 팝업 — body 로 포탈. 상위에 filter/transform 이 걸려도
          뷰포트 기준으로 뜨게 해서 모바일에서 화면 밖으로 새지 않는다. */}
      {relFormOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => setRelFormOpen(false)}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>{relLocked ? "수정 신청" : "친구 등록"}</MonoLabel>
                <button
                  type="button"
                  onClick={() => setRelFormOpen(false)}
                  className="label-11 text-fg-mid hover:text-fg-hi"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                {!relLocked && (
                  <p className="body-15 text-fg-mid">
                    상대를 고르고 어떤 사이인지 적어 주세요. 관리자가 확인하면 친구 피드에 올라갑니다.
                  </p>
                )}

                <MonoLabel tone="low">상대</MonoLabel>
                {relLocked ? (
                  <p className="mono-13 border-line-soft bg-surface text-fg-hi border px-3 py-2.5">
                    {identityOf(relPartner).no} {relPartner}
                  </p>
                ) : (
                  <select
                    value={relPartner}
                    onChange={(e) => setRelPartner(e.target.value)}
                    className="mono-13 border-line bg-surface text-fg-hi focus:border-brass-line w-full border px-3 py-2.5 outline-none"
                  >
                    <option value="">상대 선택…</option>
                    {roster
                      .filter(
                        (r) =>
                          r.username !== state.username &&
                          !relatedPartners.has(r.username),
                      )
                      .map((r) => (
                        <option key={r.username} value={r.username}>
                          {identityOf(r.username).no} {r.username}
                        </option>
                      ))}
                  </select>
                )}

                <MonoLabel tone="low">관계</MonoLabel>
                <textarea
                  value={relDesc}
                  onChange={(e) => setRelDesc(e.target.value)}
                  rows={5}
                  placeholder="예: 형제 / 함께 들어온 사이 / 앙숙"
                  className="mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line min-h-32 w-full resize-none border px-3 py-2.5 outline-none"
                />

                {relError && <p className="mono-13 text-loss">{relError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={relBusy || !relPartner || relDesc.trim().length < 1}
                    onClick={submitRelation}
                    className="label-11 state-fade flex-1 border border-brass-line bg-brass-fill px-3 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                  >
                    신청
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelFormOpen(false)}
                    className={action}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 반려된 관계신청 상세 팝업 — 사유를 보여주고 수정·삭제를 연다 */}
      {relRejectedView &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => setRelRejectedView(null)}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>반려된 관계신청</MonoLabel>
                <button
                  type="button"
                  onClick={() => setRelRejectedView(null)}
                  className="label-11 text-fg-mid hover:text-fg-hi"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                  <MonoLabel tone="low" className="min-w-0 truncate">
                    {identityOf(relRejectedView.username).no}{" "}
                    {relRejectedView.username}
                  </MonoLabel>
                  {relRejectedView.partner && (
                    <>
                      <span className="text-fg-low">↔</span>
                      <MonoLabel tone="low" className="min-w-0 truncate">
                        {identityOf(relRejectedView.partner).no}{" "}
                        {relRejectedView.partner}
                      </MonoLabel>
                    </>
                  )}
                </div>
                <p className="body-15 text-fg whitespace-pre-wrap break-words">{relRejectedView.body}</p>

                <MonoLabel tone="low">반려 사유</MonoLabel>
                <p className="body-15 text-fg-mid border-line-soft bg-surface border px-3 py-2.5">
                  {relRejectedView.reject_reason || "사유 없음"}
                </p>

                {relError && <p className="mono-13 text-loss">{relError}</p>}
                <div className="mt-1 flex justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={relBusy}
                    onClick={() => {
                      const target = relRejectedView;
                      setRelRejectedView(null);
                      openRelationEdit(target, true);
                    }}
                    className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={relBusy}
                    onClick={() =>
                      setConfirm({
                        kind: "relation-delete",
                        id: relRejectedView.id,
                        who: relRejectedView.partner
                          ? `${relRejectedView.username} ↔ ${relRejectedView.partner}`
                          : relRejectedView.username,
                      })
                    }
                    className="label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 되묻기 팝업 — 관계 삭제 · 소지품 판매 공용 */}
      {confirm &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => {
              if (!relBusy && !busy) setConfirm(null);
            }}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>
                  {confirm.kind === "relation-delete"
                    ? "친구 삭제"
                    : confirm.kind === "cat-use"
                      ? confirm.name
                      : confirm.kind === "mix"
                        ? "우유에 섞기"
                        : "소지품 판매"}
                </MonoLabel>
              </div>
              {confirm.kind === "mix" ? (
                <div className="flex flex-col gap-2 p-4">
                  <p className="body-15 text-fg">무엇을 섞을까요?</p>
                  {mixDrinks.map((d) => {
                    const to = items.find((i) => i.code === MIX_TO[d.code])?.name ?? MIX_NAME[d.code];
                    return (
                      <button
                        key={d.code}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirm(null);
                          onMix(d.code);
                        }}
                        className={action}
                      >
                        {d.name} → {to}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm(null)}
                    className={action}
                  >
                    취소
                  </button>
                </div>
              ) : confirm.kind === "cat-use" ? (
                (() => {
                  const info = catGiftUseInfo(confirm.code, catStatus?.cat_name ?? null);
                  const active = catGiftActive(confirm.code);
                  return (
                    <div className="flex flex-col gap-2 p-4">
                      {info.lines.map((l) => (
                        <p key={l} className="body-15 text-fg">
                          {l}
                        </p>
                      ))}
                      {active && <p className="mono-13 text-fg-low">{CAT_GIFT_ACTIVE_LINE}</p>}
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          disabled={busy || active}
                          onClick={runConfirm}
                          className={`${action} flex-1`}
                        >
                          사용
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm(null)}
                          className={action}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : (
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg">
                  {confirm.kind === "relation-delete"
                    ? `${confirm.who} 친구 기록을 삭제합니다. 되돌릴 수 없습니다.`
                    : `${confirm.name} ${confirm.qty}개를 ${confirm.total} 코인에 판매합니다. 되돌릴 수 없습니다.`}
                </p>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    disabled={confirm.kind === "relation-delete" ? relBusy : busy}
                    onClick={runConfirm}
                    className="label-11 state-fade flex-1 border border-loss/60 bg-surface-hi px-3 py-2.5 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                  >
                    {confirm.kind === "relation-delete" ? "삭제" : "판매"}
                  </button>
                  <button
                    type="button"
                    disabled={confirm.kind === "relation-delete" ? relBusy : busy}
                    onClick={() => setConfirm(null)}
                    className={action}
                  >
                    취소
                  </button>
                </div>
              </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* 사진 수정 선택 팝업 — 바꾸기 / 삭제하기 */}
      {avatarActionOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !avatarBusy && setAvatarActionOpen(false)}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>사진 수정</MonoLabel>
                <button
                  type="button"
                  onClick={() => setAvatarActionOpen(false)}
                  disabled={avatarBusy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                {avatarError && (
                  <p className="mono-13 text-loss">{avatarError}</p>
                )}
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={() => {
                    setAvatarActionOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className={action}
                >
                  사진 바꾸기
                </button>
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={async () => {
                    const ok = await removeAvatar();
                    if (ok) setAvatarActionOpen(false);
                  }}
                  className="label-11 state-fade border-line border bg-surface-hi px-3 py-2.5 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                >
                  사진 삭제하기
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 사진 자르기 팝업 */}
      {pendingFile && (
        <AvatarCropper
          file={pendingFile}
          busy={avatarBusy}
          error={avatarError}
          onCancel={() => {
            if (avatarBusy) return;
            setPendingFile(null);
            setAvatarError(null);
          }}
          onConfirm={uploadAvatar}
        />
      )}

      {/* 프로필 수정 팝업 — 상태 메시지 · 나이 · 키/체중 · 소개 */}
      {detailsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => !detailsBusy && setDetailsOpen(false)}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>프로필 수정</MonoLabel>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                  disabled={detailsBusy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="mono-13 text-fg-low">
                  사진은 프로필 카드의 사진 칸을 눌러 바꿉니다. 휴대전화에서는 길게 누르세요.
                </p>

                <MonoLabel tone="low">상태 메시지</MonoLabel>
                <input
                  value={dCrime}
                  onChange={(e) => setDCrime(e.target.value)}
                  maxLength={40}
                  placeholder="예: 오늘은 경마만 봅니다"
                  className={inputField}
                />

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-2">
                    <MonoLabel tone="low">나이</MonoLabel>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={dAge}
                      onChange={(e) => setDAge(e.target.value)}
                      min={1}
                      max={120}
                      placeholder="세"
                      className={inputField}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <MonoLabel tone="low">키 / 체중</MonoLabel>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={dHeight}
                        onChange={(e) => setDHeight(e.target.value)}
                        min={50}
                        max={250}
                        step={0.1}
                        placeholder="cm"
                        className={inputField}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        value={dWeight}
                        onChange={(e) => setDWeight(e.target.value)}
                        min={20}
                        max={300}
                        step={0.1}
                        placeholder="kg"
                        className={inputField}
                      />
                    </div>
                  </div>
                </div>

                <MonoLabel tone="low">소개</MonoLabel>
                <textarea
                  value={dBio}
                  onChange={(e) => setDBio(e.target.value)}
                  maxLength={300}
                  rows={5}
                  placeholder="예: 주말 저녁에 주로 접속합니다."
                  className="mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line min-h-32 w-full resize-none border px-3 py-2.5 outline-none"
                />


                {detailsError && (
                  <p className="mono-13 text-loss">{detailsError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={detailsBusy}
                    onClick={saveDetails}
                    className="label-11 state-fade flex-1 border border-brass-line bg-brass-fill px-3 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    disabled={detailsBusy}
                    onClick={() => setDetailsOpen(false)}
                    className={action}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
