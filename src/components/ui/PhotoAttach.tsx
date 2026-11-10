"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage } from "@/lib/image";

/**
 * 피드백 작성·답변 칸에 붙는 사진 첨부 한 장. PetitionBox·AdminPanel 양쪽의
 * 피드백 스레드가 같이 쓴다. 업로드는 제출 시점에 하고, 여기서는 로컬
 * 미리보기만 들고 있는다 — RPC가 실패하면 굳이 지울 파일이 없다.
 */
export function usePhotoAttach() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setPickError("이미지 파일만 올릴 수 있습니다.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setPickError("파일이 너무 큽니다. 20MB 이하로 골라 주세요.");
      return;
    }
    setPickError(null);
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  }

  function onClear() {
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPickError(null);
  }

  return { inputRef, file, previewUrl, pickError, onPick, onClear, reset: onClear };
}

export type PhotoAttach = ReturnType<typeof usePhotoAttach>;

/** 압축해서 petitions 버킷에 올리고 경로만 반환한다. */
export async function uploadPetitionPhoto(
  supabase: SupabaseClient,
  file: File,
): Promise<string> {
  const blob = await compressImage(file);
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from("petitions")
    .upload(path, blob, { upsert: false, contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

const PLAIN =
  "state-fade label-11 shrink-0 border border-line bg-surface px-5 py-2.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";
const SMALL =
  "state-fade label-11 shrink-0 border border-line bg-surface px-3 py-2 text-fg-mid enabled:hover:text-fg-hi";

export function PhotoAttachControl({
  attach,
  disabled,
}: {
  attach: PhotoAttach;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={attach.inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={attach.onPick}
      />
      {attach.previewUrl ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attach.previewUrl}
            alt=""
            className="border-line h-12 w-12 border object-cover"
          />
          <button
            type="button"
            onClick={attach.onClear}
            disabled={disabled}
            className={SMALL}
          >
            사진 제거
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => attach.inputRef.current?.click()}
          disabled={disabled}
          className={`${PLAIN} self-start`}
        >
          사진 첨부
        </button>
      )}
      {attach.pickError && (
        <p className="mono-13 text-loss">{attach.pickError}</p>
      )}
    </div>
  );
}
