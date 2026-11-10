"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toKoreanError,
  toPlayerState,
  type GameId,
  type PlayResult,
  type PlayerState,
} from "@/lib/game";

/** Casual 판을 여는 RPC와 정산 반영. 판정은 전부 서버(play_game 등)가 한다. */
export function usePlayActions({
  supabase,
  canPlay,
  effectiveBet,
  busyRef,
  setState,
  setBusy,
  setBet,
  setError,
  setLast,
  setRankKey,
}: {
  supabase: SupabaseClient;
  canPlay: boolean;
  effectiveBet: number;
  busyRef: MutableRefObject<boolean>;
  setState: Dispatch<SetStateAction<PlayerState>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setBet: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLast: Dispatch<SetStateAction<PlayResult | null>>;
  setRankKey: Dispatch<SetStateAction<number>>;
}) {
  /**
   * 판을 여는 RPC 공통 처리.
   *
   * 성공하면 busy 를 켠 채로 결과를 돌려준다 — 애니메이션이 끝나고 onSettle 이
   * 불릴 때까지 화면은 잠겨 있어야 하기 때문이다. 실패하면 그 자리에서 busy 를
   * 풀고 서버 상태를 다시 읽는다.
   *
   * await 가 { error } 대신 throw 하는 경우(네트워크 끊김·토큰 갱신 실패)까지
   * 여기서 받아야 한다. 놓치면 busy 가 true 로 남아 구역 탭까지 전부 잠긴 채
   * 새로고침 말고는 빠져나갈 길이 없다.
   */
  const runPlayRpc = useCallback(
    async (
      fn: string,
      args?: Record<string, unknown>,
    ): Promise<PlayResult | null> => {
      setError(null);
      setLast(null);
      setBusy(true);

      const fail = async (message: string | undefined) => {
        setError(toKoreanError(message));
        setBusy(false);
        try {
          const { data: fresh } = await supabase.rpc("get_my_state");
          if (fresh) setState(fresh as PlayerState);
        } catch {
          // 재조회까지 실패하면 화면에 있는 값을 그대로 둔다. 판은 풀렸다.
        }
      };

      try {
        const { data, error: rpcError } = await supabase.rpc(fn, args ?? {});
        if (!rpcError && data) return data as PlayResult;
        await fail(rpcError?.message);
        return null;
      } catch (e) {
        await fail(e instanceof Error ? e.message : undefined);
        return null;
      }
    },
    [supabase],
  );

  /**
   * 서버에 판정을 요청한다. 성공하면 결과를, 실패하면 null 을 돌려준다.
   *
   * 코인은 여기서 건드리지 않는다 — 판돈을 미리 빼 놓으면 원판이 도는 4초
   * 동안 상단 숫자가 이미 줄어 있어서, 판이 끝났을 때 딴 건지 잃은 건지
   * 읽기가 어렵다. 코인은 onSettle 한 곳에서만 움직인다. 플레이 횟수는 승패와
   * 무관하게 늘 -1 이라 헷갈릴 일이 없으므로 바로 반영한다.
   */
  const onPlay = useCallback(
    async (g: GameId, choice: string | null): Promise<PlayResult | null> => {
      if (!canPlay) return null;

      const result = await runPlayRpc("play_game", {
        p_game: g,
        p_bet: effectiveBet,
        p_choice: choice,
      });
      if (!result) return null;

      setState((prev) => ({
        ...prev,
        plays_used: result.plays_used,
        plays_left: result.plays_left,
      }));
      return result;
    },
    [canPlay, effectiveBet, runPlayRpc],
  );

  /** 하이로우: 판돈을 걸고 판을 연다. 패가 뽑히면 바로 보여준다. */
  const onStartHighLow = useCallback(async (): Promise<PlayResult | null> => {
    if (!canPlay) return null;
    return runPlayRpc("highlow_begin", { p_bet: effectiveBet });
  }, [canPlay, effectiveBet, runPlayRpc]);

  /** 하이로우 사다리: 다음 단계로 계속하기(0단계 첫 판정 포함). 코인도 횟수도 추가로 쓰지 않는다. */
  const onContinue = useCallback(
    async (choice: string): Promise<PlayResult | null> => {
      if (busyRef.current) return null;
      return runPlayRpc("highlow_continue", { p_choice: choice });
    },
    [runPlayRpc],
  );

  /** 하이로우 사다리: 적립금 받고 끝내기 */
  const onCashout = useCallback(async (): Promise<PlayResult | null> => {
    if (busyRef.current) return null;
    return runPlayRpc("highlow_cashout");
  }, [runPlayRpc]);

  /** 애니메이션이 끝난 뒤 서버가 알려준 최종 상태를 반영한다. */
  const onSettle = useCallback((result: PlayResult) => {
    setState(toPlayerState(result));
    setBusy(false);
    setBet((b) => Math.max(1, Math.min(b, result.coins)));
    setRankKey((k) => k + 1);

    // 하이로우 판이 아직 열려 있으면(0단계 포함) 상단 배너는 띄우지 않는다.
    // (적중/적립금 안내는 하이로우 화면이 직접 보여준다)
    const midLadder = result.game === "highlow" && result.hl_bet > 0;
    setLast(midLadder ? null : result);
  }, []);

  return { onPlay, onStartHighLow, onContinue, onCashout, onSettle };
}
