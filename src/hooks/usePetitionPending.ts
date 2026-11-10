"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PetitionSummary } from "@/lib/game";

/**
 * 관리자 답변이 달린 내 피드백이 있는지만 본다.
 * 건수는 쓰지 않으므로 유무 하나로 뭉친다.
 * 관리자 화면의 대기 점(useAdminPending)과 대칭이다 — 관리자가 답변하면
 * 켜지고, 내가 다시 글을 올리거나(answered→open) 관리자가 종결하면 꺼진다.
 */
export function usePetitionPending(
  supabase: SupabaseClient,
  enabled: boolean,
): { pending: boolean; setPending: (v: boolean) => void } {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPending(false);
      return;
    }
    let active = true;

    const tick = async () => {
      const { data } = await supabase.rpc("petition_list");
      if (!active || !data) return;
      const list = data as PetitionSummary[];
      setPending(list.some((p) => p.status === "answered"));
    };

    tick();
    const timer = window.setInterval(tick, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [supabase, enabled]);

  return { pending, setPending };
}
