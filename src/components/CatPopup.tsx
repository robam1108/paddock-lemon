"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toKoreanError, type CatActResult } from "@/lib/game";
import { catActLines, catMeetLines, catName, catNamedLines, catSeed } from "@/lib/copy";
import MonoLabel from "./ui/MonoLabel";

/**
 * 탐색 고양이 팝업.
 *
 * 고양이 자리를 고른 날 탐색 결과 대신 뜬다. 간식주기 · 쓰다듬기 중 하나만
 * 누를 수 있고(public.cat_act), 누르면 고양이는 떠난다. 쓰다듬기에 처음 성공하면
 * 같은 팝업에서 내가 부를 이름을 적는다(public.cat_set_name — 사람마다 따로).
 *
 * mode = "name" 은 이름 지을 권리만 남아 있을 때(팝업을 닫았다가 다시 온 경우)
 * 곧장 이름 칸부터 연다.
 */

type Pose = "idle" | "munch" | "purr" | "flee";

const POSE_CLASS: Record<Pose, string> = {
  // 고양이는 가만히 있는다 — 도망칠 때만 움직인다. 기분은 하트·말풍선이 대신 보여준다.
  idle: "",
  munch: "",
  purr: "",
  flee: "cat-flee",
};

const button =
  "state-fade label-11 border-line flex-1 border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi disabled:opacity-50";

