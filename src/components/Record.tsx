"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CARD_LABELS,
  ITEM_GRADE_LABEL,
  ADMIN_REASON_LABEL,
  LEDGER_KIND_LABEL,
  LIVESTOCK_PASS,
  LIVESTOCK_CHAIN_MAX,
  TITLE_PASS,
  rouletteChoiceLabel,
  SLOT_SYMBOLS,
  formatDaysLeft,
  formatDuration,
  hasLighter,
  isUsable,
  itemAction,
  itemEffect,
  needsLighter,
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
  kind: "user" | "livestock" | "title";
  expires_in: number | null;
};

/** 신원표 "등재된 관계" 칸이 쓰는 축약형 — 승인된 관계만, 상대 이름 기준으로 정리한다. */
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

/** inmate_roster() 가 주는 한 줄 — 관계 탭 목록과 그 아래 상세 보기가 공유한다. */
type RosterEntry = {
  username: string;
  avatar_path: string | null;
  hp: number;
  hp_max: number;
  in_ward: boolean;
  cell_id: number | null;
  cell: string | null;
  crime: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  bio: string | null;
  livestock_consent: boolean | null;
  /** 문장만 담긴 배열. 만료 시각·아이템 코드는 절대 안 온다(본인 것만 state.flex 에 있다) */
  flex: string[];
};
import { identityOf } from "@/lib/identity";
import { FACILITY, VERDICT, healthNote, recordNotes } from "@/lib/copy";
import { useIsMobile } from "@/hooks/useIsMobile";
import TabRail from "./ui/TabRail";
import Panel from "./ui/Panel";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";
import AvatarCropper from "./AvatarCropper";

/**
 * 수감기록 — 시설이 만든 문서다.
 *
 * 이 구역만 색상각이 없다(chroma 0). 색이 있으면 누군가 손을 댔다는 뜻이고,
 * 이 서류에는 아무도 손대지 않았다. 놋쇠 토큰까지 무채색으로 덮여 있어서
 * 여기서는 강조색을 쓰려고 해도 나오지 않는다.
 *
 * 전부 등폭이고, 배치는 표다. 읽기 좋게 만들 이유가 시설에는 없다.
 */

type Tab = "profile" | "items" | "roster" | "history";
/** 수감목록 탭 안의 하위 카테고리 — 관계 · 수감자 목록. */
type RosterSub = "relations" | "list";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "신상" },
  { id: "items", label: "소지품" },
  { id: "roster", label: "수감목록" },
  { id: "history", label: "기록" },
];

const ROSTER_SUBS: { id: RosterSub; label: string }[] = [
  { id: "relations", label: "관계" },
  { id: "list", label: "수감자 목록" },
];

const inputField =
  "mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line w-full min-w-0 border px-3 py-2.5 outline-none";
const smallAction =
  "label-11 state-fade border-line shrink-0 border bg-surface-hi px-2.5 py-1 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

/** 기록 목록에서 제목을 줄여 쓴다. "하이로우 사다리" → "하이로우". */
function gameTitle(title: string): string {
  return title === "하이로우 사다리" ? "하이로우" : title;
}

/** 기록 목록 둘째 줄 — 작업은 일당 한 줄, 탐색은 장소 한 줄. */
function laborLine(detail: Record<string, unknown>): string | null {
  const band = detail?.band as string | undefined;
  const bandLabel =
    band === "low" ? "박하게" : band === "high" ? "후하게" : band === "mid" ? "보통으로" : null;
  return bandLabel ? `일당을 ${bandLabel} 받았다` : null;
}

/**
 * 관리자가 주거나 거둔 줄의 둘째 줄 — "[이벤트] 추석 특별 배급".
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
  if (detail?.cat) return `${placeLabel}에서 고양이를 만났다`;
  if (miss) return `${placeLabel}을 뒤졌지만 빈손이었다`;
  return ration ? `${placeLabel}에서 비상식량을 찾았다` : `${placeLabel}을 뒤졌다`;
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
    const icons = reels.map((r) => SLOT_SYMBOLS[r].emoji).join("");
    const result =
      kind === "triple"
        ? `세 칸 ×${SLOT_SYMBOLS[reels[0]].mult}`
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
 * 신원표 한 장 — 신상 탭과 관계 탭의 상세 보기가 함께 쓰는 표현 컴포넌트.
 * `photo`/`footer` 를 넘기지 않으면(= 남의 신상을 볼 때) 사진 교체·수정
 * 버튼이 저절로 빠진다. 체력 관리 지침은 이 컴포넌트가 그리지 않는다 —
 * 자기 신상일 때만 호출한 쪽이 바로 아래에 따로 붙인다.
 */
