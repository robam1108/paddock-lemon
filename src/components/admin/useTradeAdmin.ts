"use client";

import { useCallback, useState } from "react";
import {
  type AdminTrade,
  type AdminTradeLedger,
  toKoreanError,
  type TradeLedgerConfiscateResult,
  type TradeRevertResult,
} from "@/lib/game";
import type { AdminCore } from "./useAdminCore";

/** 유저 간 거래 — 목록, 거래 취소(압수), 상세 거래 기록의 회수. */
export function useTradeAdmin(core: AdminCore) {
  const {
    busy,
    detail,
    load,
    openDetail,
    setBusy,
    setError,
    setNotice,
    supabase,
  } = core;
  const [trades, setTrades] = useState<AdminTrade[]>([]);

  // 유저 간 거래 — 최신 5건만 먼저 보여준다.
  const [tradesListOpen, setTradesListOpen] = useState(false);
  // 거래 취소(압수) 확인 — 성사된 카드에서 펼쳐진다. 한 번에 한 건만.
  const [revertId, setRevertId] = useState<number | null>(null);
  const [revertReason, setRevertReason] = useState<string | null>(null);
  const [revertNote, setRevertNote] = useState("");

  // 거래 기록 상세 팝업 — 기록을 누르면 뜨고, 여기서 회수/취소한다.
  const [ledgerPopup, setLedgerPopup] = useState<AdminTradeLedger | null>(null);
  const [ledgerReason, setLedgerReason] = useState<string | null>(null);
  const [ledgerNote, setLedgerNote] = useState("");

  const loadTrades = useCallback(async () => {
    // 인자 없이 부르면 전체 거래를 돌려준다.
    const { data, error: e } = await supabase.rpc("panel_trades");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setTrades((data ?? []) as AdminTrade[]);
  }, [supabase]);


  function openLedgerPopup(e: AdminTradeLedger) {
    setLedgerPopup(e);
    setLedgerReason(null);
    setLedgerNote("");
  }

  /** 기록에서 이 사람이 받은 것만 회수한다 — 상대가 삭제돼 거래 행이 없는 경우 */
  async function confirmLedgerConfiscate() {
    if (!ledgerPopup || !detail || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const { data, error: rpcError } = await supabase.rpc(
      "panel_confiscate_ledger_trade",
      {
        p_ledger_id: ledgerPopup.id,
        p_category: ledgerReason,
        p_note: ledgerNote.trim() || null,
      },
    );
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const r = data as TradeLedgerConfiscateResult;
    const parts = [
      ...(r.coins > 0 ? [`코인 ${r.coins}`] : []),
      ...r.items.map((i) => `${i.emoji}${i.name} ${i.qty}`),
    ];
    setNotice(
      `${r.name} · ${r.partner} 와의 거래 회수 ${parts.length ? parts.join("·") : "없음"}`,
    );
    setLedgerPopup(null);
    await openDetail(r.name);
    await load();
  }

  /** 거래 목록에 남아 있는 거래면 기존 거래 취소(양쪽 회수)로 처리한다 */
  async function confirmLedgerRevert() {
    if (!ledgerPopup?.trade || !detail || busy) return;
    const ok = await revertTrade(ledgerPopup.trade.id, ledgerReason, ledgerNote);
    if (!ok) return;
    setLedgerPopup(null);
    await openDetail(detail.username);
    await load();
  }


  function openRevert(id: number) {
    setRevertId(id);
    setRevertReason(null);
    setRevertNote("");
  }

  async function confirmRevertTrade() {
    if (revertId === null || busy) return;
    if (await revertTrade(revertId, revertReason, revertNote)) setRevertId(null);
  }

  /** 거래 취소(압수). 거래 목록과 상세의 거래 기록 팝업이 같이 쓴다. */
  async function revertTrade(
    id: number,
    category: string | null,
    note: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);

    const { data, error: rpcError } = await supabase.rpc("panel_revert_trade", {
      p_id: id,
      p_category: category,
      p_note: note.trim() || null,
    });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return false;
    }

    const r = data as TradeRevertResult;
    const side = (s: TradeRevertResult["from"]) => {
      const parts = [
        ...(s.coins > 0 ? [`코인 ${s.coins}`] : []),
        ...s.items.map((i) => `${i.emoji}${i.name} ${i.qty}`),
      ];
      if (s.deleted) return `${s.name} 삭제됨`;
      return `${s.name} ${parts.length ? parts.join("·") : "없음"}`;
    };
    setNotice(`거래 #${r.id} 취소 · 회수 ${side(r.from)} / ${side(r.to)}`);
    await loadTrades();
    return true;
  }


  return {
    trades,
    setTrades,
    tradesListOpen,
    setTradesListOpen,
    revertId,
    setRevertId,
    revertReason,
    setRevertReason,
    revertNote,
    setRevertNote,
    ledgerPopup,
    setLedgerPopup,
    ledgerReason,
    setLedgerReason,
    ledgerNote,
    setLedgerNote,
    loadTrades,
    openLedgerPopup,
    confirmLedgerConfiscate,
    confirmLedgerRevert,
    openRevert,
    confirmRevertTrade,
    revertTrade,
  };
}
