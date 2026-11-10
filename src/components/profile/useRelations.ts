"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";
import { type PlayerState, toKoreanError } from "@/lib/game";
import type { RelationEntry } from "./shared";

/** 친구 관계 — 목록, 등록 · 수정 신청, 반려 보기, 삭제. */
export function useRelations({ supabase, state }: {
  supabase: SupabaseClient;
  state: PlayerState;
}) {
  // 친구 · 플레이어 목록
  const [relations, setRelations] = useState<RelationEntry[]>([]);
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

  return {
    relations,
    setRelations,
    relFormOpen,
    setRelFormOpen,
    relPartner,
    setRelPartner,
    relDesc,
    setRelDesc,
    relBusy,
    setRelBusy,
    relError,
    setRelError,
    relLocked,
    setRelLocked,
    relReplaceId,
    setRelReplaceId,
    relRejectedView,
    setRelRejectedView,
    relatedPartners,
    submitRelation,
    openRelationEdit,
    deleteRelation,
  };
}
