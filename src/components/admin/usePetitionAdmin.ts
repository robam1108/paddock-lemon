"use client";

import { useCallback, useState } from "react";
import { type AdminPetition, type PetitionThread, toKoreanError } from "@/lib/game";
import { uploadPetitionPhoto, usePhotoAttach } from "../ui/PhotoAttach";
import type { AdminCore } from "./useAdminCore";

/** 피드백 — 목록 · 스레드 · 답장 · 종료 · 삭제(한 건 · 일괄). */
export function usePetitionAdmin(core: AdminCore) {
  const {
    busy,
    setBusy,
    setError,
    setNotice,
    supabase,
  } = core;
  // 피드백
  const [petitions, setPetitions] = useState<AdminPetition[]>([]);
  const [petitionThread, setPetitionThread] = useState<PetitionThread | null>(
    null,
  );
  const [petitionReply, setPetitionReply] = useState("");
  const petitionReplyPhoto = usePhotoAttach();
  // 미종결 우선 정렬은 서버(panel_petitions)가 이미 해 준다 — 여기선 3건만 자른다.
  const [petitionsListOpen, setPetitionsListOpen] = useState(false);
  // 종결건 삭제 확인 팝업
  const [petitionDeleteTarget, setPetitionDeleteTarget] = useState<Pick<
    AdminPetition,
    "id" | "username" | "subject"
  > | null>(null);
  // 선택삭제 — 종결건만 체크박스로 골라 한 번에 지운다.
  const [petitionSelectMode, setPetitionSelectMode] = useState(false);
  const [petitionSelected, setPetitionSelected] = useState<Set<number>>(
    () => new Set(),
  );
  const [petitionBulkConfirm, setPetitionBulkConfirm] = useState(false);

  const loadPetitions = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("panel_petitions");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setPetitions((data ?? []) as AdminPetition[]);
  }, [supabase, setError]);

  const openPetitionThread = useCallback(
    async (id: number) => {
      const { data, error: e } = await supabase.rpc("petition_thread", {
        p_id: id,
      });
      if (e || !data) {
        setError(toKoreanError(e?.message));
        return;
      }
      setPetitionThread(data as PetitionThread);
      setPetitionReply("");
      petitionReplyPhoto.reset();
    },
    [supabase, petitionReplyPhoto, setError],
  );

  async function sendPetitionReply() {
    const b = petitionReply.trim();
    if (!petitionThread || !b || busy) return;

    setBusy(true);
    setError(null);

    let imagePath: string | null = null;
    if (petitionReplyPhoto.file) {
      try {
        imagePath = await uploadPetitionPhoto(supabase, petitionReplyPhoto.file);
      } catch {
        setBusy(false);
        setError("사진을 올리지 못했습니다.");
        return;
      }
    }

    const { data, error: e } = await supabase.rpc("petition_reply", {
      p_id: petitionThread.id,
      p_body: b,
      p_image_path: imagePath,
    });
    setBusy(false);

    if (e || !data) {
      if (imagePath) await supabase.storage.from("petitions").remove([imagePath]);
      setError(toKoreanError(e?.message));
      return;
    }
    setPetitionThread(data as PetitionThread);
    setPetitionReply("");
    petitionReplyPhoto.reset();
    loadPetitions();
  }

  async function closePetition(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_petition_close", {
      p_id: id,
    });
    setBusy(false);

    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setPetitions((data ?? []) as AdminPetition[]);
    if (petitionThread?.id === id) setPetitionThread(null);
  }


  async function deletePetition(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_petition_delete", {
      p_id: id,
    });
    setBusy(false);
    setPetitionDeleteTarget(null);

    if (e || !data) {
      setError(toKoreanError(e?.message));
      return;
    }
    const r = data as { petitions: AdminPetition[]; image_paths: string[] };
    setPetitions(r.petitions ?? []);
    if (petitionThread?.id === id) setPetitionThread(null);
    // 첨부 사진은 SQL 로 지울 수 없어 여기서 Storage API 로 지운다. 피드백은
    // 이미 지워졌으므로 실패해도 무시한다 — 가리키는 글이 없어 열리지 않는다.
    if (r.image_paths?.length) {
      await supabase.storage.from("petitions").remove(r.image_paths);
    }
  }

  function togglePetitionSelectMode() {
    setPetitionSelected(new Set());
    setPetitionSelectMode((v) => {
      // 접힌 항목도 보여야 전체선택이 눈에 들어온다.
      if (!v) setPetitionsListOpen(true);
      return !v;
    });
  }

  function togglePetitionSelected(id: number) {
    setPetitionSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 일괄 삭제 — 기존 단건 RPC 를 차례로 부른다. 중간에 실패하면 멈추되,
  // 그때까지 지운 것은 목록·사진 정리에 반영한다.
  async function deletePetitions(ids: number[]) {
    if (busy || ids.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const deleted: number[] = [];
    const paths: string[] = [];
    let latest: AdminPetition[] | null = null;
    let failMsg: string | null = null;

    for (const id of ids) {
      const { data, error: e } = await supabase.rpc("panel_petition_delete", {
        p_id: id,
      });
      if (e || !data) {
        failMsg = toKoreanError(e?.message);
        break;
      }
      const r = data as { petitions: AdminPetition[]; image_paths: string[] };
      latest = r.petitions ?? [];
      paths.push(...(r.image_paths ?? []));
      deleted.push(id);
    }

    if (latest) setPetitions(latest);
    if (petitionThread && deleted.includes(petitionThread.id)) {
      setPetitionThread(null);
    }
    if (paths.length) {
      await supabase.storage.from("petitions").remove(paths);
    }

    setBusy(false);
    setPetitionBulkConfirm(false);
    setPetitionSelected(new Set());
    setPetitionSelectMode(false);
    if (failMsg) {
      setError(
        deleted.length ? `${deleted.length}건 삭제 후 실패: ${failMsg}` : failMsg,
      );
    } else {
      setNotice(`${deleted.length}건 삭제했다.`);
    }
  }

  const closedPetitionIds = petitions
    .filter((p) => p.status === "closed")
    .map((p) => p.id);
  const allClosedSelected =
    closedPetitionIds.length > 0 &&
    closedPetitionIds.every((id) => petitionSelected.has(id));

  return {
    petitions,
    setPetitions,
    petitionThread,
    setPetitionThread,
    petitionReply,
    setPetitionReply,
    petitionsListOpen,
    setPetitionsListOpen,
    petitionDeleteTarget,
    setPetitionDeleteTarget,
    petitionSelectMode,
    setPetitionSelectMode,
    petitionSelected,
    setPetitionSelected,
    petitionBulkConfirm,
    setPetitionBulkConfirm,
    petitionReplyPhoto,
    loadPetitions,
    openPetitionThread,
    closedPetitionIds,
    allClosedSelected,
    sendPetitionReply,
    closePetition,
    deletePetition,
    togglePetitionSelectMode,
    togglePetitionSelected,
    deletePetitions,
  };
}
