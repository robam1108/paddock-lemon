"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setRules, type Rules } from "@/lib/server-rules";
import {
  SECTIONS,
  toKoreanError,
  type GameId,
  type PlayResult,
  type PlayerState,
  type Section,
} from "@/lib/game";
import { blockedState } from "@/lib/copy";
import { useItemActions } from "@/hooks/useItemActions";
import { usePlayActions } from "@/hooks/usePlayActions";
import { usePresence } from "@/hooks/usePresence";
import { usePvp } from "@/hooks/usePvp";
import CollapsePopup from "./CollapsePopup";
import SuspendPopup from "./SuspendPopup";
import InvitePopup from "./InvitePopup";
import RadioPopup from "./RadioPopup";
import ItemUsedPopup from "./ItemUsedPopup";
import UseWarning from "./UseWarning";
import SharePopup from "./SharePopup";
import LiveFeed from "./LiveFeed";
import Leaderboard from "./Leaderboard";
import TerminalHeader from "./TerminalHeader";
import BetControl from "./BetControl";
import BlackRoom from "./BlackRoom";
import RaceHall from "./race/RaceHall";
import Record from "./Record";
import Shop from "./Shop";
import PrivateTrade from "./Trade";
import CasualTab from "./casino/CasualTab";
import GuestNote from "./casino/GuestNote";
import TabRail from "./ui/TabRail";
import BlockedRow from "./ui/BlockedRow";
import Texture from "./ui/Texture";
import { canSeeRace } from "@/lib/race";

/**
 * 플레이 화면 본체.
 *
 * 밝은 아이보리 라운지 톤 위에 배율과 적립금만 골드로 띄운다.
 * 구역마다 data-zone 이 바뀌면서 같은 유틸리티가 다른 색을 집는다.
 */

/** 구역별 톤(globals.css 의 [data-zone]). */
const ZONE: Record<Section, string | undefined> = {
  RECORD: "record",
  WHITE: "casual",
  BLACK: "black",
  SHOP: "exchange",
  TRADE: "exchange",
};

export default function Casino({
  userId,
  initialState,
  rules,
  guestUntil,
}: {
  userId: string;
  initialState: PlayerState;
  /** 서버 get_rules() — 자식이 그리기 전에 규칙 저장소에 넣는다 */
  rules: Rules;
  /** 게스트 계정이면 지워지는 시각 */
  guestUntil?: string | null;
}) {
  setRules(rules);
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
  // 함께 쓰기 상대 후보 — 지금 접속해 있는 다른 플레이어.
  const mates = useMemo(
    () => online.map((p) => p.username).filter((n) => n !== state.username),
    [online, state.username],
  );
  const [section, setSection] = useState<Section>("RECORD");
  const [game, setGame] = useState<GameId>("roulette");
  // 아레나 안의 판 — 1:1 대전 · 경마장
  const [blackTab, setBlackTab] = useState<"pvp" | "race">("pvp");
  // 경마장은 공개 스위치(get_rules().race.public)가 꺼져 있으면 운영자 계정에게만 보인다.
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
  // 사용 직전 상태 — 팝업의 "이전 → 이후" 를 그릴 때 콜백 안에서 읽는다.
  const stateRef = useRef(state);
  stateRef.current = state;

  // 대전 상태는 어느 화면에 있든 계속 확인한다. 아레나 나 진행 중인
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

  // 지금 손이 비어 있고 아레나 가 아닐 때만 초대 팝업을 띄운다.
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
  // 아레나 는 플레이 횟수를 쓰지 않는다 — 오늘 몫이 다 떨어져도 판은 열려 있다.
  // 정지·휴식·코인 없음은 여기서도 그대로 막는다.
  const blocked = ladderRunning
    ? null
    : blockedState(state, outOfPlays && section !== "BLACK", brokeToday);

  const { onPlay, onStartHighLow, onContinue, onCashout, onSettle } = usePlayActions({
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
  });

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

  const {
    pendingUse,
    setPendingUse,
    pendingShare,
    setPendingShare,
    radioOpen,
    setRadioOpen,
    usedPopup,
    setUsedPopup,
    doUseItem,
    doUseTogether,
    doUnequip,
    applyItem,
    onUseItem,
    onSellItem,
    onBuyItem,
    onAvatarChange,
  } = useItemActions({ state, stateRef, callStoreRpc, setNotice });

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

  /**
   * 상태 메시지·나이·키/체중·소개를 프로필에 반영한다.
   *
   * callStoreRpc 를 거치지 않고 직접 호출한다 — 실패는 Record 쪽 팝업이
   * 자기 자리에서 설명하므로, 이 탭 상단 배너(error)에는 겹쳐 띄우지 않는다.
   */
  const onDetailsChange = useCallback(
    async (args: {
      p_status_message: string;
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
      // 판이 실제로 있는 캐주얼·아레나 에서만 죽이고, 프로필·상점은 그대로 둔다.
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
            mates={mates}
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
            아레나 에서는 목록에 이미 보이므로 팝업을 띄우지 않는다. */}
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

        {guestUntil && <GuestNote expiresAt={guestUntil} />}

        <TerminalHeader
          state={state}
          online={online}
          supabase={supabase}
          onExit={signOut}
          petitionsOpen={petitionsOpen}
          onPetitionsOpenChange={setPetitionsOpen}
        />

        {/* 구역 탭 — 다섯 개가 한 줄. 좁은 화면에서는 3+2 로 접는다. */}
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
          columns="grid-cols-3 tab:grid-cols-5"
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
                onRefresh={refreshState}
                onAvatarChange={onAvatarChange}
                onDetailsChange={onDetailsChange}
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

            {section === "SHOP" && (
              <Shop
                supabase={supabase}
                state={state}
                busy={busy}
                onBuyItem={onBuyItem}
              />
            )}

            {section === "TRADE" && (
              <PrivateTrade
                supabase={supabase}
                state={state}
                busy={busy}
                onRefresh={refreshState}
              />
            )}

            {section === "WHITE" && (
              <CasualTab
                state={state}
                game={game}
                onGameChange={(id) => {
                  setGame(id);
                  setLast(null);
                  setError(null);
                }}
                last={last}
                busy={busy}
                canPlay={canPlay}
                effectiveBet={effectiveBet}
                blockedRow={blockedRow}
                betSlot={betSlot}
                onPlay={onPlay}
                onStartHighLow={onStartHighLow}
                onContinue={onContinue}
                onCashout={onCashout}
                onSettle={onSettle}
              />
            )}
          </main>

          {/* ── 우측 패널: 실시간 소식 · 순위 ── */}
          <aside className="grid min-w-0 items-start gap-2 tab:grid-cols-2 desk:grid-cols-1">
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
