"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { hasLighter, type LedgerEntry, MIX_TO, type PlayerState } from "@/lib/game";
import { useIsMobile } from "@/hooks/useIsMobile";
import { identityOf } from "@/lib/identity";
import type { RelationEntry, RosterEntry, RosterSub, Tab } from "./shared";
import { useAvatar } from "./useAvatar";
import { useDetails } from "./useDetails";
import { useRelations } from "./useRelations";
import { useCatGifts } from "./useCatGifts";

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
};

/**
 * 프로필 구역의 상태와 동작을 한데 모은다. 기능별 훅(사진 · 프로필 수정 · 친구 · 고양이)을
 * 조립하고, 탭 · 기록 · 명단 · 되묻기 팝업처럼 여러 화면이 같이 쓰는 것만 여기 둔다.
 * 탭과 팝업 컴포넌트는 이 결과(RecordModel)에서 필요한 것만 꺼내 쓴다.
 */
export function useRecordModel(props: RecordProps) {
  const { supabase, state, refreshKey, onSell, onRefresh, onAvatarChange, onDetailsChange } = props;
  const [tab, setTab] = useState<Tab>("profile");
  const [rosterSub, setRosterSub] = useState<RosterSub>("relations");
  const [log, setLog] = useState<LedgerEntry[]>([]);
  const isMobile = useIsMobile();
  const av = useAvatar({ supabase, state, isMobile, onAvatarChange });
  const det = useDetails({ state, onDetailsChange });
  const rel = useRelations({ supabase, state });
  const cat = useCatGifts({ supabase, tab, onRefresh });
  const { setRelations, relRejectedView, setRelRejectedView, deleteRelation } = rel;
  const { setCatFavorite, applyCatGift } = cat;
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

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

  const picked = roster.find((r) => r.username === openPlayer) ?? null;

  return {
    ...props,
    ...av,
    ...det,
    ...rel,
    ...cat,
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
    lighterHeld,
    mixDrinks,
    me,
    picked,
    runConfirm,
  };
}

export type RecordModel = ReturnType<typeof useRecordModel>;
