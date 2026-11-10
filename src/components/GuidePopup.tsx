"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GUIDE_SECTIONS,
  type GuideSection,
  type GuideSectionId,
} from "@/lib/guide";
import { LABEL } from "@/lib/copy";
import type { Room } from "@/lib/rooms";
import MonoLabel from "./ui/MonoLabel";
import TabRail from "./ui/TabRail";

/** `**강조**` 구간을 굵게 렌더링한다. 문안(guide.ts)에서만 쓰는 최소 마크업. */
function renderWithBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="text-fg-hi font-bold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/**
 * 헤더 + 탭레일 + 본문. 실제로 보이는 팝업 박스와, 높이만 재는 숨은
 * 복제본(아래 GuidePopup 참고)이 이 마크업을 함께 쓴다.
 */
function GuideBox({
  section,
  tab,
  onTabChange,
  onClose,
  rooms,
  roomsLoading,
  username,
}: {
  section: GuideSection;
  tab: GuideSectionId;
  onTabChange: (id: GuideSectionId) => void;
  onClose: () => void;
  rooms: Room[];
  roomsLoading: boolean;
  username: string;
}) {
  return (
    <>
      <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
        <MonoLabel>{LABEL.guide}</MonoLabel>
        <button
          type="button"
          onClick={onClose}
          className="label-11 text-fg-mid hover:text-fg-hi"
        >
          닫기
        </button>
      </div>

      {/* 네 개가 한 줄. 375 에서만 2×2 로 접는다(Casino.tsx 구역 탭과 동일 패턴). */}
      <TabRail
        items={GUIDE_SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        value={tab}
        onChange={onTabChange}
        columns="grid-cols-2 tab:grid-cols-4"
      />

      <div className="flex flex-col gap-2 p-4">
        {section.photo && section.photoPosition !== "bottom" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={section.photo.src}
            alt={section.photo.alt}
            style={{
              aspectRatio: `${section.photo.width} / ${section.photo.height}`,
            }}
            className="border-line w-full border"
          />
        )}

        {section.paragraphs.map((p, i) =>
          section.id === "world" && i === 0 ? (
            <p key={i} className="text-fg-hi text-[20px] font-bold leading-snug">
              {p}
            </p>
          ) : (
            <p key={i} className="body-15 text-fg-mid">
              {renderWithBold(p)}
            </p>
          ),
        )}

        {section.photo && section.photoPosition === "bottom" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={section.photo.src}
            alt={section.photo.alt}
            style={{
              aspectRatio: `${section.photo.width} / ${section.photo.height}`,
            }}
            className="border-line w-full border"
          />
        )}

        {section.id === "rooms" && (
          <ul className="mt-2 flex flex-col gap-1">
            {roomsLoading && (
              <li className="mono-13 text-fg-low py-2">불러오는 중…</li>
            )}
            {!roomsLoading && rooms.length === 0 && (
              <li className="mono-13 text-fg-low py-2">등재된 배정 없음</li>
            )}
            {rooms.map((r) => {
              const mine = r.members.includes(username);
              return (
                <li
                  key={r.cell}
                  className={`mono-13 grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-2 py-1.5 ${
                    mine
                      ? "border-brass-line border bg-brass-fill"
                      : "bg-surface"
                  }`}
                >
                  <span
                    className={`tabular-nums ${mine ? "text-fg-hi" : "text-fg-low"}`}
                  >
                    {r.cell}
                  </span>
                  {/* 이름이 길면 잘라내지 않고 줄을 늘린다. 대장은 다 적는다. */}
                  <span className={mine ? "text-fg-hi" : "text-fg"}>
                    {r.members.join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

const LAYOUT_SECTION =
  GUIDE_SECTIONS.find((s) => s.id === "layout") ?? GUIDE_SECTIONS[0];

/** 컨테이너 상하 여백(p-4)과 같은 값. 앵커 높이로 marginTop 을 계산할 때 뺀다. */
const OVERLAY_GAP = "2rem";

/**
 * 안내문 — 세계관·시설 구조도·방 배치도·일정표를 탭으로 묶어 보여주는 문서
 * 팝업. Record.tsx 의 관계 기록 팝업과 같은 오버레이 뼈대를 쓴다.
 *
 * 네 탭 중 방 배치도만 문구 아래에 실제 명단이 붙는다. 나머지 셋은 정적이다.
 *
 * 탭마다 문단 수·사진 유무·명단 길이가 달라 박스 높이가 들쭉날쭉하다.
 * 그대로 수직 중앙 정렬하면 탭을 바꿀 때마다 박스가 위아래로 흔들리므로,
 * "시설 구조도" 탭 기준으로만 박스의 시작(top) 위치를 고정한다 — 화면
 * 밖에 숨겨 둔 구조도 탭 복제본의 높이를 재서 그 위치를 계산하고,
 * 실제 박스에는 그 위치를 만드는 marginTop 만 준다. 높이 자체는 탭마다
 * 계속 다르게 두어(짧은 탭은 여백, 긴 탭은 기존처럼 스크롤) 시작 위치만
 * 고정한다.
 */
export default function GuidePopup({
  rooms,
  roomsLoading,
  username,
  onClose,
}: {
  rooms: Room[];
  /** 아직 명단을 못 읽었으면 true. 배정된 사람이 0명인 것과 구분하기 위함. */
  roomsLoading: boolean;
  /** 내 방 한 줄을 놋쇠로 집어 준다 */
  username: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<GuideSectionId>(GUIDE_SECTIONS[0].id);
  const active = GUIDE_SECTIONS.find((s) => s.id === tab) ?? GUIDE_SECTIONS[0];

  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorHeight, setAnchorHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const measure = () => setAnchorHeight(el.offsetHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="bg-bg-0/80 fixed inset-0 z-50 grid grid-cols-[minmax(0,28rem)] items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      {/* 시설 구조도 탭이 혼자 렌더링됐을 때의 높이만 재는 숨은 복제본.
          실제 박스와 같은 그리드 칸에 겹쳐 둬서 폭 계산이 항상 동일하다. */}
      <div
        aria-hidden
        inert
        ref={anchorRef}
        className="border-line max-h-[85dvh] invisible col-start-1 row-start-1 w-full max-w-md overflow-y-auto border"
      >
        <GuideBox
          section={LAYOUT_SECTION}
          tab={LAYOUT_SECTION.id}
          onTabChange={() => {}}
          onClose={() => {}}
          rooms={rooms}
          roomsLoading={roomsLoading}
          username={username}
        />
      </div>

      <div
        className="border-line max-h-[85dvh] w-full max-w-md col-start-1 row-start-1 overflow-y-auto border bg-bg-1"
        style={
          anchorHeight != null
            ? {
                marginTop: `max(0px, calc((100dvh - ${OVERLAY_GAP} - ${anchorHeight}px) / 2))`,
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        <GuideBox
          section={active}
          tab={tab}
          onTabChange={setTab}
          onClose={onClose}
          rooms={rooms}
          roomsLoading={roomsLoading}
          username={username}
        />
      </div>
    </div>,
    document.body,
  );
}
