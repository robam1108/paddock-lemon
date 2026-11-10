"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toKoreanError, type CatGift } from "@/lib/game";
import { catGiftLines, catGiftResolvedLines, catName, catSeed } from "@/lib/copy";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";

/**
 * 고양이의 보은. 소지품 탭에 들어갈 때 도착한 것이 있으면 뜬다.
 *
 * 여러 개가 쌓여 있으면 하나씩 받기 · 버리기를 고른다(public.cat_gift_resolve).
 * 고른 뒤에는 결과 한 줄을 보여 주고 다음 것으로 넘어간다.
 */
export default function CatGiftPopup({
  supabase,
  gifts,
  name,
  onKept,
  onClose,
}: {
  supabase: SupabaseClient;
  gifts: CatGift[];
  /** 고양이 이름. 없으면 null */
  name: string | null;
  /** 받은 물건이 소지품에 들어갔다 — 바깥에서 다시 읽는다 */
  onKept: () => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<{ lines: string[]; kept: boolean } | null>(null);
  // 문장 고르기 값. 팝업이 열려 있는 동안은 바뀌지 않는다.
  const [seed] = useState(catSeed);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gift = gifts[index];
  const last = index >= gifts.length - 1;

  const resolve = async (keep: boolean) => {
    if (!gift) return;
    setWorking(true);
    const { error: e } = await supabase.rpc("cat_gift_resolve", {
      p_id: gift.id,
      p_keep: keep,
    });
    setWorking(false);
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setError(null);
    setDone({
      lines: catGiftResolvedLines(name, gift.name, keep),
      kept: keep,
    });
    if (keep) onKept();
  };

  const next = () => {
    if (last) {
      onClose();
      return;
    }
    setDone(null);
    setIndex((i) => i + 1);
  };

  if (!gift || typeof document === "undefined") return null;

  const action =
    "state-fade label-11 border-line flex-1 border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi disabled:opacity-50";

  return createPortal(
    <div className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="border-line w-full max-w-xs border bg-bg-1">
        <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
          <MonoLabel>{catName(name)}의 보은</MonoLabel>
          {gifts.length > 1 && (
            <MonoLabel tone="low">
              {index + 1}/{gifts.length}
            </MonoLabel>
          )}
        </div>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2.5">
            <span className={done ? "" : "cat-pop"}>
              <ItemMark kind={gift.kind} grade={gift.grade} emoji={gift.emoji} />
            </span>
            <span className="body-15 text-fg-hi">{gift.name}</span>
            <span aria-hidden className={done ? "" : "ml-auto text-[28px] leading-none"}>
              {done ? "" : "🐈"}
            </span>
          </div>

          {(done ? done.lines : catGiftLines(name, gift.name, seed + index)).map((line, i) => (
            <p
              key={i}
              className={`body-15 ${
                i === 0 ? "text-fg-hi" : done && !done.kept ? "text-loss" : "text-brass"
              }`}
            >
              {line}
            </p>
          ))}
          {error && (
            <p className="mono-13 border-loss/40 border bg-bg-2 px-3 py-2 text-loss">{error}</p>
          )}

          {done ? (
            <button type="button" onClick={next} className={action}>
              {last ? "닫기" : "다음"}
            </button>
          ) : (
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={working}
                onClick={() => resolve(true)}
                className={action}
              >
                받기
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => resolve(false)}
                className={action}
              >
                버리기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
