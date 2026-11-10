"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toKoreanError, type PlayerState, type PvpState } from "@/lib/game";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usePageVisible } from "@/hooks/usePageVisible";

/**
 * 1:1 대전 상태.
 *
 * Arena 화면에 있을 때만 보는 게 아니라 앱 전체에서 계속 확인한다.
 * 다른 페이지에 있어도 초대를 받을 수 있어야 하기 때문이다.
 * 대전 중이 아닐 때는 느리게, 진행 중일 때는 빠르게 확인한다.
 *
 * hold 는 "지금 화면에서 판이 돌고 있다"는 뜻이다. pvp_state 는 전체
 * PlayerState 를 함께 실어 오는데, 룰렛 4.2초·슬롯 2초짜리 애니메이션 도중에
 * 5초 틱이 떨어지면 원판이 멈추기도 전에 상단 코인이 정산 후 값으로 바뀐다.
 * hold 인 동안에는 초대 목록(pvp)만 갱신하고 플레이어 상태는 넘기지 않는다 —
 * 판이 끝나면 onSettle 이 서버가 준 최종 상태를 한 번에 반영한다.
 */
export function usePvp(
  supabase: SupabaseClient,
  onPlayerState: (p: PlayerState) => void,
  fast: boolean,
  hold = false,
) {
  const [pvp, setPvp] = useState<PvpState | null>(null);
  const visible = usePageVisible();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPlayerRef = useRef(onPlayerState);
  onPlayerRef.current = onPlayerState;

  const holdRef = useRef(hold);
  holdRef.current = hold;

  const apply = useCallback((data: PvpState, force = false) => {
    setPvp(data);
    if (force || !holdRef.current) onPlayerRef.current(data.player);
  }, []);

  const call = useCallback(
    async (fn: string, args?: Record<string, unknown>) => {
      setBusy(true);
      try {
        const { data, error: rpcError } = await supabase.rpc(fn, args ?? {});
        if (rpcError || !data) {
          setError(toKoreanError(rpcError?.message));
          return false;
        }
        setError(null);
        // 본인이 누른 대전 행동의 결과는 hold 와 무관하게 바로 반영한다.
        apply(data as PvpState, true);
        return true;
      } catch (e) {
        setError(toKoreanError(e instanceof Error ? e.message : undefined));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [supabase, apply],
  );

  useEffect(() => {
    if (!visible) return;
    let active = true;

    const tick = async () => {
      try {
        const { data } = await supabase.rpc("pvp_state");
        if (active && data) apply(data as PvpState);
      } catch {
        // 폴링 실패는 조용히 넘긴다 — 다음 틱에서 다시 시도한다.
      }
    };

    tick();
    const timer = window.setInterval(tick, fast ? 1500 : 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [supabase, apply, fast, visible]);

  return { pvp, call, busy, error, setError };
}
