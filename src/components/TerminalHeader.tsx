"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Presence } from "@/hooks/usePresence";
import type { PlayerState } from "@/lib/game";
import { useAdminPending } from "@/hooks/useAdminPending";
import { usePetitionPending } from "@/hooks/usePetitionPending";
import { LABEL } from "@/lib/copy";
import {
  SITE_LINE,
  SITE_LINE_SHORT,
  LIVE_NOTE,
} from "@/lib/site";
import GuidePopup from "./GuidePopup";
import PetitionBox from "./PetitionBox";
import HpBar from "./HpBar";
import MonoLabel from "./ui/MonoLabel";
import PendingDot from "./ui/PendingDot";

/**
 * 상단 헤더.
 *
 * 두 단이다. 위 32px 은 사이트 이름과 접속 시간을 적은 띠,
 * 아래 84px 이 상태 행이다.
 * 에너지·코인·남은 판이 나란히 같은 모양으로 놓인다.
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
  onExit,
  petitionsOpen,
  onPetitionsOpenChange,
}: {
  state: PlayerState;
  online: Presence[];
  supabase: SupabaseClient;
  onExit: () => void;
  /** 정지 통보 팝업이 "문의하기"로 피드백을 직접 열 수 있도록 상위(Casino)가 들고 있다 */
  petitionsOpen: boolean;
  onPetitionsOpenChange: (open: boolean) => void;
}) {
  const clock = useSessionClock();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const { pending: adminPending } = useAdminPending(supabase, state.is_admin);
  const { pending: petitionPending, setPending: setPetitionPending } =
    usePetitionPending(supabase, !state.is_admin);

  // 0명이면 목록 영역 자체를 렌더하지 않는다. 숨기는 게 아니라 없다.
  const hasRoster = online.length > 0;

  return (
    <header className="border-line-soft border bg-bg-1">
      {/* ── 사이트 띠 32px ── */}
      <div className="scanline border-line-soft flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-3.5 py-1.5">
        <MonoLabel tone="low">
          <span className="hidden tab:inline">{SITE_LINE}</span>
          <span className="tab:hidden">{SITE_LINE_SHORT}</span>
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
            {LIVE_NOTE}
          </MonoLabel>
        </div>
      </div>

      {/* ── 접속자 목록 — 인원수에 접힌다 ── */}
      {hasRoster && rosterOpen && (
        <div className="border-line-soft flex flex-wrap items-center gap-2 border-b bg-bg-0 px-3.5 py-2">
          <MonoLabel>{LABEL.roster}</MonoLabel>
          {online.map((p) => {
            const mine = p.username === state.username;
            return (
              <span
                key={p.username}
                className={`mono-13 px-2.5 py-1 ${
                  mine
                    ? "border-brass-line border bg-brass-fill text-fg-hi"
                    : "bg-surface text-fg-mid"
                }`}
              >
                {p.username}
                {mine && " (나)"}
              </span>
            );
          })}
        </div>
      )}

      {/* ── 상태 행 84px ── */}
      <div className="flex flex-col items-stretch gap-y-3 px-3.5 py-3 desk:min-h-21 desk:flex-row desk:flex-nowrap desk:gap-x-0 desk:py-0">
        {/* 플레이어 — 아이디만 적는다. 상태 메시지는 프로필 카드에만 있다. */}
        <div className="flex min-w-0 items-center desk:pr-5">
          <span className="title-19 text-fg-hi block truncate">
            {state.username}
          </span>
        </div>

        <Divider />

        {/* 에너지 */}
        <div className="min-w-[220px] flex-1 desk:self-center desk:px-5">
          <HpBar
            hp={state.hp}
            max={state.hp_max}
            status={state.hp_status}
          />
        </div>

        <Divider />

        {/* 코인 · 남은 판 · 로그아웃 — 좁은 화면에서 버튼이 넘치지 않게 줄바꿈 허용 */}
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
            {/* 관리자는 피드백을 관리자 화면에서 보므로 이 자리엔 피드백
                버튼을 두지 않는다. 양쪽 다 확인할 게 있으면 초록 점만 얹는다 —
                관리자는 미답변 대기, 플레이어는 도착한 관리자 답변. */}
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
        <GuidePopup onClose={() => setGuideOpen(false)} />
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
