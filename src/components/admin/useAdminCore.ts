"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type AdminPlayer,
  type AdminPlayerDetail,
  type AdminTradeLedger,
  type ItemDef,
  toKoreanError,
} from "@/lib/game";

/**
 * 관리자 화면의 공용 상태 — 플레이어 목록 · 상세, 발급 · 삭제, 지급 · 회수, 정지.
 * busy · error · notice 배너도 여기 있어 다른 관리자 훅이 같이 쓴다.
 */
export function useAdminCore() {
  const supabase = useMemo(() => createClient(), []);

  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 새 플레이어
  const [newName, setNewName] = useState("");
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(
    null,
  );

  // 플레이어 삭제 — 이름과 코드가 모두 맞아야 하고, 되묻기를 한 번 거친다.
  const [delName, setDelName] = useState("");
  const [delConfirm, setDelConfirm] = useState("");
  const [delConfirmOpen, setDelConfirmOpen] = useState(false);

  // 코인 지급
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(20);
  const [amountText, setAmountText] = useState("20");
  // 지급 사유 — 폼마다 따로 든다. 한 화면에 세 폼이 같이 떠 있어서 값을
  // 공유하면 코인에 붙인 사유가 아이템 지급에 딸려 가 버린다.
  const [coinReason, setCoinReason] = useState<string | null>(null);
  const [coinNote, setCoinNote] = useState("");

  // 게임 횟수 조절
  const [playTarget, setPlayTarget] = useState("");
  const [playAmount, setPlayAmount] = useState(5);
  const [playAmountText, setPlayAmountText] = useState("5");
  const [playReason, setPlayReason] = useState<string | null>(null);
  const [playNote, setPlayNote] = useState("");

  // 아이템 지급
  const [catalog, setCatalog] = useState<ItemDef[]>([]);
  const [itemTarget, setItemTarget] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [itemQtyText, setItemQtyText] = useState("1");
  const [itemReason, setItemReason] = useState<string | null>(null);
  const [itemNote, setItemNote] = useState("");

  // 상세 / 거래 / 관계
  const [detail, setDetail] = useState<AdminPlayerDetail | null>(null);

  // 상세의 거래 기록 — 상대가 삭제돼 거래 목록에서 사라진 거래도 여기엔 남는다.
  const [tradeLedger, setTradeLedger] = useState<AdminTradeLedger[]>([]);
  const [tradeLedgerOpen, setTradeLedgerOpen] = useState(false);

  // 소지품 회수 팝업 — 상세에서 아이템을 누르면 뜬다.
  const [takeTarget, setTakeTarget] = useState<{
    code: string;
    name: string;
    emoji: string;
    held: number;
  } | null>(null);
  const [takeQty, setTakeQty] = useState(1);
  const [takeReason, setTakeReason] = useState<string | null>(null);
  const [takeNote, setTakeNote] = useState("");

  // 정지 팝업 — 정지 중이 아니면 일수·사유를 받고, 정지 중이면 해제만 되묻는다.
  const [suspendPopup, setSuspendPopup] = useState<"suspend" | "unsuspend" | null>(
    null,
  );
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [suspendDays, setSuspendDays] = useState(7);
  const [suspendReason, setSuspendReason] = useState("");

  /**
   * 플레이어 목록.
   *
   * 에러를 공용 배너(error)에 쓰지 않는다 — 마운트 때 네 로더가 한꺼번에
   * 돌아서 나중에 끝난 쪽이 앞선 메시지를 덮어 버린다. 목록의 사정은 목록
   * 자리에서 말한다. null 이 돌아온 것도 "0명"이 아니라 실패로 본다.
   */
  const load = useCallback(async () => {
    setListLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("panel_players");
      if (rpcError || !data) {
        setListError(toKoreanError(rpcError?.message));
        return;
      }
      setListError(null);
      setPlayers(data as AdminPlayer[]);
    } catch (e) {
      setListError(toKoreanError(e instanceof Error ? e.message : undefined));
    } finally {
      setListLoading(false);
    }
  }, [supabase]);


  const openDetail = useCallback(
    async (name: string) => {
      const { data, error: e } = await supabase.rpc("panel_player", {
        p_name: name,
      });
      if (e || !data) {
        setError(toKoreanError(e?.message));
        return;
      }
      setDetail(data as AdminPlayerDetail);

      const { data: tl, error: te } = await supabase.rpc("panel_trade_ledger", {
        p_name: name,
      });
      if (te) {
        setError(toKoreanError(te.message));
        return;
      }
      setTradeLedger((tl ?? []) as AdminTradeLedger[]);
    },
    [supabase],
  );


  async function addPlayer() {
    const name = newName.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setIssued(null);

    const { data, error: rpcError } = await supabase.rpc("panel_add_player", {
      p_name: name,
    });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const result = data as { name: string; password: string };
    setIssued(result);
    setNewName("");
    await load();
  }

  async function deletePlayer() {
    const name = delName.trim();
    const confirm = delConfirm.trim();
    if (!name || !confirm || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setIssued(null);

    const { data, error: rpcError } = await supabase.rpc(
      "panel_delete_player",
      { p_name: name, p_confirm: confirm },
    );
    setBusy(false);
    setDelConfirmOpen(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const result = data as { name: string };
    setNotice(`${result.name} 계정을 삭제했습니다.`);
    setDelName("");
    setDelConfirm("");
    if (detail?.username === result.name) setDetail(null);
    await load();
  }

  async function grantCoins() {
    const name = target.trim();
    if (!name || busy || amount === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setIssued(null);

    const { data, error: rpcError } = await supabase.rpc("panel_grant_coins", {
      p_name: name,
      p_amount: amount,
      p_category: coinReason,
      p_note: coinNote.trim() || null,
    });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const result = data as { name: string; coins: number };
    setNotice(
      `${result.name} 에게 ${amount > 0 ? "+" : ""}${amount} 코인 → 현재 ${result.coins} 코인`,
    );
    await load();
  }

  /** 게임 횟수 조절: 초기화 또는 보너스 증감 */
  async function adjustPlays(fn: "reset" | "give") {
    const name = playTarget.trim();
    if (!name || busy) return;
    if (fn === "give" && playAmount === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setIssued(null);

    const { data, error: rpcError } =
      fn === "reset"
        ? await supabase.rpc("panel_reset_plays", { p_name: name })
        : await supabase.rpc("panel_give_plays", {
            p_name: name,
            p_amount: playAmount,
            p_category: playReason,
            p_note: playNote.trim() || null,
          });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const r = data as {
      name: string;
      plays_used: number;
      bonus_plays: number;
      plays_left: number;
    };
    setNotice(
      `${r.name} · 남은 횟수 ${r.plays_left} (사용 ${r.plays_used} · 보너스 ${r.bonus_plays})`,
    );
    await load();
  }

  async function giveItem() {
    const name = itemTarget.trim();
    if (!name || !itemCode || busy || itemQty === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setIssued(null);

    const { data, error: rpcError } = await supabase.rpc("panel_give_item", {
      p_name: name,
      p_code: itemCode,
      p_qty: itemQty,
      p_category: itemReason,
      p_note: itemNote.trim() || null,
    });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const r = data as { name: string; item: string; qty: number };
    setNotice(
      `${r.name} · ${r.item} ${itemQty > 0 ? "+" : ""}${itemQty} → 보유 ${r.qty}개`,
    );
    if (detail?.username === r.name) await openDetail(r.name);
  }

  function openTakeItem(item: { code: string; name: string; emoji: string; qty: number }) {
    setTakeTarget({ code: item.code, name: item.name, emoji: item.emoji, held: item.qty });
    setTakeQty(Math.min(1, item.qty));
    setTakeReason(null);
    setTakeNote("");
  }

  async function confirmTakeItem() {
    if (!detail || !takeTarget || busy) return;
    if (takeQty < 1 || takeQty > takeTarget.held) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const { data, error: rpcError } = await supabase.rpc("panel_take_item", {
      p_name: detail.username,
      p_code: takeTarget.code,
      p_qty: takeQty,
      p_category: takeReason,
      p_note: takeNote.trim() || null,
    });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const r = data as { name: string; item: string; qty: number };
    setNotice(`${r.name} · ${r.item} 회수 ${takeQty}개 → 보유 ${r.qty}개`);
    setTakeTarget(null);
    await openDetail(r.name);
    await load();
  }


  async function confirmSuspend() {
    if (!detail || busy) return;
    if (suspendDays < 1 || suspendDays > 365) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const { data, error: rpcError } = await supabase.rpc("panel_suspend", {
      p_name: detail.username,
      p_days: suspendDays,
      p_reason: suspendReason.trim() || null,
    });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const r = data as { name: string };
    setNotice(`${r.name} 을(를) ${suspendDays}일 정지했다.`);
    setSuspendPopup(null);
    await openDetail(r.name);
    await load();
  }

  async function confirmUnsuspend() {
    if (!detail || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const { data, error: rpcError } = await supabase.rpc("panel_unsuspend", {
      p_name: detail.username,
    });
    setBusy(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const r = data as { name: string };
    setNotice(`${r.name} 의 정지를 해제했다.`);
    setSuspendPopup(null);
    await openDetail(r.name);
    await load();
  }


  return {
    players,
    setPlayers,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    newName,
    setNewName,
    issued,
    setIssued,
    delName,
    setDelName,
    delConfirm,
    setDelConfirm,
    delConfirmOpen,
    setDelConfirmOpen,
    target,
    setTarget,
    amount,
    setAmount,
    amountText,
    setAmountText,
    coinReason,
    setCoinReason,
    coinNote,
    setCoinNote,
    playTarget,
    setPlayTarget,
    playAmount,
    setPlayAmount,
    playAmountText,
    setPlayAmountText,
    playReason,
    setPlayReason,
    playNote,
    setPlayNote,
    catalog,
    setCatalog,
    itemTarget,
    setItemTarget,
    itemCode,
    setItemCode,
    itemQty,
    setItemQty,
    itemQtyText,
    setItemQtyText,
    itemReason,
    setItemReason,
    itemNote,
    setItemNote,
    detail,
    setDetail,
    tradeLedger,
    setTradeLedger,
    tradeLedgerOpen,
    setTradeLedgerOpen,
    takeTarget,
    setTakeTarget,
    takeQty,
    setTakeQty,
    takeReason,
    setTakeReason,
    takeNote,
    setTakeNote,
    suspendPopup,
    setSuspendPopup,
    listLoading,
    setListLoading,
    listError,
    setListError,
    suspendDays,
    setSuspendDays,
    suspendReason,
    setSuspendReason,
    supabase,
    load,
    openDetail,
    addPlayer,
    deletePlayer,
    grantCoins,
    adjustPlays,
    giveItem,
    openTakeItem,
    confirmTakeItem,
    confirmSuspend,
    confirmUnsuspend,
  };
}

export type AdminCore = ReturnType<typeof useAdminCore>;
