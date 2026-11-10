"use client";
/* 관리자 화면 공통 — 타입, 상태 라벨, 버튼 클래스, 작은 표현 컴포넌트. */

import {
  ADMIN_REASONS,
  type AdminTradeLedger,
  type PetitionStatus,
  TRADE_STATUS_LABEL,
  type TradeItem,
} from "@/lib/game";
import MonoLabel from "../ui/MonoLabel";

export type AdminRelation = {
  id: number;
  username: string;
  partner: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reject_reason: string | null;
};

export const RELATION_STATUS_LABEL: Record<string, string> = {
  pending: "심사 대기",
  approved: "등재됨",
  rejected: "반려됨",
};

export const PETITION_STATUS_LABEL: Record<PetitionStatus, string> = {
  open: "미답변",
  answered: "답변 완료",
  closed: "종결",
};

export function formatShort(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const FIELD =
  "mono-13 w-full border border-line bg-surface px-3 py-2.5 text-fg-hi outline-none placeholder:text-fg-low focus:border-brass-line";
export const PRIMARY =
  "state-fade label-11 shrink-0 border border-brass-line bg-brass-fill px-5 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";
export const PLAIN =
  "state-fade label-11 shrink-0 border border-line bg-surface px-5 py-2.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";
export const SMALL =
  "state-fade label-11 shrink-0 border border-line bg-surface px-3 py-2 text-fg-mid enabled:hover:text-fg-hi";
export const DANGER =
  "state-fade label-11 shrink-0 border border-loss/60 bg-surface-hi px-5 py-2.5 text-loss enabled:hover:opacity-80 disabled:text-fg-low";

/**
 * 지급·회수 사유. 분류 셋 중 하나와 자유 메모 한 줄을 받는다.
 *
 * 여기서 고른 값은 받은 사람의 "프로필 > 기록"에 그대로 뜬다 — 관리자만
 * 보는 메모가 아니다. 둘 다 비워 둘 수 있지만, 비워 두면 유저 쪽에는
 * "관리 · 코인 30개 지급" 한 줄만 남아 왜 받았는지 알 수 없다.
 */
export function ReasonPicker({
  category,
  note,
  onCategory,
  onNote,
  disabled,
  placeholder = "사유 메모 — 유저에게 그대로 보인다",
}: {
  category: string | null;
  note: string;
  onCategory: (id: string | null) => void;
  onNote: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1">
        {ADMIN_REASONS.map((r) => {
          const on = category === r.id;
          return (
            <button
              key={r.id}
              type="button"
              disabled={disabled}
              // 한 번 더 누르면 해제된다 — 사유 없이 보내던 예전 동작도 남겨 둔다.
              onClick={() => onCategory(on ? null : r.id)}
              className={`state-fade label-11 border px-3 py-2 ${
                on
                  ? "border-brass-line bg-brass-fill text-fg-hi"
                  : "border-line bg-surface text-fg-mid enabled:hover:text-fg-hi"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <input
        value={note}
        onChange={(e) => onNote(e.target.value)}
        maxLength={200}
        placeholder={placeholder}
        className={FIELD}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * 거래 기록 한 줄로 할 수 있는 일.
 *   revert     — 거래 목록에 남은 성립 거래: 거래 취소(양쪽 회수)
 *   confiscate — 상대가 삭제돼 거래 행이 없음: 이 사람이 받은 것만 회수
 */
export function ledgerState(e: AdminTradeLedger): {
  kind: "revert" | "confiscate" | "none";
  label: string;
  actionable: boolean;
} {
  if (e.confiscated) return { kind: "none", label: "회수됨", actionable: false };
  if (e.trade) {
    if (e.trade.status === "done")
      return { kind: "revert", label: "양쪽 취소 가능", actionable: true };
    return {
      kind: "none",
      label: TRADE_STATUS_LABEL[e.trade.status],
      actionable: false,
    };
  }
  if (e.got_coins === 0 && e.got_items.length === 0)
    return { kind: "none", label: "받은 것 없음", actionable: false };
  return { kind: "confiscate", label: "회수 가능", actionable: true };
}

export function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="title-19 text-fg-hi">{title}</h2>
      <p className="body-15 text-fg-mid">{desc}</p>
    </div>
  );
}

/** 자주 쓰는 값 프리셋 칩 */
export function Presets({
  values,
  value,
  onPick,
  signed = false,
}: {
  values: number[];
  value: number;
  onPick: (n: number) => void;
  signed?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={`state-fade mono-13 flex-1 border py-1.5 tabular-nums ${
            value === v
              ? "border-brass-line bg-brass-fill text-fg-hi"
              : "border-line bg-surface text-fg-mid"
          }`}
        >
          {signed && v > 0 ? `+${v}` : v}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  brass = false,
}: {
  label: string;
  value: React.ReactNode;
  brass?: boolean;
}) {
  return (
    <div className="bg-surface flex flex-col gap-1 p-3">
      <MonoLabel tone="mid">{label}</MonoLabel>
      <div className={`mono-13 ${brass ? "text-brass" : "text-fg-hi"}`}>
        {value}
      </div>
    </div>
  );
}

export function Offer({ coins, items }: { coins: number; items: TradeItem[] }) {
  if (coins === 0 && items.length === 0) {
    return <span className="text-fg-low">없음</span>;
  }
  return (
    <span className="text-fg">
      {coins > 0 && <span className="text-brass">{coins} 코인</span>}
      {coins > 0 && items.length > 0 && <span className="text-fg-low"> + </span>}
      {items.map((i, n) => (
        <span key={i.code}>
          {n > 0 && <span className="text-fg-low">, </span>}
          {i.emoji} {i.name} ×{i.qty}
        </span>
      ))}
    </span>
  );
}
