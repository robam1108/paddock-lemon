"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import {
  toKoreanError,
  type PetitionStatus,
  type PetitionSummary,
  type PetitionThread,
} from "@/lib/game";
import { LABEL, PETITION_NOTE } from "@/lib/copy";
import Panel from "./ui/Panel";
import MonoLabel from "./ui/MonoLabel";
import PetitionPhoto from "./ui/PetitionPhoto";
import {
  usePhotoAttach,
  uploadPetitionPhoto,
  PhotoAttachControl,
} from "./ui/PhotoAttach";

/**
 * 진정함 — 안내문(GuidePopup)과 같은 오버레이 뼈대를 쓰는 팝업.
 * 목록은 본인 것만 보인다. 상세의 답변자 표기는 서버가 이미 정리해서
 * 주므로("관리자" 또는 본인 이름), 여기서는 그대로 찍기만 한다.
 */

const PETITION_STATUS_LABEL: Record<PetitionStatus, string> = {
  open: "미답변",
  answered: "답변 완료",
  closed: "종결",
};

const FIELD =
  "mono-13 w-full border border-line bg-surface px-3 py-2.5 text-fg-hi outline-none placeholder:text-fg-low focus:border-brass-line";
const PRIMARY =
  "state-fade label-11 shrink-0 border border-brass-line bg-brass-fill px-5 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";
