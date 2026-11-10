"use client";

import { useCallback, useState } from "react";
import { toKoreanError } from "@/lib/game";
import type { AdminRelation } from "./ui";
import type { AdminCore } from "./useAdminCore";

/** 친구 신청 심사 — 승인 · 반려(사유 필수) · 삭제. */
export function useRelationAdmin(core: AdminCore) {
  const {
    busy,
    setBusy,
    setError,
    supabase,
  } = core;
  const [relations, setRelations] = useState<AdminRelation[]>([]);
  // 반려 사유 입력 팝업 — 반려는 사유를 적어야만 확정된다.
  const [rejectTarget, setRejectTarget] = useState<AdminRelation | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadRelations = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("panel_relations");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
  }, [supabase, setError]);

  async function approveRelation(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_relation_decide", {
      p_id: id,
      p_approve: true,
      p_reason: null,
    });
    setBusy(false);
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
  }

  async function confirmReject() {
    if (!rejectTarget || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_relation_decide", {
      p_id: rejectTarget.id,
      p_approve: false,
      p_reason: rejectReason.trim(),
    });
    setBusy(false);
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
    setRejectTarget(null);
    setRejectReason("");
  }

  async function deleteRelation(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_relation_delete", {
      p_id: id,
    });
    setBusy(false);
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
  }


  return {
    relations,
    setRelations,
    rejectTarget,
    setRejectTarget,
    rejectReason,
    setRejectReason,
    loadRelations,
    approveRelation,
    confirmReject,
    deleteRelation,
  };
}
