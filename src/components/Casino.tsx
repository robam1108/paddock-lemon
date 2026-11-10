"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  GAMES,
  SECTIONS,
  itemAction,
  MILK,
  toKoreanError,
  toPlayerState,
  type GameId,
  type InventoryItem,
  type PlayResult,
  type PlayerState,
  type Section,
} from "@/lib/game";
import {
  blockedState,
  bonusTail,
  clockText,
  settleLine,
  usedItemLines,
  type UsedVia,
} from "@/lib/copy";
import { usePresence } from "@/hooks/usePresence";
import { useRooms } from "@/hooks/useRooms";
import { usePvp } from "@/hooks/usePvp";
import CollapsePopup from "./CollapsePopup";
import SuspendPopup from "./SuspendPopup";
import InvitePopup from "./InvitePopup";

import RadioPopup from "./RadioPopup";
import { GEAR } from "@/lib/gear";
import ItemUsedPopup from "./ItemUsedPopup";
import UseWarning from "./UseWarning";
import SharePopup from "./SharePopup";
import LiveFeed from "./LiveFeed";
import Leaderboard from "./Leaderboard";
import RulesPanel from "./RulesPanel";
import TerminalHeader from "./TerminalHeader";
import BetControl from "./BetControl";
import Roulette from "./Roulette";
import Slots from "./Slots";
import HighLow from "./HighLow";
import Keno from "./Keno";
import BlackRoom from "./BlackRoom";
import RaceHall from "./race/RaceHall";
import Record from "./Record";
import Labor from "./Labor";
import Search from "./Search";
import Exchange from "./Exchange";
import TabRail from "./ui/TabRail";
import BlockedRow from "./ui/BlockedRow";
import Texture from "./ui/Texture";
import { canSeeRace } from "@/lib/race";

/**
 * 플레이 화면 본체.
 *
 * 차분한 어두운 톤 위에 배율과 적립금만 놋쇠색으로 띄운다.
 * 구역마다 data-zone 이 바뀌면서 같은 유틸리티가 다른 색을 집는다.
 */

/** 구역별 톤. Casual 이 기준이라 별도 값이 없다. */
const ZONE: Record<Section, string | undefined> = {
  RECORD: "record",
  LABOR: "labor",
  SEARCH: "search",
  WHITE: undefined,
  BLACK: "black",
  EXCHANGE: "exchange",
};