const SMALL =
  "state-fade label-11 shrink-0 border border-line bg-surface px-3 py-2 text-fg-mid enabled:hover:text-fg-hi";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PetitionBox({
  onClose,
  onAnswered,
}: {
  onClose: () => void;
  /**
   * 관리자 답변이 달린 진정이 있는지 헤더에 알린다. 헤더도 따로 60초마다
   * 보지만, 여기서 답변을 달면 상태가 바로 뒤집히므로 즉시 올려 준다.
   */
  onAnswered?: (has: boolean) => void;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [petitions, setPetitions] = useState<PetitionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const submitPhoto = usePhotoAttach();

  const [thread, setThread] = useState<PetitionThread | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const replyPhoto = usePhotoAttach();

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("petition_list");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setPetitions((data ?? []) as PetitionSummary[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // 접수·답변·새로고침 모두 setPetitions 를 거치므로 여기 한 곳에서만 보고한다.
  useEffect(() => {
    onAnswered?.(petitions.some((p) => p.status === "answered"));
  }, [petitions, onAnswered]);

  const openThread = useCallback(
    async (id: number) => {
      const { data, error: e } = await supabase.rpc("petition_thread", {
        p_id: id,
      });
      if (e || !data) {
        setError(toKoreanError(e?.message));
        return;
      }
      setThread(data as PetitionThread);
      setReplyBody("");
      replyPhoto.reset();
    },
    [supabase, replyPhoto],
  );

  async function createPetition() {
    const s = subject.trim();
    const b = body.trim();
    if (!s || !b || busy) return;

    setBusy(true);
    setError(null);

    let imagePath: string | null = null;
    if (submitPhoto.file) {
      try {
        imagePath = await uploadPetitionPhoto(supabase, submitPhoto.file);
      } catch {
        setBusy(false);
        setError("사진을 올리지 못했습니다.");
        return;
      }
    }

    const { data, error: e } = await supabase.rpc("petition_create", {
      p_subject: s,
      p_body: b,
      p_image_path: imagePath,
    });
    setBusy(false);

    if (e) {
      if (imagePath) await supabase.storage.from("petitions").remove([imagePath]);
      setError(toKoreanError(e.message));
      return;
    }
    setPetitions((data ?? []) as PetitionSummary[]);
    setSubject("");
    setBody("");
    submitPhoto.reset();
  }

  async function sendReply() {
    const b = replyBody.trim();
    if (!thread || !b || busy) return;

    setBusy(true);
    setError(null);

    let imagePath: string | null = null;
    if (replyPhoto.file) {
      try {
        imagePath = await uploadPetitionPhoto(supabase, replyPhoto.file);
      } catch {
        setBusy(false);
        setError("사진을 올리지 못했습니다.");
        return;
      }
    }

    const { data, error: e } = await supabase.rpc("petition_reply", {
      p_id: thread.id,
      p_body: b,
      p_image_path: imagePath,
    });
    setBusy(false);

    if (e || !data) {
      if (imagePath) await supabase.storage.from("petitions").remove([imagePath]);
      setError(toKoreanError(e?.message));
      return;
    }
    setThread(data as PetitionThread);
    setReplyBody("");
    replyPhoto.reset();
    load();
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="border-line max-h-[85dvh] w-full max-w-2xl overflow-y-auto border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
          <MonoLabel>{LABEL.petitions}</MonoLabel>
          <button
            type="button"
            onClick={onClose}
            className="label-11 text-fg-mid hover:text-fg-hi"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
        <p className="mono-13 text-fg-low">{PETITION_NOTE}</p>

        {error && (
          <p className="mono-13 border border-loss/50 bg-bg-1 px-3.5 py-2.5 text-loss">
            {error}
          </p>
        )}

        {/* ── 새 진정 ── */}
        <Panel className="flex flex-col gap-2">
          <h2 className="title-19 text-fg-hi">진정 접수</h2>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={60}
            placeholder="제목"
            className={FIELD}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="내용을 적어라. 본인과 관리자만 볼 수 있다."
            className={`${FIELD} min-h-24 resize-none`}
          />
          <div className="flex items-end justify-end gap-2">
            <PhotoAttachControl attach={submitPhoto} disabled={busy} />
            <button
              disabled={busy || !subject.trim() || !body.trim()}
              onClick={createPetition}
              className={PRIMARY}
            >
              접수
            </button>
          </div>
        </Panel>

        {/* ── 내 진정 목록 ── */}
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="title-19 text-fg-hi">
              접수한 진정 {petitions.length}건
            </h2>
            <button onClick={load} className={`${SMALL} ml-auto`}>
              새로고침
            </button>
          </div>

          {petitions.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              접수한 진정이 없다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {petitions.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => openThread(p.id)}
                    className="bg-surface state-fade flex w-full flex-col gap-1 p-3 text-left hover:bg-surface-hi"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={`body-15 ${p.status === "closed" ? "text-fg-low" : "text-fg-hi"}`}
                      >
                        {p.subject}
                      </span>
                      <MonoLabel
                        tone={
                          p.status === "open"
                            ? "dim"
                            : p.status === "answered"
                              ? "mid"
                              : "low"
                        }
                      >
                        {PETITION_STATUS_LABEL[p.status]}
                      </MonoLabel>
                      <MonoLabel tone="low" className="ml-auto">
                        {formatTime(p.last_message_at)}
                      </MonoLabel>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── 상세 · 답변 ── */}
        {thread && (
          <Panel className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2
                className={`title-19 truncate ${thread.status === "closed" ? "text-fg-low" : "text-fg-hi"}`}
              >
                {thread.subject}
              </h2>
              <MonoLabel
                tone={
                  thread.status === "open"
                    ? "dim"
                    : thread.status === "answered"
                      ? "mid"
                      : "low"
                }
              >
                {PETITION_STATUS_LABEL[thread.status]}
              </MonoLabel>
              <button
                onClick={() => setThread(null)}
                className={`${SMALL} ml-auto`}
              >
                닫기
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {thread.messages.map((m) => (
                <li
                  key={m.id}
                  className={`p-3 ${
                    m.is_admin_reply
                      ? "border-brass-line border bg-brass-fill"
                      : "bg-surface"
                  }`}
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span
                      className={`label-11 ${
                        m.is_admin_reply ? "text-brass" : "text-fg-mid"
                      }`}
                    >
                      {m.author}
                    </span>
                    <MonoLabel tone="low" className="ml-auto">
                      {formatTime(m.created_at)}
                    </MonoLabel>
                  </div>
                  <p className="body-15 text-fg whitespace-pre-wrap">
                    {m.body}
                  </p>
                  {m.image_path && (
                    <PetitionPhoto supabase={supabase} path={m.image_path} />
                  )}
                </li>
              ))}
            </ul>

            {thread.status === "closed" ? (
              <p className="mono-13 text-fg-low border-line border border-dashed px-3 py-3 text-center">
                종결된 진정이라 답변을 더 달 수 없다.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="답변을 적어라."
                  className={`${FIELD} min-h-20 resize-none`}
                />
                <div className="flex items-end justify-end gap-2">
                  <PhotoAttachControl attach={replyPhoto} disabled={busy} />
                  <button
                    disabled={busy || !replyBody.trim()}
                    onClick={sendReply}
                    className={PRIMARY}
                  >
                    등록
                  </button>
                </div>
              </div>
            )}
          </Panel>
        )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
