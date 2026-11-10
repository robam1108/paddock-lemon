"use client";

import { useEffect } from "react";
import type { ItemDef } from "@/lib/game";
import { useAdminCore } from "./useAdminCore";
import { usePetitionAdmin } from "./usePetitionAdmin";
import { useRelationAdmin } from "./useRelationAdmin";
import { useTradeAdmin } from "./useTradeAdmin";

/** 관리자 화면 전체의 상태와 동작. 섹션 컴포넌트는 여기서 필요한 것만 꺼내 쓴다. */
export function useAdminModel(username: string) {
  const core = useAdminCore();
  const pet = usePetitionAdmin(core);
  const rel = useRelationAdmin(core);
  const tr = useTradeAdmin(core);
  const { supabase, load, setCatalog } = core;
  const { loadPetitions } = pet;
  const { loadRelations } = rel;
  const { loadTrades } = tr;

  useEffect(() => {
    load();
    loadTrades();
    loadRelations();
    loadPetitions();
    supabase.rpc("panel_items").then(({ data }) => {
      if (data) setCatalog(data as ItemDef[]);
    });
  }, [load, loadTrades, loadRelations, loadPetitions, supabase, setCatalog]);


  return { username, ...core, ...pet, ...rel, ...tr };
}

export type AdminModel = ReturnType<typeof useAdminModel>;