export default function CatPopup({
  supabase,
  mode,
  place,
  name,
  hpCut,
  snacks,
  onChanged,
  onClose,
}: {
  supabase: SupabaseClient;
  mode: "meet" | "name";
  /** 지금 가진 고양이 간식(츄르 · 날생선). 두 종류 이상이면 간식주기에서 고른다 */
  snacks: { code: string; name: string; qty: number }[];
  /** SEARCH_PLACES 의 id — 장소마다 고양이가 있는 자리가 다르다 */
  place: string;
  /** 지금 고양이 이름. 없으면 null */
  name: string | null;
  hpCut: number;
  /** 츄르가 줄었거나 이름이 바뀌었다 — 바깥에서 다시 읽는다 */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<CatActResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canName, setCanName] = useState(mode === "name");
  const [draft, setDraft] = useState("");
  const [named, setNamed] = useState<string | null>(null);
  // 문장 고르기 값. 팝업이 열려 있는 동안은 바뀌지 않는다.
  const [seed] = useState(catSeed);
  // 간식이 여러 종류일 때 간식주기를 누르면 고르기 줄로 바뀐다.
  const [choosing, setChoosing] = useState(false);

  const act = async (action: "feed" | "pet", snack: string | null = null) => {
    setWorking(true);
    const { data, error: e } = await supabase.rpc("cat_act", {
      p_action: action,
      p_snack: snack,
    });
    setWorking(false);
    if (e || !data) {
      setError(toKoreanError(e?.message));
      return;
    }
    const r = data as CatActResult;
    setError(null);
    setResult(r);
    setCanName(r.can_name);
    onChanged();
  };

  const submitName = async () => {
    setWorking(true);
    const { data, error: e } = await supabase.rpc("cat_set_name", { p_name: draft });
    setWorking(false);
    if (e || !data) {
      setError(toKoreanError(e?.message));
      return;
    }
    setError(null);
    setNamed((data as { cat_name: string }).cat_name);
    setCanName(false);
    onChanged();
  };

  const pose: Pose = !result
    ? mode === "name"
      ? "purr"
      : "idle"
    : result.outcome === "fed"
      ? "munch"
      : result.outcome === "petted"
        ? "purr"
        : "flee";
  const hearts = pose === "munch" || pose === "purr" || named !== null;

  const lines = named
    ? catNamedLines(named)
    : result
      ? catActLines(result, seed)
      : mode === "name"
        ? ["마음을 열어 준 고양이다.", "부를 이름을 기다리는 듯 올려다본다."]
        : catMeetLines(place, name, hpCut, seed);

  const bubble = pose === "flee" ? null : pose === "idle" ? "?" : "♡";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="border-line w-full max-w-xs border bg-bg-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
          <MonoLabel>{named ?? catName(name)}</MonoLabel>
          <button
            type="button"
            onClick={onClose}
            className="label-11 text-fg-mid hover:text-fg-hi"
          >
            닫기
          </button>
        </div>

        {/* 무대 — 고양이는 제자리, 발자국·하트·말풍선만 움직인다. */}
        <div className="border-line-soft relative h-40 overflow-hidden border-b bg-bg-2">
          <span
            aria-hidden
            className="cat-float absolute bottom-3 left-6 text-[13px] opacity-0"
            style={{ animationDelay: "0.2s", animationIterationCount: 1 }}
          >
            🐾
          </span>
          <span
            aria-hidden
            className="cat-float absolute right-8 bottom-6 text-[13px] opacity-0"
            style={{ animationDelay: "0.5s", animationIterationCount: 1 }}
          >
            🐾
          </span>

          <div className="absolute inset-x-0 bottom-2 flex justify-center">
            <div className="relative">
              {bubble && (
                <span
                  aria-hidden
                  className="cat-bubble border-line text-fg-hi absolute -top-7 -right-5 border bg-surface px-1.5 font-mono text-[13px] leading-5"
                >
                  {bubble}
                </span>
              )}
              <span
                key={pose}
                role="img"
                aria-label="고양이"
                className={`block text-[64px] leading-none select-none ${POSE_CLASS[pose]}`}
              >
                🐈
              </span>
            </div>
          </div>

          {hearts &&
            [
              { left: "30%", delay: "0s" },
              { left: "58%", delay: "0.6s" },
              { left: "44%", delay: "1.2s" },
            ].map((h) => (
              <span
                key={h.left}
                aria-hidden
                className="cat-float absolute bottom-16 text-[15px] opacity-0"
                style={{ left: h.left, animationDelay: h.delay }}
              >
                💕
              </span>
            ))}
        </div>

        <div className="flex flex-col gap-3 p-4">
          {lines.map((line, i) => (
            <p key={i} className={`body-15 ${i === 0 ? "text-fg-hi" : "text-brass"}`}>
              {line}
            </p>
          ))}

          {error && (
            <p className="mono-13 border-loss/40 border bg-bg-2 px-3 py-2 text-loss">{error}</p>
          )}

          {!result && mode === "meet" && choosing ? (
            <div className="flex flex-col gap-1.5">
              <MonoLabel tone="low">무엇을 줄까</MonoLabel>
              {/* 두 칸 격자 — 개수가 홀수면 맨 앞(츄르)이 한 줄을 다 쓰고, 생선은 아랫줄에 나란히 */}
              <div className="grid grid-cols-2 gap-1.5">
                {snacks.map((s, i) => (
                  <button
                    key={s.code}
                    type="button"
                    disabled={working}
                    onClick={() => act("feed", s.code)}
                    className={`${button} ${i === 0 && snacks.length % 2 === 1 ? "col-span-2" : ""}`}
                  >
                    {s.name} ×{s.qty}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={working}
                onClick={() => setChoosing(false)}
                className="state-fade label-11 text-fg-low enabled:hover:text-fg-mid self-start px-1 py-1"
              >
                뒤로
              </button>
            </div>
          ) : !result && mode === "meet" ? (
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={working}
                onClick={() =>
                  snacks.length > 1 ? setChoosing(true) : act("feed", snacks[0]?.code ?? null)
                }
                className={button}
              >
                간식주기
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => act("pet")}
                className={button}
              >
                쓰다듬기
              </button>
            </div>
          ) : canName ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) submitName();
              }}
            >
              <MonoLabel tone="low">내가 부를 이름 · 한 번 정하면 바꿀 수 없다</MonoLabel>
              <div className="flex gap-1.5">
                <input
                  value={draft}
                  maxLength={12}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="이름 (12자까지)"
                  className="mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line min-w-0 flex-1 border px-3 py-2.5 outline-none"
                />
                <button
                  type="submit"
                  disabled={working || !draft.trim()}
                  className="state-fade label-11 border-brass-line shrink-0 border bg-brass-fill px-3 text-fg-hi disabled:opacity-50"
                >
                  정하기
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="state-fade label-11 border-line w-full border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi"
            >
              닫기
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
