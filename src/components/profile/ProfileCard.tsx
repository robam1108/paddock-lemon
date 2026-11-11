"use client";

import { healthNote } from "@/lib/copy";
import { SITE_NAME } from "@/lib/site";
import MonoLabel from "../ui/MonoLabel";
import Panel from "../ui/Panel";
import type { RelationRow } from "./shared";

/**
 * 압축 표의 한 칸. 라벨이 위, 값이 아래로 붙는다.
 * 칸끼리의 1px 선은 각 칸이 아니라 감싼 격자의 gap 이 낸다.
 */
function Cell({
  label,
  wide,
  quiet,
  children,
}: {
  label: string;
  /** 비고처럼 한 줄을 통째로 쓰는 칸 */
  wide?: boolean;
  /** 예외 표기 칸. 값을 키우지 않는다. */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`scanline-faint bg-bg-1 flex min-w-0 flex-col gap-1 p-3 tab:p-4 ${wide ? "col-span-2" : ""
        }`}
    >
      <MonoLabel tone="low">{label}</MonoLabel>
      <div className={quiet ? "body-15 text-fg" : "title-19 text-fg-hi"}>
        {children}
      </div>
    </div>
  );
}

/**
 * 프로필 카드 — 내 정보 탭과 친구 탭의 상세 보기가 함께 쓰는 표현 컴포넌트.
 * `photo`/`footer` 를 넘기지 않으면(= 남의 프로필을 볼 때) 사진 교체·수정
 * 버튼이 저절로 빠진다.
 */
export default function ProfileCard({
  username,
  avatarUrl,
  status_message,
  age,
  heightCm,
  weightKg,
  hp,
  hpMax,
  bio,
  flex,
  relations,
  notes,
  photo,
  footer,
}: {
  username: string;
  avatarUrl: string | null;
  status_message: string | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  hp: number;
  hpMax: number;
  bio: string | null;
  /** 프로필 표시 문장들. 없으면 빈 배열.
   *  `time` 은 본인 프로필에서만 채워 넣는다 — 소모형 표시의 남은 시간은
   *  본인에게만 보이고, 남의 프로필에는 문장만(시간 없이) 나간다. */
  flex: { text: string; time?: string }[];
  /** 관리자가 승인한 관계만. 신청 중·반려는 여기 넣지 않는다. */
  relations: RelationRow[];
  /** 상태 표시(recordNotes). 남의 프로필에는 넘기지 않는다. */
  notes?: string;
  /** 내 프로필일 때만: 사진 칸에 교체 버튼을 끼운다. 없으면 정적 사진 칸. */
  photo?: React.ReactNode;
  /** 내 프로필일 때만: 소개 칸 아래 우측에 붙는 '수정' 버튼. */
  footer?: React.ReactNode;
}) {
  const flexLines = flex;
  const heightWeight =
    heightCm != null && weightKg != null ? `${heightCm} / ${weightKg}` : "-";
  const extraNote = notes && notes !== "없음" ? notes : null;

  return (
    <div className="grid grid-cols-1 gap-2 tab:grid-cols-[220px_minmax(0,1fr)]">
      {/* ── 프로필 카드 ── */}
      <Panel className="flex flex-col gap-3 text-center">
        <MonoLabel tone="low">{SITE_NAME} 프로필</MonoLabel>

        {photo ?? (
          <div className="scanline-faint border-line relative mx-auto flex h-[152px] w-[132px] items-center justify-center overflow-hidden border border-dashed bg-bg-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="mono-13 text-fg-low">사진 없음</span>
            )}
          </div>
        )}

        <span className="title-19 text-fg-hi truncate">{username}</span>

        {/* 상태 메시지 */}
        <div className="border-line-soft mt-auto flex flex-col gap-1 border-t pt-3">
          <span className="mono-13 text-fg-mid truncate">{status_message || "상태 메시지 없음"}</span>
        </div>
      </Panel>

      {/* ── 나이 · 키/체중 · 컨디션 · 소개 ── */}
      <div className="flex flex-col gap-2">
        <div className="border-line-soft grid grid-cols-2 gap-px border bg-line-soft">
          <Cell label="나이">
            {age != null ? (
              <>
                <span className="tabular-nums">{age}</span>세
              </>
            ) : (
              "-"
            )}
          </Cell>
          <Cell label="키 / 체중">{heightWeight}</Cell>
          <Cell label="컨디션" wide quiet>
            <span className="body-15 text-fg">{healthNote(hp, hpMax)}</span>
            {extraNote && (
              <span className="body-15 text-fg-low mt-0.5 block">
                {extraNote}
              </span>
            )}
          </Cell>
          <Cell label="소개" wide quiet>
            {bio ? (
              <span className="whitespace-pre-line break-words">{bio}</span>
            ) : (
              "없음"
            )}
          </Cell>
          <Cell label="상태" wide quiet>
            {flexLines.length === 0 ? (
              "없음"
            ) : (
              <ul className="flex flex-col gap-0.5">
                {flexLines.map((line, idx) => (
                  <li key={idx} className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words">{line.text}</span>
                    {line.time && (
                      <span className="mono-13 text-fg-low shrink-0">
                        {line.time}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Cell>
          <Cell label="친구" wide quiet>
            {relations.length === 0 ? (
              "없음"
            ) : (
              <ul className="flex flex-col gap-0.5">
                {relations.map((r) => (
                  <li key={r.id} className="break-words">
                    <span className="text-fg-mid">
                      {r.other}
                    </span>
                    <span className="text-fg-low"> · </span>
                    {r.body}
                  </li>
                ))}
              </ul>
            )}
          </Cell>
        </div>

        {footer && <div className="flex justify-end">{footer}</div>}
      </div>
    </div>
  );
}
