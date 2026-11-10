"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Presence } from "@/hooks/usePresence";
import type { PlayerState } from "@/lib/game";
import { identityOf } from "@/lib/identity";
import type { Room } from "@/lib/rooms";
import { useAdminPending } from "@/hooks/useAdminPending";
import { usePetitionPending } from "@/hooks/usePetitionPending";
import {
  FORM_LINE,
  FORM_LINE_SHORT,
  LABEL,
  WATCH_NOTE,
} from "@/lib/copy";
import GuidePopup from "./GuidePopup";
import PetitionBox from "./PetitionBox";
import HpBar from "./HpBar";
import MonoLabel from "./ui/MonoLabel";
import PendingDot from "./ui/PendingDot";

/**
 * 서식 K-77 상단부.
 *
 * 두 단이다. 위 32px 은 시설이 찍어 둔 서식 스트립 — 누가 언제 무엇을 했는지
 * 남기려고 있는 줄이지, 사용자를 위한 줄이 아니다. 아래 84px 이 배급 행이다.
 * 체력·코인·배정이 나란히 놓이는데, 셋 다 권리가 아니라 배급이라 같은 모양이다.
 *
 * 구획은 박스가 아니라 1px 세로 구분선으로만 나눈다.
 */

function useSessionClock(): string {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor(sec / 60) % 60;
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function Divider() {
  return <div className="bg-line-soft my-3.5 hidden w-px desk:block" />;
}

export default function TerminalHeader({
  state,
  online,
  supabase,
  rooms,
  roomsLoading,
  onExit,
  petitionsOpen,
  onPetitionsOpenChange,
}: {
  state: PlayerState;
  online: Presence[];
  supabase: SupabaseClient;
  /** 안내문의 방 배치도가 그대로 받아 쓴다 */
  rooms: Room[];
  /** 아직 명단을 못 읽었으면 true. 배정된 사람이 0명인 것과 구분하기 위함. */
  roomsLoading: boolean;
  onExit: () => void;
  /** 정지 통보 팝업이 "이의 제기"로 진정함을 직접 열 수 있도록 상위(Casino)가 들고 있다 */
  petitionsOpen: boolean;
  onPetitionsOpenChange: (open: boolean) => void;
}) {
  const clock = useSessionClock();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const me = identityOf(state.username);
  const { pending: adminPending } = useAdminPending(supabase, state.is_admin);
  const { pending: petitionPending, setPending: setPetitionPending } =
    usePetitionPending(supabase, !state.is_admin);

  // 0명이면 목록 영역 자체를 렌더하지 않는다. 숨기는 게 아니라 없다.
  const hasRoster = online.length > 0;

  return (
    <header className="border-line-soft border bg-bg-1">
      {/* ── 서식 스트립 32px ── */}
      <div className="scanline border-line-soft flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-3.5 py-1.5">
        <MonoLabel tone="low">
          <span className="hidden tab:inline">{FORM_LINE}</span>
          <span className="tab:hidden">{FORM_LINE_SHORT}</span>
        </MonoLabel>

        <div className="flex items-center gap-3">
          {hasRoster ? (
            <button
              type="button"
              onClick={() => setRosterOpen((v) => !v)}
              aria-expanded={rosterOpen}
              className="label-11 text-fg-mid hover:text-fg"
            >
              접속 {online.length} {rosterOpen ? "▾" : "▸"}
            </button>
          ) : (
            <MonoLabel tone="low">접속 0</MonoLabel>
          )}
          <MonoLabel tone="low">세션 {clock}</MonoLabel>
          <MonoLabel tone="low" className="hidden tab:inline">
            {WATCH_NOTE}
          </MonoLabel>
        </div>
      </div>

      {/* ── 접속자 목록 — 인원수에 접힌다 ── */}
      {hasRoster && rosterOpen && (
        <div className="border-line-soft flex flex-wrap items-center gap-2 border-b bg-bg-0 px-3.5 py-2">
          <MonoLabel>{LABEL.roster}</MonoLabel>
          {online.map((p) => {
            const mine = p.username === state.username;
            const id = identityOf(p.username);
            return (
              <span
                key={p.username}
                className={`mono-13 px-2.5 py-1 ${
                  mine
                    ? "border-brass-line border bg-brass-fill text-fg-hi"
                    : "bg-surface text-fg-mid"
                }`}
              >
                {id.no} {p.username}
                {mine && " (나)"}
              </span>
            );
          })}
        </div>
      )}

      {/* ── 배급 행 84px ── */}
      <div className="flex flex-col items-stretch gap-y-3 px-3.5 py-3 desk:min-h-21 desk:flex-row desk:flex-nowrap desk:gap-x-0 desk:py-0">
        {/* 신원 */}
        <div className="flex items-center gap-3 desk:pr-5">
          <div className="border-line flex w-[74px] shrink-0 flex-col items-center justify-center gap-1 border bg-surface py-2">
            <MonoLabel tone="low">{LABEL.no}</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">{me.no}</span>
          </div>
          <div className="min-w-0">
            <MonoLabel tone="low">
              수용 {me.no} · {state.cell ?? "-"}
            </MonoLabel>
            {/* 형기는 전원 무기 징역이라 여기 적으면 정보가 아니라 잡음이다.
                신상 탭의 신원표 카드가 유일하게 적는다. */}
            <span className="title-19 text-fg-hi mt-1 block truncate">
              {state.username}
            </span>
          </div>
        </div>

        <Divider />

        {/* 체력 배급 */}
        <div className="min-w-[220px] flex-1 desk:self-center desk:px-5">
          <HpBar
            hp={state.hp}
            max={state.hp_max}
            status={state.hp_status}
          />
        </div>

        <Divider />

        {/* 코인 · 배정 · 종료 — 좁은 화면에서 버튼이 넘치지 않게 줄바꿈 허용 */}
        <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-3 desk:flex-none desk:pl-5">
          <div className="flex flex-col gap-1">
            <MonoLabel>{LABEL.coins}</MonoLabel>
            <span className="num-lg text-brass tabular-nums">
              {state.coins}
            </span>
          </div>

          <div className="bg-line-soft my-3.5 w-px self-stretch" />

          <div className="flex flex-col gap-1">
            <MonoLabel>{LABEL.ration}</MonoLabel>
            <span className="num-md text-fg-hi tabular-nums">
              {state.plays_left}
              <span className="text-fg-mid text-[15px] font-normal">
                /{state.play_limit}
              </span>
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 self-center">
            {/* 관리자는 진정함을 관리자 단말에서 보므로 이 자리엔 진정함
                버튼을 두지 않는다. 양쪽 다 확인할 게 있으면 초록 점만 얹는다 —
                관리자는 미답변 대기, 수감자는 도착한 관리자 답변. */}
            {state.is_admin ? (
              <Link
                href="/admin"
                className="label-11 border-line state-fade border bg-surface px-3 py-2.5 text-fg-mid hover:text-fg-hi"
              >
                {LABEL.admin}
                {adminPending && <PendingDot />}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => onPetitionsOpenChange(true)}
                className="label-11 border-line state-fade border bg-surface px-3 py-2.5 text-fg-mid hover:text-fg-hi"
              >
                {LABEL.petitions}
                {petitionPending && <PendingDot label="관리자 답변 있음" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="label-11 border-line state-fade border bg-surface px-3 py-2.5 text-fg-mid hover:text-fg-hi"
            >
              {LABEL.guide}
            </button>
            <button
              type="button"
              onClick={onExit}
              className="label-11 border-line state-fade w-24 border bg-surface py-2.5 text-fg-mid hover:text-fg-hi"
            >
              {LABEL.exit}
            </button>
          </div>
        </div>
      </div>

      {guideOpen && (
        <GuidePopup
          rooms={rooms}
          roomsLoading={roomsLoading}
          username={state.username}
          onClose={() => setGuideOpen(false)}
        />
      )}

      {petitionsOpen && (
        <PetitionBox
          onClose={() => onPetitionsOpenChange(false)}
          onAnswered={setPetitionPending}
        />
      )}
    </header>
  );
}
