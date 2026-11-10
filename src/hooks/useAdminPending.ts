"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 관리자가 확인해야 하는 대기(관계 신청·진정)가 있는지만 본다.
 * 건수는 쓰지 않으므로 두 큐를 하나의 총합으로 뭉친다.
 */
export function useAdminPending(
  supabase: SupabaseClient,
  enabled: boolean,
): { pending: boolean } {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPending(false);
      return;
    }
    let active = true;

    const tick = async () => {
      const { data } = await supabase.rpc("panel_pending");
      if (!active || !data) return;
      const d = data as { relations: number; petitions: number };
      setPending(d.relations + d.petitions > 0);
    };

    tick();
    const timer = window.setInterval(tick, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [supabase, enabled]);

  return { pending };
}
