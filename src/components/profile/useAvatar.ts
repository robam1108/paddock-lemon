"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useMemo, useRef, useState } from "react";
import { type PlayerState, toKoreanError } from "@/lib/game";

/** 프로필 사진 — 고르기 · 자르기 · 올리기 · 지우기, 모바일 길게 누르기. */
export function useAvatar({ supabase, state, isMobile, onAvatarChange }: {
  supabase: SupabaseClient;
  state: PlayerState;
  isMobile: boolean;
  onAvatarChange: (path: string | null) => Promise<boolean>;
}) {
  // 프로필 사진
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBust, setAvatarBust] = useState(0);
  const [avatarActionOpen, setAvatarActionOpen] = useState(false);
  // 모바일 + 사진 있음일 때만 쓰는 길게 누르기 타이머
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // avatar_path 는 Storage 안의 경로일 뿐이라, 실제 주소는 매번 여기서 만든다.
  // avatarBust 는 같은 경로에 새 파일을 덮어썼을 때 브라우저 캐시를 피하려는 용도.
  const avatarUrl = useMemo(() => {
    if (!state.avatar_path) return null;
    const { data } = supabase.storage
      .from("avatars")
      .getPublicUrl(state.avatar_path);
    return avatarBust ? `${data.publicUrl}?v=${avatarBust}` : data.publicUrl;
  }, [supabase, state.avatar_path, avatarBust]);

  const playerAvatarUrl = useCallback(
    (path: string | null) => {
      if (!path) return null;
      return supabase.storage.from("avatars").getPublicUrl(path).data
        .publicUrl;
    },
    [supabase],
  );

  function onAvatarFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setAvatarError("이미지 파일만 올릴 수 있습니다.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setAvatarError("파일이 너무 큽니다. 20MB 이하로 골라 주세요.");
      return;
    }
    setAvatarError(null);
    setPendingFile(f);
  }

  /**
   * 사진 칸 탭 처리.
   *   사진 없음        → 어느 기기든 바로 파일을 고른다.
   *   사진 있음 · PC   → 클릭으로 수정 팝업을 연다 (평소엔 라벨이 호버에만 보인다).
   *   사진 있음 · 모바일 → 짧게 누르면 아무 일도 없다. 길게 눌러야 팝업이 뜬다
   *                       (호버가 없는 기기라 항상 뜨는 라벨을 두지 않는다).
   */
  function onPhotoClick() {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    setAvatarError(null);
    if (!avatarUrl) {
      fileInputRef.current?.click();
    } else if (!isMobile) {
      setAvatarActionOpen(true);
    }
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onPhotoPointerDown() {
    if (!isMobile || !avatarUrl) return;
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setAvatarError(null);
      setAvatarActionOpen(true);
    }, 550);
  }

  /** 잘라낸 조각을 올리고, 경로만 프로필에 반영한다. */
  async function uploadAvatar(blob: Blob) {
    setAvatarBusy(true);
    setAvatarError(null);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (userErr || !uid) {
      setAvatarError("로그인 정보를 확인할 수 없습니다.");
      setAvatarBusy(false);
      return;
    }

    // 사람마다 파일 하나뿐이라 항상 같은 이름으로 덮어쓴다.
    const path = `${uid}/avatar.jpg`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    if (upErr) {
      setAvatarError(toKoreanError(upErr.message));
      setAvatarBusy(false);
      return;
    }

    const ok = await onAvatarChange(path);
    setAvatarBusy(false);
    if (!ok) {
      setAvatarError("등록하지 못했습니다.");
      return;
    }
    setAvatarBust(Date.now());
    setPendingFile(null);
  }

  async function removeAvatar(): Promise<boolean> {
    if (!state.avatar_path || avatarBusy) return false;
    setAvatarBusy(true);
    setAvatarError(null);
    await supabase.storage.from("avatars").remove([state.avatar_path]);
    const ok = await onAvatarChange(null);
    setAvatarBusy(false);
    if (!ok) setAvatarError("지우지 못했습니다.");
    return ok;
  }

  return {
    pendingFile,
    setPendingFile,
    avatarBusy,
    setAvatarBusy,
    avatarError,
    setAvatarError,
    avatarBust,
    setAvatarBust,
    avatarActionOpen,
    setAvatarActionOpen,
    fileInputRef,
    longPressTimer,
    longPressFired,
    avatarUrl,
    playerAvatarUrl,
    onAvatarFileSelected,
    onPhotoClick,
    clearLongPress,
    onPhotoPointerDown,
    uploadAvatar,
    removeAvatar,
  };
}
