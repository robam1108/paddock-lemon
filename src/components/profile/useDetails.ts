"use client";

import { useState } from "react";
import type { PlayerState } from "@/lib/game";
import type { RecordProps } from "./useRecordModel";

/** 프로필 수정 팝업(상태 메시지 · 나이 · 키/체중 · 소개)의 입력값과 저장. */
export function useDetails({ state, onDetailsChange }: {
  state: PlayerState;
  onDetailsChange: RecordProps["onDetailsChange"];
}) {
  // 프로필 수정(상태 메시지·나이·키/체중·소개) 팝업
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dCrime, setDCrime] = useState("");
  const [dAge, setDAge] = useState("");
  const [dHeight, setDHeight] = useState("");
  const [dWeight, setDWeight] = useState("");
  const [dBio, setDBio] = useState("");
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  function openDetailsForm() {
    setDetailsError(null);
    setDCrime(state.status_message ?? "");
    setDAge(state.age != null ? String(state.age) : "");
    setDHeight(state.height_cm != null ? String(state.height_cm) : "");
    setDWeight(state.weight_kg != null ? String(state.weight_kg) : "");
    setDBio(state.bio ?? "");
    setDetailsOpen(true);
  }

  async function saveDetails() {
    if (detailsBusy) return;
    setDetailsBusy(true);
    setDetailsError(null);
    const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
    const ok = await onDetailsChange({
      p_status_message: dCrime.trim(),
      p_age: toNum(dAge),
      p_height_cm: toNum(dHeight),
      p_weight_kg: toNum(dWeight),
      p_bio: dBio.trim(),
    });
    setDetailsBusy(false);
    if (!ok) {
      setDetailsError("등록하지 못했습니다.");
      return;
    }
    setDetailsOpen(false);
  }

  return {
    detailsOpen,
    setDetailsOpen,
    dCrime,
    setDCrime,
    dAge,
    setDAge,
    dHeight,
    setDHeight,
    dWeight,
    setDWeight,
    dBio,
    setDBio,
    detailsBusy,
    setDetailsBusy,
    detailsError,
    setDetailsError,
    openDetailsForm,
    saveDetails,
  };
}
