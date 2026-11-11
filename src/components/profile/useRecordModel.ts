"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LedgerEntry, PlayerState } from "@/lib/game";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { RelationEntry, RosterEntry, RosterSub, Tab } from "./shared";
import { useAvatar } from "./useAvatar";
import { useDetails } from "./useDetails";
import { useRelations } from "./useRelations";

export type RecordProps = {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  /** 코인이 움직일 때마다 값이 바뀌어 기록을 다시 읽는다 */
  refreshKey: number;
  onUse: (code: string) => void;
  onSell: (code: string, qty: number) => void;
  /** 장착형 꾸미기 해제 */
  onUnequip: (code: string) => void;
  /** 코인·소지품을 다시 읽는다 */
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
};

/**
 * 프로필 구역의 상태와 동작을 한데 모은다. 기능별 훅(사진 · 프로필 수정 · 친구)을
 * 조립하고, 탭 · 기록 · 명단 · 되묻기 팝업처럼 여러 화면이 같이 쓰는 것만 여기 둔다.
 * 탭과 팝업 컴포넌트는 이 결과(RecordModel)에서 필요한 것만 꺼내 쓴다.
 */
export function useRecordModel(props: RecordProps) {
  const { supabase, state, refreshKey, onSell, onAvatarChange, onDetailsChange } = props;
  const [tab, setTab] = useState<Tab>("profile");
  const [rosterSub, setRosterSub] = useState<RosterSub>("relations");
  const [log, setLog] = useState<LedgerEntry[]>([]);
  const isMobile = useIsMobile();
  const av = useAvatar({ supabase, state, isMobile, onAvatarChange });
  const det = useDetails({ state, onDetailsChange });
  const rel = useRelations({ supabase, state });
  const { setRelations, relRejectedView, setRelRejectedView, deleteRelation } = rel;
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  // 되묻기 팝업 — 관계 삭제 · 소지품 판매는 바로 실행하지 않고 한 번 더 확인한다.
  const [confirm, setConfirm] = useState<
    | { kind: "relation-delete"; id: number; who: string }
    | { kind: "item-sell"; code: string; qty: number; name: string; total: number }
    | null
  >(null);

  async function runConfirm() {
    if (!confirm) return;
    if (confirm.kind === "relation-delete") {
      await deleteRelation(confirm.id);
      if (relRejectedView?.id === confirm.id) setRelRejectedView(null);
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
  }, [supabase, setRelations]);

  useEffect(() => {
    loadLog();
  }, [loadLog, refreshKey]);

  useEffect(() => {
    if (tab === "profile" || tab === "roster") loadNews();
  }, [tab, loadNews, refreshKey]);

  const items = useMemo(() => state.items ?? [], [state.items]);
  const flexStatus = useMemo(() => state.flex ?? [], [state.flex]);
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

  const picked = roster.find((r) => r.username === openPlayer) ?? null;

  return {
    ...props,
    ...av,
    ...det,
    ...rel,
    tab,
    setTab,
    rosterSub,
    setRosterSub,
    log,
    setLog,
    roster,
    setRoster,
    openPlayer,
    setOpenPlayer,
    confirm,
    setConfirm,
    isMobile,
    loadLog,
    loadNews,
    items,
    flexStatus,
    equippedCount,
    gearOn,
    picked,
    runConfirm,
  };
}

export type RecordModel = ReturnType<typeof useRecordModel>;