function ProfileCard({
  no,
  term,
  username,
  avatarUrl,
  cell,
  crime,
  age,
  heightCm,
  weightKg,
  hp,
  hpMax,
  bio,
  flex,
  livestockConsent,
  relations,
  notes,
  photo,
  footer,
  catLoved,
}: {
  no: string;
  term: string;
  username: string;
  avatarUrl: string | null;
  cell: string | null;
  crime: string | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  hp: number;
  hpMax: number;
  bio: string | null;
  /** 과시 상태 문장들(중독 낙인 포함). 없으면 빈 배열.
   *  `time` 은 본인 신상에서만 채워 넣는다 — 소모형 과시 상태의 남은 시간은
   *  본인에게만 보이고, 남의 신상에는 문장만(시간 없이) 나간다. */
  flex: { text: string; time?: string }[];
  /** 가축권 동의 여부. 아직 기재 전이면 null */
  livestockConsent: boolean | null;
  /** 관리자가 승인한(등재된) 관계만. 신청 중·반려는 여기 넣지 않는다. */
  relations: RelationRow[];
  /** 시설이 붙인 관찰 표시(recordNotes). 남의 신상에는 넘기지 않는다. */
  notes?: string;
  /** 내 신상일 때만: 사진 칸에 교체 버튼을 끼운다. 없으면 정적 사진 칸. */
  photo?: React.ReactNode;
  /** 내 신상일 때만: 비고 칸 아래 우측에 붙는 '수정' 버튼. */
  footer?: React.ReactNode;
  /** 떠돌이 고양이에게 가장 사랑받는 사람이면 특이사항 맨 아래에 한 줄을 더한다. */
  catLoved?: boolean;
}) {
  const flexLines = catLoved ? [...flex, { text: CAT_FAVORITE_LINE }] : flex;
  const heightWeight =
    heightCm != null && weightKg != null ? `${heightCm} / ${weightKg}` : "-";
  const extraNote = notes && notes !== "미기재" ? notes : null;

  return (
    <div className="grid grid-cols-1 gap-2 tab:grid-cols-[220px_minmax(0,1fr)]">
      {/* ── 신원표 카드 ── */}
      <Panel className="flex flex-col gap-3 text-center">
        <MonoLabel tone="low">{FACILITY} 신원표</MonoLabel>

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
              <span className="mono-13 text-fg-low">사진 자리</span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="num-lg text-fg-hi tabular-nums">{no}</span>
          <span className="title-19 text-fg-hi truncate">{username}</span>
        </div>

        {/* 무엇을 했나 → 얼마나 사나 → 어디 있나. 실제 수용기록표의 순서다. */}
        <div className="border-line-soft mt-auto flex flex-col gap-1 border-t pt-3">
          {crime && <span className="mono-13 text-fg-mid truncate">{crime}</span>}
          <span className="mono-13 text-fg-mid">{term}</span>
          {cell && <span className="mono-13 text-fg-mid">{cell}</span>}
        </div>
      </Panel>

      {/* ── 나이 · 키/체중 · 소견 · 비고 ── */}
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
          <Cell label="소견" quiet>
            <span className="body-15 text-fg">{healthNote(hp, hpMax)}</span>
            {extraNote && (
              <span className="body-15 text-fg-low mt-0.5 block">
                {extraNote}
              </span>
            )}
          </Cell>
          <Cell label="가축권 동의" quiet>
            {livestockConsent === null ? (
              "미기재"
            ) : livestockConsent ? (
              "동의"
            ) : (
              <span className="text-loss">비동의</span>
            )}
          </Cell>
          <Cell label="비고" wide quiet>
            {bio ? (
              <span className="whitespace-pre-line break-words">{bio}</span>
            ) : (
              "미기재"
            )}
          </Cell>
          <Cell label="특이사항" wide quiet>
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
          <Cell label="등재된 관계" wide quiet>
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
  /** 장착형 과시품 해제 */
  onUnequip: (code: string) => void;
  /** 라이터로 생고구마를 굽는다 */
  onRoast: (code: string) => void;
  /** 우유에 커피·아이스 커피·루이보스티 중 하나(drink)를 섞는다 */
  onMix: (drink: string) => void;
  /** 가축 지목권을 쓴 뒤 코인·소지품을 다시 읽는다 */
  onRefresh: () => Promise<void>;
  /** 사진 경로를 프로필에 반영한다 (실제 업로드는 이 컴포넌트가 직접 한다) */
  onAvatarChange: (path: string | null) => Promise<boolean>;
  /** 죄목·나이·키/체중·비고·가축권 동의 여부를 프로필에 반영한다 */
  onDetailsChange: (args: {
    p_crime: string;
    p_age: number | null;
    p_height_cm: number | null;
    p_weight_kg: number | null;
    p_bio: string;
    p_livestock_consent: boolean;
  }) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const [rosterSub, setRosterSub] = useState<RosterSub>("relations");
  const [log, setLog] = useState<LedgerEntry[]>([]);
  const isMobile = useIsMobile();

  // 신원표 사진
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBust, setAvatarBust] = useState(0);
  const [avatarActionOpen, setAvatarActionOpen] = useState(false);
  // 모바일 + 사진 있음일 때만 쓰는 길게 누르기 타이머
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // 신상 기재(죄목·나이·키/체중·비고) 팝업
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dCrime, setDCrime] = useState("");
  const [dAge, setDAge] = useState("");
  const [dHeight, setDHeight] = useState("");
  const [dWeight, setDWeight] = useState("");
  const [dBio, setDBio] = useState("");
  // 신상 기재 화면에 들어온 동안에는 반드시 동의/비동의 중 하나를 골라야 저장이 켜진다.
  const [dConsent, setDConsent] = useState<boolean | null>(null);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // 관계 · 수감자 목록
  const [relations, setRelations] = useState<RelationEntry[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [openInmate, setOpenInmate] = useState<string | null>(null);
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

  // 가축 지목 팝업 — 소지품 탭에서 가축 지목권을 사용하면 연다.
  const [lsOpen, setLsOpen] = useState(false);
  const [lsTarget, setLsTarget] = useState("");
  const [lsBusy, setLsBusy] = useState(false);
  const [lsError, setLsError] = useState<string | null>(null);

  // 호칭 지정 팝업 — 소지품 탭에서 호칭권을 사용하면 연다.
  const [ttOpen, setTtOpen] = useState(false);
  const [ttTarget, setTtTarget] = useState("");
  const [ttTitle, setTtTitle] = useState("");
  const [ttBusy, setTtBusy] = useState(false);
  const [ttError, setTtError] = useState<string | null>(null);

  // 되묻기 팝업 — 관계 삭제 · 소지품 반납은 바로 실행하지 않고 한 번 더 확인한다.
  const [confirm, setConfirm] = useState<
    | { kind: "relation-delete"; id: number; who: string }
    | { kind: "item-sell"; code: string; qty: number; name: string; total: number }
    // 보은 사용 — 효과 설명은 이 팝업에만 뜬다.
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

    const { data: inmates } = await supabase.rpc("inmate_roster");
    if (inmates) setRoster(inmates as RosterEntry[]);

    // 떠돌이 고양이에게 가장 사랑받는 사람 — 특이사항 맨 아래 한 줄(24_cat.sql).
    const fav = await supabase.rpc("cat_favorite");
    setCatFavorite((fav.data as { username: string | null } | null)?.username ?? null);
  }, [supabase]);

  useEffect(() => {
    loadLog();
  }, [loadLog, refreshKey]);

  useEffect(() => {
    if (tab === "profile" || tab === "roster") loadNews();
  }, [tab, loadNews, refreshKey]);

  // 고양이 — 소지품 탭에 들어갈 때마다 도착한 보은이 있는지 보고, 내가 지은 이름
  // (○○의 보은 표기)과 보은 효과의 남은 판 수도 함께 받는다.
  const [catStatus, setCatStatus] = useState<CatStatus | null>(null);
  const [catGiftsOpen, setCatGiftsOpen] = useState(false);
  const [catFavorite, setCatFavorite] = useState<string | null>(null);
  // 몰래버리기 · 보은 쓰기 결과 팝업
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
      setCatNote({ title: "몰래버리기", lines: [toKoreanError(error.message)] });
      return;
    }
    setCatNote({ title: "몰래버리기", lines: catTossLines(catStatus?.cat_name ?? null, name, catSeed()) });
    await onRefresh();
  }

  // 같은 보은 효과가 아직 남아 있는가 — 사용 팝업이 [쓴다] 를 막는다.
  function catGiftActive(code: string): boolean {
    if (!catStatus) return false;
    if (code === "dead_bird") return catStatus.bless_left > 0;
    if (code === "dead_mouse") return !!catStatus.steal_ready;
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
  // 신청자·상대 어느 쪽이었든 상관없이, 나와 이미 등재된 관계가 있으면 대상이다.
  const relatedPartners = useMemo(() => {
    const set = new Set<string>();
    for (const r of relations) {
      // 가축·호칭 관계는 심사 없이 등재되고 중복도 허용한다 — 일반 관계 신청과는 무관하다.
      if (r.status !== "approved" || r.kind !== "user") continue;
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

  // 가축 지목·호칭 지정 팝업의 상대 목록을 함께 만든다 — 가축권에 동의했고,
  // 그 kind 안에서 이미 지목당하지 않았고, 나를 그 kind 로 지목해 둔 상대도
  // 아닌 사람만. 서버가 마지막 판단을 내리지만, 애초에 고를 수 없는 이름을
  // 보여주지 않는다. 가축·호칭은 서로 독립이라 kind 별로만 걸러낸다.
  const permitCandidates = useCallback(
    (kind: "livestock" | "title") => {
      const alreadyTaken = new Set<string>();
      const myOwners = new Set<string>();
      for (const r of relations) {
        if (r.kind !== kind) continue;
        alreadyTaken.add(r.username);
        if (r.username === state.username) myOwners.add(r.partner);
      }
      // 가축 사슬은 주인 포함 LIVESTOCK_CHAIN_MAX 명까지 — 서버(livestock_use)와 같은 셈:
      // 내 위 주인 단계 + 나 + 대상 + 대상 아래 가장 깊은 가축 단계.
      let chainOk = (_name: string) => true;
      if (kind === "livestock") {
        const ownerOf = new Map<string, string>();
        const herdOf = new Map<string, string[]>();
        for (const r of relations) {
          if (r.kind !== "livestock") continue;
          ownerOf.set(r.username, r.partner);
          herdOf.set(r.partner, [...(herdOf.get(r.partner) ?? []), r.username]);
        }
        let up = 0;
        for (
          let n = ownerOf.get(state.username);
          n !== undefined && up < LIVESTOCK_CHAIN_MAX;
          n = ownerOf.get(n)
        ) up++;
        const depth = (n: string, d: number): number =>
          d >= LIVESTOCK_CHAIN_MAX
            ? d
            : Math.max(d, ...(herdOf.get(n) ?? []).map((c) => depth(c, d + 1)));
        chainOk = (name) => up + depth(name, 0) + 2 <= LIVESTOCK_CHAIN_MAX;
      }
      return roster.filter(
        (r) =>
          r.username !== state.username &&
          r.livestock_consent === true &&
          !alreadyTaken.has(r.username) &&
          !myOwners.has(r.username) &&
          chainOk(r.username),
      );
    },
    [roster, relations, state.username],
  );
  const livestockCandidates = useMemo(
    () => permitCandidates("livestock"),
    [permitCandidates],
  );
  const titleCandidates = useMemo(
    () => permitCandidates("title"),
    [permitCandidates],
  );

  // 가축권 비동의로 못 돌리는 조건 — 서버(set_profile_details)와 같은 기준이다.
  //   · 아직 쓰지 않은 가축 지목권·호칭권을 들고 있거나
  //   · 가축·호칭 관계가 살아있을 때(본인이 대상이든 지목자든)
  //   · 지목자로서 둘 중 하나를 쓴 뒤 아직 잠금 기간(livestock_lock_left)이 안 지났을 때
  const livestockLocked = useMemo(() => {
    const holdsPass = (state.items ?? []).some(
      (it) =>
        (it.code === LIVESTOCK_PASS || it.code === TITLE_PASS) && it.qty > 0,
    );
    const hasActiveRelation = relations.some(
      (r) =>
        r.kind !== "user" &&
        (r.username === state.username || r.partner === state.username),
    );
    return holdsPass || hasActiveRelation || state.livestock_lock_left > 0;
  }, [state.items, relations, state.username, state.livestock_lock_left]);

  function openLivestockUse() {
    setLsError(null);
    setLsTarget("");
    setLsOpen(true);
  }

  async function submitLivestock() {
    if (!lsTarget || lsBusy) return;
    setLsBusy(true);
    setLsError(null);
    const { data, error } = await supabase.rpc("livestock_use", {
      p_target: lsTarget,
    });
    setLsBusy(false);
    if (error) {
      setLsError(toKoreanError(error.message));
      return;
    }
    if (data) setRelations(data as RelationEntry[]);
    setLsOpen(false);
    await onRefresh();
  }

  function openTitleUse() {
    setTtError(null);
    setTtTarget("");
    setTtTitle("");
    setTtOpen(true);
  }

  async function submitTitle() {
    const title = ttTitle.trim();
    if (!ttTarget || !title || ttBusy) return;
    setTtBusy(true);
    setTtError(null);
    const { data, error } = await supabase.rpc("title_use", {
      p_target: ttTarget,
      p_title: title,
    });
    setTtBusy(false);
    if (error) {
      setTtError(toKoreanError(error.message));
      return;
    }
    if (data) setRelations(data as RelationEntry[]);
    setTtOpen(false);
    await onRefresh();
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

  const inmateAvatarUrl = useCallback(
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
      setAvatarError("파일이 너무 큽니다. 20MB 이하로 골라라.");
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
    setDCrime(state.crime ?? "");
    setDAge(state.age != null ? String(state.age) : "");
    setDHeight(state.height_cm != null ? String(state.height_cm) : "");
    setDWeight(state.weight_kg != null ? String(state.weight_kg) : "");
    setDBio(state.bio ?? "");
    setDConsent(state.livestock_consent);
    setDetailsOpen(true);
  }

  async function saveDetails() {
    if (detailsBusy || dConsent === null) return;
    if (dConsent === false && livestockLocked) return;
    setDetailsBusy(true);
    setDetailsError(null);
    const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
    const ok = await onDetailsChange({
      p_crime: dCrime.trim(),
      p_age: toNum(dAge),
      p_height_cm: toNum(dHeight),
      p_weight_kg: toNum(dWeight),
      p_bio: dBio.trim(),
      p_livestock_consent: dConsent,
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
  // 담배는 불을 붙일 것이 있어야 쓴다 — 서버(flex_use)와 같은 기준으로 미리 막는다.
  // 라이터는 장착해도 인벤에 남으므로 보유 수량만 본다.
  const lighterHeld = useMemo(() => hasLighter(items), [items]);
  // 우유에 섞을 수 있는 음료 중 지금 가진 것.
  const mixDrinks = useMemo(() => items.filter((i) => MIX_TO[i.code] && i.qty > 0), [items]);
  const me = identityOf(state.username);
  const action =
    "label-11 state-fade border-line border bg-surface-hi px-3 py-2.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";

  const inmate = roster.find((r) => r.username === openInmate) ?? null;

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

      {/* ── 신상 ──
          좌측은 종이 대장에서 뜯어낸 신원표 한 장, 우측은 헤더에 없는 항목만 남긴 표다.
          체력 배급 · 보유 코인 · 금일 배정은 헤더가 담당하므로 여기서 다시 적지 않는다. */}
      {tab === "profile" && (
        <div className="flex flex-col gap-2">
          <ProfileCard
            catLoved={catFavorite === state.username}
            no={me.no}
            term={me.term}
            username={state.username}
            avatarUrl={avatarUrl}
            cell={state.cell}
            crime={state.crime}
            age={state.age}
            heightCm={state.height_cm}
            weightKg={state.weight_kg}
            hp={state.hp}
            hpMax={state.hp_max}
            bio={state.bio}
            flex={[
              ...(state.addict_lines ?? (state.addicted ? ["손이 늘 떨린다"] : [])).map(
                (text) => ({ text }),
              ),
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
            livestockConsent={state.livestock_consent}
            relations={approvedRelationsFor(state.username, relations)}
            notes={recordNotes(state)}
            footer={
              <button type="button" onClick={openDetailsForm} className={smallAction}>
                수정
              </button>
            }
            photo={
              <>
                {/* 이 시설은 수용자를 개별 촬영하지 않는다. 대신 본인이 직접 채운다.
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
                    <span className="mono-13 text-fg-low">사진 자리</span>
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
            <MonoLabel tone="low">체력 관리 지침</MonoLabel>
            <ul className="mt-2 flex flex-col gap-1">
              {[
                "체력은 2시간마다 3, 1판마다 1씩 차감된다.",
                "도시락은 08:00 · 12:00 · 19:00에 지급한다.",
                "회복은 소지품에서 직접 섭취해야 반영된다.",
                "체력이 0이 되면 병동으로 이송한다. 수용은 14시간을 시작으로 입원을 거듭할수록 길어진다. (최대 48시간) 퇴원 후 3일 동안 다시 이송되지 않으면 14시간으로 돌아간다.",
                "퇴원 후의 체력은 80이며, 먹을 것이 있으면 병동 이송을 15시간 유예한다.",
                "입원 중에는 도시락을 지급하지 않는다.",
                // 해당될 때만 붙는 줄. 수치는 00_rules.sql 의 hp_decay_per_block(3)
                // + addict_hp_penalty(1) · withdrawal_hours(12). 금단은 체력을 더 깎지 않는다.
                ...(state.addicted
                  ? ["약물 중독 상태에서는 체력이 2시간마다 4씩 차감된다. 중독은 해독제로만 해제된다."]
                  : []),
                ...(state.withdrawal
                  ? ["마지막 투약 후 12시간이 지나면 금단 증상이 나타난다."]
                  : []),
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
            반납은 시설이 되사주는 것이다. 값은 시설이 정하고 깎을 수 없다.
            사람끼리 주고받으려면 거래소를 쓴다.
          </p>

          {items.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              등재된 소지품 없음
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
                        {needsLighter(it) && !lighterHeld && " · 라이터 필요"}
                        {(equippedCount.get(it.code) ?? 0) > 0 &&
                          ` · ${equippedCount.get(it.code)}개 장착 중`}
                        {!it.tradable && " · 반출 금지"}
                      </p>
                    </div>
                    <span className="flex flex-col items-end leading-tight">
                      {it.qty > 0 && (
                        <span className="num-md text-fg-hi tabular-nums">{it.qty}</span>
                      )}
                      {!!it.open_left && (
                        <span className="mono-13 text-fg-mid tabular-nums">
                          {it.qty > 0 ? "+" : ""}
                          {it.open_left}개비
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
                          // 병동을 줄이는 물건은 병동에 있을 때만, 나머지 효과 아이템은
                          // 병동 밖에서만 — 순수 과시 소모품(flex_use)은 가리지 않는다.
                          // 담배만 예외로, 라이터가 없으면 갈래를 가리지 않고 막는다.
                          disabled={
                            busy ||
                            // 송편 효과는 한 사람에 하나 — 이미 먹었으면 막는다.
                            (itemAction(it) === "songpyeon" && !!state.chuseok) ||
                            // 네잎클로버도 한 번에 하나 — 켜진 동안은 막는다.
                            (it.kind === "charm" && !!state.luck) ||
                            (needsLighter(it) && !lighterHeld) ||
                            (itemAction(it) === "use" &&
                              (it.ward_cut > 0 ? !state.in_ward : state.in_ward))
                          }
                          onClick={() =>
                            it.code === LIVESTOCK_PASS
                              ? openLivestockUse()
                              : it.code === TITLE_PASS
                                ? openTitleUse()
                                : onUse(it.code)
                          }
                          className={`${action} flex-1`}
                        >
                          {itemAction(it) === "songpyeon"
                            ? "먹기"
                            : itemAction(it) === "radio"
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
                          몰래버리기
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
                          1개 반납 {it.sell_price}
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
                            전량 반납 {it.sell_price * it.qty}
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
              병동에서는 진료권 종류만 사용할 수 있다.
            </p>
          )}
        </section>
      )}

      {/* ── 수감목록 ── */}
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
          {/* 반려된 관계신청 — 내 신청 중 반려된 것만, 있을 때만 보인다 */}
          {relations.filter((r) => r.mine && r.status === "rejected").length >
            0 && (
              <section className="bg-bg-1 flex flex-col gap-2 p-4">
                <MonoLabel tone="low">반려된 관계신청</MonoLabel>
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

          {/* 등재된 관계 — 관리자가 수락한 것만, 모두에게 보인다 */}
          <section className="bg-bg-1 flex flex-col gap-2 p-4">
            <MonoLabel tone="low">등재된 관계</MonoLabel>

            {relError && <p className="mono-13 text-loss">{relError}</p>}

            {relations.filter((r) => r.status === "approved").length === 0 ? (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-8 text-center">
                등재된 관계 없음
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {relations
                  .filter((r) => r.status === "approved")
                  .map((r) => {
                    // 가축·호칭 관계는 심사 없이 등재되고 컬럼 관례가 같다
                    // (username = 대상, partner = 지목자/주인) — 화살표·정렬도 함께 묶는다.
                    const isPass = r.kind !== "user";
                    const isPartner = !!r.partner && r.partner === state.username;
                    // 작성자·상대는 수정·삭제 모두, 관리자는 삭제만 가능하다.
                    // 가축·호칭 관계는 기간이 끝나야 사라진다 — 관리자만 예외로 지울 수 있다.
                    const canEdit = !isPass && (r.mine || isPartner) && !!r.partner;
                    const canDelete = isPass
                      ? state.is_admin
                      : r.mine || isPartner || state.is_admin;
                    return (
                      <li key={r.id} className="bg-surface flex flex-col gap-1 p-3">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                          <MonoLabel tone="low" className="min-w-0 truncate">
                            {isPass && r.partner
                              ? `${identityOf(r.partner).no} ${r.partner}`
                              : `${identityOf(r.username).no} ${r.username}`}
                          </MonoLabel>
                          {r.partner && (
                            <>
                              <span className="text-fg-low">
                                {isPass ? "→" : "↔"}
                              </span>
                              <MonoLabel tone="low" className="min-w-0 truncate">
                                {isPass
                                  ? `${identityOf(r.username).no} ${r.username}`
                                  : `${identityOf(r.partner).no} ${r.partner}`}
                              </MonoLabel>
                            </>
                          )}
                        </div>
                        <p className="body-15 text-fg whitespace-pre-wrap break-words">{r.body}</p>
                        {isPass && r.expires_in != null && (
                          <p className="mono-13 text-fg-low">
                            {formatDaysLeft(r.expires_in)} 남음
                          </p>
                        )}
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
                                  who: r.partner
                                    ? isPass
                                      ? `${r.partner} → ${r.username}`
                                      : `${r.username} ↔ ${r.partner}`
                                    : r.username,
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
              관계 기록
            </button>
          </section>
            </>
          )}

          {rosterSub === "list" && (
            <>
          {/* 수감자 목록 — 존재하는 유저의 번호·이름·상태. 이름을 누르면
              바로 아래에 그 사람의 신상이 펼쳐진다(체력 관리 지침은 제외). */}
          <section className="bg-bg-1 flex flex-col gap-2 p-4">
            <MonoLabel tone="low">수감자 목록 {roster.length}명</MonoLabel>
            {roster.length === 0 ? (
              <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
                등재된 수감자 없음
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
                            setOpenInmate((u) =>
                              u === p.username ? null : p.username,
                            )
                          }
                          className="min-w-0 truncate text-left text-fg hover:text-fg-hi"
                        >
                          {p.username}
                        </button>
                        {sameCell && (
                          <span className="label-11 border-line-soft text-fg-low shrink-0 border px-1 py-px">
                            동실
                          </span>
                        )}
                        {p.in_ward && (
                          <span className="label-11 border-loss/40 text-loss shrink-0 border px-1 py-px">
                            병동
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {inmate && (
            <ProfileCard
              no={identityOf(inmate.username).no}
              term={identityOf(inmate.username).term}
              username={inmate.username}
              avatarUrl={inmateAvatarUrl(inmate.avatar_path)}
              cell={inmate.cell}
              crime={inmate.crime}
              age={inmate.age}
              heightCm={inmate.height_cm}
              weightKg={inmate.weight_kg}
              hp={inmate.hp}
              hpMax={inmate.hp_max}
              bio={inmate.bio}
              flex={inmate.flex.map((text) => ({ text }))}
              catLoved={catFavorite === inmate.username}
              livestockConsent={inmate.livestock_consent}
              relations={approvedRelationsFor(inmate.username, relations)}
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
              등재된 기록 없음
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

      {/* 가축 지목 팝업 — 소지품 탭에서 가축 지목권을 사용하면 연다. */}
      {lsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => {
              if (!lsBusy) setLsOpen(false);
            }}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>가축 지목</MonoLabel>
                <button
                  type="button"
                  onClick={() => setLsOpen(false)}
                  className="label-11 text-fg-mid hover:text-fg-hi"
                  disabled={lsBusy}
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg-mid">
                  지목하면 3일 동안 상대를 가축으로 부릴 수 있다. 신상에서 가축권에 동의한 사람만 고를 수 있다.
                </p>

                <MonoLabel tone="low">상대</MonoLabel>
                {livestockCandidates.length === 0 ? (
                  <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
                    지목할 수 있는 사람이 없다.
                  </p>
                ) : (
                  <select
                    value={lsTarget}
                    onChange={(e) => setLsTarget(e.target.value)}
                    className="mono-13 border-line bg-surface text-fg-hi focus:border-brass-line w-full border px-3 py-2.5 outline-none"
                  >
                    <option value="">상대 선택…</option>
                    {livestockCandidates.map((r) => (
                      <option key={r.username} value={r.username}>
                        {identityOf(r.username).no} {r.username}
                      </option>
                    ))}
                  </select>
                )}

                {lsError && <p className="mono-13 text-loss">{lsError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={lsBusy || !lsTarget}
                    onClick={submitLivestock}
                    className="label-11 state-fade flex-1 border border-brass-line bg-brass-fill px-3 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                  >
                    지목
                  </button>
                  <button
                    type="button"
                    onClick={() => setLsOpen(false)}
                    disabled={lsBusy}
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

      {/* 호칭 지정 팝업 — 소지품 탭에서 호칭권을 사용하면 연다. */}
      {ttOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => {
              if (!ttBusy) setTtOpen(false);
            }}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>호칭 지정</MonoLabel>
                <button
                  type="button"
                  onClick={() => setTtOpen(false)}
                  className="label-11 text-fg-mid hover:text-fg-hi"
                  disabled={ttBusy}
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg-mid">
                  지목하면 하루 동안 상대에게 원하는 호칭으로 불릴 수 있다. 신상에서 가축권에 동의한 사람만 고를 수 있다.
                </p>

                <MonoLabel tone="low">상대</MonoLabel>
                {titleCandidates.length === 0 ? (
                  <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
                    지목할 수 있는 사람이 없다.
                  </p>
                ) : (
                  <select
                    value={ttTarget}
                    onChange={(e) => setTtTarget(e.target.value)}
                    className="mono-13 border-line bg-surface text-fg-hi focus:border-brass-line w-full border px-3 py-2.5 outline-none"
                  >
                    <option value="">상대 선택…</option>
                    {titleCandidates.map((r) => (
                      <option key={r.username} value={r.username}>
                        {identityOf(r.username).no} {r.username}
                      </option>
                    ))}
                  </select>
                )}

                <MonoLabel tone="low">호칭</MonoLabel>
                <input
                  type="text"
                  value={ttTitle}
                  onChange={(e) => setTtTitle(e.target.value)}
                  placeholder="예: 형님 · 오빠 · 주인님"
                  className={inputField}
                />

                {ttError && <p className="mono-13 text-loss">{ttError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={ttBusy || !ttTarget || !ttTitle.trim()}
                    onClick={submitTitle}
                    className="label-11 state-fade flex-1 border border-brass-line bg-brass-fill px-3 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                  >
                    지목
                  </button>
                  <button
                    type="button"
                    onClick={() => setTtOpen(false)}
                    disabled={ttBusy}
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

      {/* 관계 기록 팝업 — body 로 포탈. 상위에 filter/transform 이 걸려도
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
                <MonoLabel>{relLocked ? "수정 신청" : "관계 기록"}</MonoLabel>
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
                    상대를 고르고 어떤 사이인지 적어라. 관리자가 확인하면 등재된 관계에 오른다.
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

      {/* 되묻기 팝업 — 관계 삭제 · 소지품 반납 공용 */}
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
                    ? "관계 삭제"
                    : confirm.kind === "cat-use"
                      ? confirm.name
                      : confirm.kind === "mix"
                        ? "우유에 섞기"
                        : "소지품 반납"}
                </MonoLabel>
              </div>
              {confirm.kind === "mix" ? (
                <div className="flex flex-col gap-2 p-4">
                  <p className="body-15 text-fg">무엇을 섞을까.</p>
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
                    그만둔다
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
                          쓴다
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm(null)}
                          className={action}
                        >
                          그만둔다
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : (
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg">
                  {confirm.kind === "relation-delete"
                    ? `${confirm.who} 관계 기록을 삭제한다. 되돌릴 수 없다.`
                    : `${confirm.name} ${confirm.qty}개를 반납한다. 반납가 ${confirm.total} 코인. 되돌릴 수 없다.`}
                </p>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    disabled={confirm.kind === "relation-delete" ? relBusy : busy}
                    onClick={runConfirm}
                    className="label-11 state-fade flex-1 border border-loss/60 bg-surface-hi px-3 py-2.5 text-loss enabled:hover:opacity-80 disabled:text-fg-low"
                  >
                    {confirm.kind === "relation-delete" ? "삭제" : "반납"}
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

      {/* 신상 기재 팝업 — 죄목 · 나이 · 키/체중 · 비고 */}
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
                <MonoLabel>신상 기재</MonoLabel>
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
                  사진은 신원표의 사진 칸을 눌러 바꾼다. 휴대전화에서는 길게 누른다.
                </p>

                <MonoLabel tone="low">죄목</MonoLabel>
                <input
                  value={dCrime}
                  onChange={(e) => setDCrime(e.target.value)}
                  maxLength={40}
                  placeholder="예: 살인미수"
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

                <MonoLabel tone="low">비고</MonoLabel>
                <textarea
                  value={dBio}
                  onChange={(e) => setDBio(e.target.value)}
                  maxLength={300}
                  rows={5}
                  placeholder="예: 왼쪽 눈썹에 흉터. 말수가 적다."
                  className="mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line min-h-32 w-full resize-none border px-3 py-2.5 outline-none"
                />

                <MonoLabel tone="low">가축권 동의</MonoLabel>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDConsent(true)}
                    className={`label-11 state-fade flex-1 border px-3 py-2.5 ${dConsent === true
                      ? "border-brass-line bg-brass-fill text-fg-hi"
                      : "border-line bg-surface text-fg-mid hover:text-fg-hi"
                      }`}
                  >
                    동의
                  </button>
                  <button
                    type="button"
                    disabled={livestockLocked}
                    onClick={() => setDConsent(false)}
                    className={`label-11 state-fade flex-1 border px-3 py-2.5 ${dConsent === false
                      ? "border-loss/60 bg-surface-hi text-loss"
                      : "border-line bg-surface text-fg-mid hover:text-fg-hi"
                      } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    비동의
                  </button>
                </div>
                {livestockLocked ? (
                  <p className="mono-13 text-fg-low">
                    {state.livestock_lock_left > 0
                      ? `가축 지목권·호칭권을 사용한 뒤 ${formatDaysLeft(state.livestock_lock_left)} 동안은 가축권 동의를 철회할 수 없다.`
                      : "가축 지목권·호칭권을 가지고 있거나, 가축·호칭 관계가 진행 중인 동안은 가축권 동의를 철회할 수 없다."}
                  </p>
                ) : (
                  dConsent === null && (
                    <p className="mono-13 text-fg-low">
                      동의 또는 비동의 중 하나를 반드시 골라야 저장할 수 있다.
                    </p>
                  )
                )}

                {detailsError && (
                  <p className="mono-13 text-loss">{detailsError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={
                      detailsBusy ||
                      dConsent === null ||
                      (dConsent === false && livestockLocked)
                    }
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