export default function Casino({
  userId,
  initialState,
}: {
  userId: string;
  initialState: PlayerState;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<PlayerState>(initialState);
  const { online } = usePresence(
    supabase,
    userId,
    initialState.username,
    state.hp_status,
    state.hidden,
  );
  // 룸 배치(안내)용. DB(cell_id) 기준으로 묶은 목록이라 내 룸(state.cell)과 항상 일치한다.
  const {
    rooms,
    mates,
    reload: reloadRoster,
    loading: roomsLoading,
  } = useRooms(supabase);
  const [section, setSection] = useState<Section>("RECORD");
  const [game, setGame] = useState<GameId>("roulette");
  // Arena 안의 판 — 1:1 대전 · 경마장
  const [blackTab, setBlackTab] = useState<"pvp" | "race">("pvp");
  // 경마장은 정식 오픈(RACE_PUBLIC) 전까지 시험 계정(이름이 관리자인 관리자)에게만 보인다.
  const raceVisible = canSeeRace(state);
  const [bet, setBet] = useState(1);
  const [busy, setBusy] = useState(false);
  // 재진입을 막을 때는 이 쪽을 본다 — 콜백 안의 busy 는 그 콜백이 만들어진
  // 시점의 값이라, 빠른 연타에서는 이미 true 인데도 false 로 읽힌다.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [petitionsOpen, setPetitionsOpen] = useState(false);
  // 정지 통보 팝업은 닫아도 되지만(자물쇠가 아니다), 같은 정지 건에 대해서만
  // 닫힘을 기억한다 — 해제됐다 다시 정지되면 새로 뜬다.
  const [suspendNoticeDismissedFor, setSuspendNoticeDismissedFor] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [last, setLast] = useState<PlayResult | null>(null);
  // 값이 바뀔 때마다 순위표를 즉시 다시 읽는다.
  const [rankKey, setRankKey] = useState(0);
  // 사용 시 효과가 버려지는 아이템을 쓰기 전 확인
  const [pendingUse, setPendingUse] = useState<InventoryItem | null>(null);
  // 함께 쓸 수 있는 음료·간식 — 혼자/함께를 고르는 창이 떠 있는 동안의 대상.
  const [pendingShare, setPendingShare] = useState<InventoryItem | null>(null);
  // 라디오를 켜면 뜨는 팝업. 닫으면 곡도 같이 꺼진다.
  const [radioOpen, setRadioOpen] = useState(false);
  // 소지품에서 쓰거나 착용한 직후 결과 팝업(copy.ts 의 usedItemLines).
  const [usedPopup, setUsedPopup] = useState<{ lines: string[]; notes: string[] } | null>(
    null,
  );
  // 사용 직전 상태 — 팝업의 "이전 → 이후" 를 그릴 때 콜백 안에서 읽는다.
  const stateRef = useRef(state);
  stateRef.current = state;

  // 대전 상태는 어느 화면에 있든 계속 확인한다. Arena 나 진행 중인
  // 대전이 있을 때만 빠르게 확인해서 불필요한 요청을 줄인다.
  //
  // 네 번째 인자(busy)로 판이 도는 동안은 플레이어 상태 반영을 막는다.
  // pvp_state 가 전체 상태를 함께 실어 오기 때문에, 이게 없으면 룰렛이
  // 도는 4.2초 사이에 떨어진 폴링이 상단 코인을 정산 후 값으로 바꿔 버린다.
  const {
    pvp,
    call: pvpCall,
    busy: pvpBusy,
    error: pvpError,
  } = usePvp(supabase, setState, section === "BLACK", busy);

  // 에너지 0인데 휴식 중이 아니면 = 자리를 비운 사이 바닥난 상태.
  // 게임으로 0이 된 경우는 서버가 곧바로 휴식으로 보내므로 여기 걸리지 않는다.
  const collapsed = state.hp <= 0 && !state.in_ward;

  // 지금 손이 비어 있고 Arena 가 아닐 때만 초대 팝업을 띄운다.
  const popupInvite =
    section !== "BLACK" && !busy && !pvpBusy && !collapsed
      ? (pvp?.invites[0] ?? null)
      : null;

  const outOfPlays = state.plays_left <= 0;
  const brokeToday = state.coins < 1;
  const effectiveBet = Math.max(1, Math.min(bet, state.coins));
  const canPlay =
    !busy &&
    !outOfPlays &&
    !brokeToday &&
    !state.in_ward &&
    !state.suspended &&
    state.hp > 0;

  // 하이로우 판이 열려 있는 동안(0단계 포함)은 코인도 횟수도 더 쓰지 않으므로 막지 않는다.
  const ladderRunning = state.hl_bet > 0 && game === "highlow";
  // Arena 는 플레이 횟수를 쓰지 않는다 — 오늘 몫이 다 떨어져도 판은 열려 있다.
  // 정지·휴식·코인 없음은 여기서도 그대로 막는다.
  const blocked = ladderRunning
    ? null
    : blockedState(state, outOfPlays && section !== "BLACK", brokeToday);

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

  /** 상점 RPC 공통 처리. 성공하면 상태를 갱신하고 true 를 돌려준다.
   *  onError 를 주면 실패 문구를 상단 배너 대신 그쪽으로 넘긴다(소지품 팝업). */
  const callStoreRpc = useCallback(
    async (
      fn: string,
      args?: Record<string, unknown>,
      onError?: (message: string) => void,
    ): Promise<PlayerState | null> => {
      if (busyRef.current) return null;
      setError(null);
      setNotice(null);
      setBusy(true);
      const fail = onError ?? setError;

      try {
        const { data, error: rpcError } = await supabase.rpc(fn, args ?? {});
        if (rpcError || !data) {
          fail(toKoreanError(rpcError?.message));
          return null;
        }
        setState(data as PlayerState);
        setRankKey((k) => k + 1);
        return data as PlayerState;
      } catch (e) {
        fail(toKoreanError(e instanceof Error ? e.message : undefined));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [supabase],
  );

  /** 거래가 성사되면 코인·가방이 바뀌므로 서버 상태를 다시 읽는다. */
  const refreshState = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("get_my_state");
      if (data) {
        setState(data as PlayerState);
        setRankKey((k) => k + 1);
      }
    } catch {
      // 조용히 넘긴다 — 다음 행동에서 다시 읽는다.
    }
  }, [supabase]);

  /**
   * 잠금 풀림 장치.
   *
   * busy 를 내리는 곳은 onSettle 하나뿐이고, onSettle 은 게임 컴포넌트의
   * setTimeout 안에서만 불린다. 그 타이머가 어떤 이유로든 못 돌면 화면이
   * 통째로 잠긴 채 새로고침 말고는 길이 없다 — 실제로 "게임 중 화면이
   * 멈춘다"는 신고가 이 모양이었다. 가장 긴 애니메이션이 4.2초(룰렛)이므로
   * 15초는 정상 판정을 자를 위험이 없다.
   */
  useEffect(() => {
    if (!busy) return;
    const t = window.setTimeout(() => {
      setBusy(false);
      setError("응답이 늦어 판을 닫았습니다. 결과를 다시 조회합니다.");
      refreshState();
    }, 15000);
    return () => window.clearTimeout(t);
  }, [busy, refreshState]);

  /** 쓰기·착용·해제 RPC 를 부르고, 무엇이 바뀌었는지 팝업으로 보여준다.
   *  착용 상한(FLEX_LIMIT) 같은 실패도 같은 팝업에 문구 한 줄로 띄운다. */
  const runWithPopup = useCallback(
    async (fn: string, via: UsedVia, code: string, extra?: Record<string, unknown>) => {
      const before = stateRef.current;
      const item = before.items.find((i) => i.code === code);
      const after = await callStoreRpc(fn, { p_code: code, ...extra }, (message) =>
        setUsedPopup({ lines: [message], notes: [] }),
      );
      if (after && item) setUsedPopup(usedItemLines(item, via, before, after));
    },
    [callStoreRpc],
  );

  const doUseItem = useCallback(
    (code: string) => runWithPopup("use_item", "use", code),
    [runWithPopup],
  );

  /** 순수 꾸미기 소모품(음료·향수) — 게임 효과가 없어 확인 팝업 없이 바로 쓴다. */
  const doFlexUse = useCallback(
    (code: string) => runWithPopup("flex_use", "flex_use", code),
    [runWithPopup],
  );

  /** 누군가와 함께 — 내 것 하나를 쓰고, 고른 사람에게도 특이사항이 붙는다. */
  const doUseTogether = useCallback(
    (code: string, mate: string) =>
      runWithPopup("use_together", "together", code, { p_with: mate }),
    [runWithPopup],
  );

  /** 라디오 — 사라지지 않고, 켤 때마다 프로필 표시가 1시간 붙는다. */
  const doRadioOn = useCallback(
    async (code: string) => {
      const ok = await callStoreRpc("radio_on", { p_code: code });
      if (ok) setRadioOpen(true);
    },
    [callStoreRpc],
  );

  /** 운동기구 — 사라지지 않고, 착용하면 프로필 표시가 1시간 붙는다. */
  const doGearOn = useCallback(
    (code: string) => runWithPopup("gear_on", "gear_on", code),
    [runWithPopup],
  );

  const doFlexEquip = useCallback(
    (code: string) => runWithPopup("flex_equip", "flex_equip", code),
    [runWithPopup],
  );


  /** 라이터로 생고구마를 굽는다. 라이터는 닳지 않는다. */
  const doRoast = useCallback(
    (code: string) => runWithPopup("roast_item", "roast", code),
    [runWithPopup],
  );

  /** 우유에 커피·아이스 커피·루이보스티를 섞는다. 팝업은 섞은 음료(drink) 쪽 이름으로 쓴다. */
  const doMix = useCallback(
    async (drink: string) => {
      const before = stateRef.current;
      const item = before.items.find((i) => i.code === drink);
      const after = await callStoreRpc("mix_item", { p_code: MILK, p_with: drink }, (message) =>
        setUsedPopup({ lines: [message], notes: [] }),
      );
      if (after && item) setUsedPopup(usedItemLines(item, "mix", before, after));
    },
    [callStoreRpc],
  );

  const doFlexUnequip = useCallback(
    (code: string) => runWithPopup("flex_unequip", "flex_unequip", code),
    [runWithPopup],
  );

  /** 해제 — 운동기구는 gear_off 로 1시간 상태를 바로 끝낸다(특이사항도 사라진다). */
  const doUnequip = useCallback(
    (code: string) =>
      GEAR.has(code) ? runWithPopup("gear_off", "gear_off", code) : doFlexUnequip(code),
    [runWithPopup, doFlexUnequip],
  );

  /**
   * 게임 횟수 회복분이 하루 상한(bonus_left — 서버가 이미 총량(extra_max) 기준으로
   * 깎아 내려준다)에 걸려 버려지거나 에너지가 이미 가득 차 회복량이 넘칠
   * 상황이면 먼저 확인을 받는다. 그런 게 아니면 바로 쓴다. 순수 꾸미기는
   * 확인 없이 곧장 처리한다.
   */
  const applyItem = useCallback(
    (code: string) => {
      const item = state.items.find((i) => i.code === code);
      if (!item) return;

      const action = itemAction(item);
      if (action === "flex_use") {
        doFlexUse(code);
        return;
      }
      if (action === "flex_equip") {
        doFlexEquip(code);
        return;
      }
      if (action === "radio") {
        doRadioOn(code);
        return;
      }
      if (action === "gear") {
        doGearOn(code);
        return;
      }
      if (action !== "use") return;

      const playsLeft = state.bonus_left;
      const hpRoom = Math.max(0, state.hp_max - state.hp);
      const playsWasted = item.plays > 0 && playsLeft < item.plays;
      const hpWasted = item.heal > 0 && item.heal > hpRoom;
      if (playsWasted || hpWasted) {
        setPendingUse(item);
        return;
      }
      doUseItem(code);
    },
    [
      state.items,
      state.bonus_left,
      state.hp,
      state.hp_max,
      doUseItem,
      doFlexUse,
      doFlexEquip,
      doRadioOn,
      doGearOn,
    ],
  );

  /** 함께 쓸 수 있는 음료·간식이면 먼저 혼자/함께를 묻는다. 명단을 다시 읽어
   *  그 사이 휴식에 들어간 사람을 목록에서 뺀다. */
  const onUseItem = useCallback(
    (code: string) => {
      const item = state.items.find((i) => i.code === code);
      if (item?.shareable) {
        setPendingShare(item);
        reloadRoster();
        return;
      }
      applyItem(code);
    },
    [state.items, applyItem, reloadRoster],
  );

  // 휴식 중이어도 휴식을 줄이는 아이템이 있으면 스스로 풀 수 있다. 가진 것만, 있는
  // 만큼만 안내 줄에 버튼으로 떠서 그 자리에서 바로 쓴다.
  const wardActions =
    blocked?.why === "ward"
      ? state.items
          .filter((i) => i.ward_cut > 0 && i.qty > 0)
          .map((i) => ({ label: i.name, onClick: () => onUseItem(i.code) }))
      : [];
  const blockedRow = blocked ? (
    <BlockedRow blocked={blocked} actions={wardActions} disabled={busy} />
  ) : null;

  const onSellItem = useCallback(
    async (code: string, qty: number) => {
      const ok = await callStoreRpc("sell_item", { p_code: code, p_qty: qty });
      if (ok) setNotice(`${qty}개를 판매했습니다.`);
    },
    [callStoreRpc],
  );

  // 성공 여부를 돌려준다 — 상점이 그걸 보고 "오늘 n/3개" 를 바로 올린다.
  const onBuyItem = useCallback(
    async (code: string, qty: number): Promise<boolean> => {
      const ok = await callStoreRpc("buy_item", { p_code: code, p_qty: qty });
      if (ok) setNotice(`${qty}개를 구매했습니다.`);
      return ok !== null;
    },
    [callStoreRpc],
  );

  /** 프로필 사진을 Storage에 올린 뒤, 경로만 프로필에 반영한다. */
  const onAvatarChange = useCallback(
    async (path: string | null): Promise<boolean> => {
      const ok = await callStoreRpc("set_avatar_path", { p_path: path });
      if (ok) setNotice(path ? "사진을 등록했습니다." : "사진을 지웠습니다.");
      return ok !== null;
    },
    [callStoreRpc],
  );

  /**
   * 상태 메시지·나이·키/체중·소개를 프로필에 반영한다.
   *
   * callStoreRpc 를 거치지 않고 직접 호출한다 — 실패는 Record 쪽 팝업이
   * 자기 자리에서 설명하므로, 이 탭 상단 배너(error)에는 겹쳐 띄우지 않는다.
   */
  const onDetailsChange = useCallback(
    async (args: {
      p_crime: string;
      p_age: number | null;
      p_height_cm: number | null;
      p_weight_kg: number | null;
      p_bio: string;
    }): Promise<boolean> => {
      if (busy) return false;
      setError(null);
      setBusy(true);
      const { data, error: rpcError } = await supabase.rpc(
        "set_profile_details",
        args,
      );
      setBusy(false);
      if (rpcError || !data) return false;
      setState(data as PlayerState);
      setRankKey((k) => k + 1);
      setNotice("프로필을 저장했습니다.");
      return true;
    },
    [busy, supabase],
  );

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const betSlot = (
    <BetControl
      value={effectiveBet}
      min={1}
      max={Math.max(1, state.coins)}
      // 하이로우 판이 열려 있으면(0단계 포함) 베팅액이 이미 걸려 있으므로 잠근다
      disabled={busy || outOfPlays || brokeToday || state.hl_bet > 0}
      onChange={setBet}
      // 서버 공식과 동일: 판돈의 절반, 최대 play_wage 까지.
      wage={Math.min(state.play_wage, Math.floor(effectiveBet / 2))}
    />
  );

  return (
    <div
      data-zone={ZONE[section]}
      // 판에 앉을 수 없을 때는 배너 대신 화면 전체를 한 톤 죽인다.
      // 판이 실제로 있는 Casual·Arena 에서만 죽이고, 프로필·상점은 그대로 둔다.
      style={
        blocked && (section === "WHITE" || section === "BLACK")
          ? { filter: "saturate(.35) brightness(.82)" }
          : undefined
      }
      className="bg-bg-0 relative min-h-dvh px-3 pb-6 pt-3 transition-[filter] duration-300 ease-out max-tab:pb-[520px]"
    >
      <Texture />

      <div className="relative z-1 mx-auto flex w-full max-w-[1400px] flex-col gap-3">
        {pendingUse && (
          <UseWarning
            item={pendingUse}
            state={state}
            busy={busy}
            onConfirm={() => {
              const code = pendingUse.code;
              setPendingUse(null);
              doUseItem(code);
            }}
            onCancel={() => setPendingUse(null)}
          />
        )}

        {pendingShare && (
          <SharePopup
            item={pendingShare}
            mates={mates.filter((m) => m !== state.username)}
            busy={busy}
            onAlone={() => {
              const code = pendingShare.code;
              setPendingShare(null);
              applyItem(code);
            }}
            onTogether={(mate) => {
              const code = pendingShare.code;
              setPendingShare(null);
              doUseTogether(code, mate);
            }}
            onCancel={() => setPendingShare(null)}
          />
        )}

        {collapsed && !pendingUse && (
          <CollapsePopup state={state} busy={busy} onUse={onUseItem} />
        )}

        {state.suspended &&
          !pendingUse &&
          suspendNoticeDismissedFor !== state.suspended_until && (
            <SuspendPopup
              state={state}
              onOpenPetitions={() => setPetitionsOpen(true)}
              onClose={() =>
                setSuspendNoticeDismissedFor(state.suspended_until)
              }
            />
          )}

        {/* 어느 화면에 있든 초대를 놓치지 않는다.
            다만 게임이 돌아가는 중에는 끼어들지 않고, 끝난 뒤에 뜬다.
            Arena 에서는 목록에 이미 보이므로 팝업을 띄우지 않는다. */}
        {popupInvite && (
          <InvitePopup
            invite={popupInvite}
            busy={busy || pvpBusy}
            onAccept={async () => {
              const ok = await pvpCall("pvp_respond", {
                p_match_id: popupInvite.id,
                p_accept: true,
              });
              if (ok) setSection("BLACK");
            }}
            onDecline={() =>
              pvpCall("pvp_respond", {
                p_match_id: popupInvite.id,
                p_accept: false,
              })
            }
          />
        )}


        {radioOpen && (
          <RadioPopup
            supabase={supabase}
            raceChannel={raceVisible}
            onClose={() => setRadioOpen(false)}
          />
        )}

        {usedPopup && (
          <ItemUsedPopup
            lines={usedPopup.lines}
            notes={usedPopup.notes}
            onClose={() => setUsedPopup(null)}
          />
        )}

        <TerminalHeader
          state={state}
          online={online}
          supabase={supabase}
          rooms={rooms}
          roomsLoading={roomsLoading}
          onExit={signOut}
          petitionsOpen={petitionsOpen}
          onPetitionsOpenChange={setPetitionsOpen}
        />

        {/* 구역 탭 — 여섯 개가 한 줄. 375 에서만 3×2 로 접는다. */}
        <TabRail
          items={SECTIONS}
          value={section}
          onChange={(id) => {
            setSection(id);
            setError(null);
            setNotice(null);
            setLast(null);
          }}
          disabled={busy}
          columns="grid-cols-3 tab:grid-cols-6"
        />

        <div className="grid items-start gap-3 desk:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── 메인 ── */}
          <main className="flex min-w-0 flex-col gap-2">
            {notice && (
              <p className="mono-13 border-line-soft border bg-bg-1 px-3 py-2 text-fg">
                {notice}
              </p>
            )}
            {error && (
              <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">
                {error}
              </p>
            )}

            {section === "RECORD" && (
              <Record
                supabase={supabase}
                state={state}
                busy={busy}
                refreshKey={rankKey}
                onUse={onUseItem}
                onSell={onSellItem}
                onUnequip={doUnequip}
                onRoast={doRoast}
                onMix={doMix}
                onRefresh={refreshState}
                onAvatarChange={onAvatarChange}
                onDetailsChange={onDetailsChange}
              />
            )}

            {section === "LABOR" && (
              <Labor
                supabase={supabase}
                state={state}
                busy={busy}
                onRefresh={refreshState}
              />
            )}

            {section === "SEARCH" && (
              <Search
                supabase={supabase}
                state={state}
                busy={busy}
                onRefresh={refreshState}
              />
            )}

            {section === "BLACK" && (
              <>
                {raceVisible && (
                  <TabRail
                    items={[
                      { id: "pvp", label: "1:1 대결" },
                      // 비공개 표시는 경마장 머리줄에 있다 — 반 칸 탭에서는 잘린다.
                      { id: "race", label: "경마장" },
                    ]}
                    value={blackTab}
                    onChange={setBlackTab}
                    disabled={busy}
                    columns="grid-cols-2"
                    height="h-10"
                  />
                )}
                {raceVisible && blackTab === "race" ? (
                  <RaceHall
                    supabase={supabase}
                    state={state}
                    onState={(next) => {
                      setState(next);
                      setRankKey((k) => k + 1);
                    }}
                    onRefresh={refreshState}
                  />
                ) : (
                  <BlackRoom
                    state={state}
                    pvp={pvp}
                    online={online}
                    busy={busy || pvpBusy}
                    call={pvpCall}
                  />
                )}
                {pvpError && (
                  <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">
                    {pvpError}
                  </p>
                )}
              </>
            )}

            {section === "EXCHANGE" && (
              <Exchange
                supabase={supabase}
                state={state}
                busy={busy}
                onBuyItem={onBuyItem}
                onRefresh={refreshState}
              />
            )}

            {section === "WHITE" && (
              <>
                <TabRail
                  items={GAMES.map((g) => ({ id: g.id, label: g.name }))}
                  value={game}
                  onChange={(id) => {
                    setGame(id);
                    setLast(null);
                    setError(null);
                  }}
                  disabled={busy}
                  marker="left"
                  columns="grid-cols-2 tab:grid-cols-4"
                  height="h-10"
                />

                {/* 판이 끝나면 로그에 한 줄 붙는 정도로만 남긴다.
                    자리를 늘 비워 둬서 결과가 떠도 아래 판이 밀리지 않는다.
                    결과가 없을 때는 그 자리에 참가 보상 안내를 대신 띄운다. */}
                <div className="min-h-9">
                  {last ? (
                    <p
                      className={`mono-13 bg-bg-1 flex min-h-9 items-center px-3 ${
                        last.net < 0 ? "text-loss" : "text-fg"
                      }`}
                    >
                      {settleLine(last.net, last.payout)}
                      {bonusTail(last.outcome.bonus_stake, state.luck?.ends_at)}
                    </p>
                  ) : state.luck ? (
                    <p className="mono-13 bg-bg-1 text-brass flex min-h-9 items-center px-3">
                      클로버 판돈 +{state.luck.stake} · {clockText(state.luck.ends_at)}까지
                      (판돈에 얹혀 지급되고, 코인은 판돈만 빠집니다)
                    </p>
                  ) : state.play_wage > 0 ? (
                    <p className="mono-13 bg-bg-1 text-fg-low flex min-h-9 items-center px-3">
                      판돈의 절반만큼, 최대 {state.play_wage}코인까지 참가 보상을 지급합니다.
                    </p>
                  ) : (
                    <p className="bg-bg-1 min-h-9" />
                  )}
                </div>

                {game === "roulette" && (
                  <Roulette
                    bet={effectiveBet}
                    disabled={!canPlay}
                    blockedRow={blockedRow}
                    betSlot={betSlot}
                    onPlay={onPlay}
                    onSettle={onSettle}
                  />
                )}
                {game === "slots" && (
                  <Slots
                    bet={effectiveBet}
                    disabled={!canPlay}
                    blockedRow={blockedRow}
                    betSlot={betSlot}
                    onPlay={onPlay}
                    onSettle={onSettle}
                  />
                )}
                {game === "keno" && (
                  <Keno
                    bet={effectiveBet}
                    disabled={!canPlay}
                    blockedRow={blockedRow}
                    betSlot={betSlot}
                    onPlay={onPlay}
                    onSettle={onSettle}
                  />
                )}
                {game === "highlow" && (
                  <HighLow
                    state={state}
                    bet={effectiveBet}
                    // 판이 열려 있으면(0단계 포함) 코인·횟수를 쓰지 않으므로 잔액이 0이어도 계속할 수 있다
                    disabled={busy || (state.hl_bet === 0 && !canPlay)}
                    blockedRow={blockedRow}
                    betSlot={betSlot}
                    onStart={onStartHighLow}
                    onContinue={onContinue}
                    onCashout={onCashout}
                    onSettle={onSettle}
                  />
                )}
              </>
            )}
          </main>

          {/* ── 우측 3패널. 규칙이 맨 위이고 항상 펼쳐져 있다. ── */}
          <aside className="grid min-w-0 items-start gap-2 tab:grid-cols-3 desk:grid-cols-1">
            <RulesPanel state={state} />
            <LiveFeed supabase={supabase} userId={userId} holdSelf={busy} />
            <Leaderboard
              supabase={supabase}
              username={state.username}
              refreshKey={rankKey}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
