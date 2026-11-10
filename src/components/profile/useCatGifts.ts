"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { type CatStatus, toKoreanError } from "@/lib/game";
import { catGiftUsedLines, catSeed, catTossLines } from "@/lib/copy";
import type { Tab } from "./shared";

/** 탐험 고양이 선물 — 도착 확인, 쓰기, 몰래 정리. */
export function useCatGifts({ supabase, tab, onRefresh }: {
  supabase: SupabaseClient;
  tab: Tab;
  onRefresh: () => Promise<void>;
}) {
  // 고양이 — 소지품 탭에 들어갈 때마다 도착한 선물이 있는지 보고, 내가 지은 이름
  // (○○의 선물 표기)과 선물 효과의 남은 판 수도 함께 받는다.
  const [catStatus, setCatStatus] = useState<CatStatus | null>(null);
  const [catGiftsOpen, setCatGiftsOpen] = useState(false);
  const [catFavorite, setCatFavorite] = useState<string | null>(null);
  // 몰래 정리 · 선물 쓰기 결과 팝업
  const [catNote, setCatNote] = useState<{ title: string; lines: string[] } | null>(null);
  const loadCat = useCallback(async () => {
    const { data } = await supabase.rpc("cat_gifts_pending");
    const d = data as CatStatus | null;
    if (!d) return null;
    setCatStatus(d);
    return d;
  }, [supabase]);
  useEffect(() => {
    if (tab !== "items") return;
    let live = true;
    loadCat().then((d) => {
      if (live && d && d.gifts.length > 0) setCatGiftsOpen(true);
    });
    return () => {
      live = false;
    };
  }, [tab, loadCat]);

  async function tossCatGift(code: string, name: string) {
    const { error } = await supabase.rpc("cat_gift_toss", { p_code: code });
    if (error) {
      setCatNote({ title: "몰래 정리", lines: [toKoreanError(error.message)] });
      return;
    }
    setCatNote({ title: "몰래 정리", lines: catTossLines(catStatus?.cat_name ?? null, name, catSeed()) });
    await onRefresh();
  }

  // 같은 선물 효과가 아직 남아 있는가 — 사용 팝업이 [쓴다] 를 막는다.
  function catGiftActive(code: string): boolean {
    if (!catStatus) return false;
    if (code === "feather") return catStatus.bless_left > 0;
    if (code === "toy_mouse") return !!catStatus.search_ready;
    return !!catStatus.labor_ready;
  }

  async function applyCatGift(code: string, name: string) {
    const { error } = await supabase.rpc("cat_gift_use", { p_code: code });
    if (error) {
      setCatNote({ title: name, lines: [toKoreanError(error.message)] });
      return;
    }
    setCatNote({ title: name, lines: catGiftUsedLines(code) });
    await onRefresh();
    loadCat();
  }

  return {
    catStatus,
    setCatStatus,
    catGiftsOpen,
    setCatGiftsOpen,
    catFavorite,
    setCatFavorite,
    catNote,
    setCatNote,
    loadCat,
    tossCatGift,
    catGiftActive,
    applyCatGift,
  };
}
