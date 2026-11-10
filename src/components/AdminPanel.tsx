"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  ITEM_GRADE_LABEL,
  LEDGER_KIND_LABEL,
  TRADE_STATUS_LABEL,
  formatDaysLeft,
  formatDuration,
  itemEffect,
  ADMIN_REASONS,
  toKoreanError,
  type AdminPetition,
  type AdminPlayer,
  type AdminPlayerDetail,
  type AdminTrade,
  type AdminTradeLedger,
  type ItemDef,
  type PetitionStatus,
  type PetitionThread,
  type TradeItem,
  type TradeLedgerConfiscateResult,
  type TradeRevertResult,
} from "@/lib/game";
import {
  FORM_LINE,
  FORM_LINE_SHORT,
  LABEL,
  WATCH_NOTE,
} from "@/lib/copy";
import { laborTitle } from "@/lib/labor";
import Panel from "./ui/Panel";
import MonoLabel from "./ui/MonoLabel";
import PetitionPhoto from "./ui/PetitionPhoto";
import {
  usePhotoAttach,
  uploadPetitionPhoto,
  PhotoAttachControl,
} from "./ui/PhotoAttach";

/**
 * 관리자 단말 — 게임 화면과 같은 서식(K-77) 골격을 쓴다.
 * 표면 5단계 · 놋쇠 강조 · 등폭 라벨. 색은 상태선에만 얹는다.
 *
 * 위에서 아래 순서: 플레이어 추가 → 진정함 → 관계 신청 → 플레이어 목록/상세
 * → 플레이어 삭제 → 코인 지급 → 아이템 지급 → 게임 횟수 → 유저 간 거래.
 * 매일 손이 가는 것(추가·진정·관계·조회)을 위에, 파괴적이거나 드문 것
 * (삭제·지급류·거래 열람/취소)을 아래에 둔다.
 */

type AdminRelation = {
  id: number;
  username: string;
  partner: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reject_reason: string | null;
};

const RELATION_STATUS_LABEL: Record<string, string> = {
  pending: "심사 대기",
  approved: "등재됨",
  rejected: "반려됨",
};

const PETITION_STATUS_LABEL: Record<PetitionStatus, string> = {
  open: "미답변",
  answered: "답변 완료",
  closed: "종결",
};

function formatShort(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FIELD =
  "mono-13 w-full border border-line bg-surface px-3 py-2.5 text-fg-hi outline-none placeholder:text-fg-low focus:border-brass-line";
const PRIMARY =
  "state-fade label-11 shrink-0 border border-brass-line bg-brass-fill px-5 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low";
const PLAIN =
  "state-fade label-11 shrink-0 border border-line bg-surface px-5 py-2.5 text-fg-mid enabled:hover:text-fg-hi disabled:text-fg-low";
const SMALL =
  "state-fade label-11 shrink-0 border border-line bg-surface px-3 py-2 text-fg-mid enabled:hover:text-fg-hi";
const DANGER =
  "state-fade label-11 shrink-0 border border-loss/60 bg-surface-hi px-5 py-2.5 text-loss enabled:hover:opacity-80 disabled:text-fg-low";

/**
 * 지급·회수 사유. 분류 셋 중 하나와 자유 메모 한 줄을 받는다.
 *
 * 여기서 고른 값은 받은 사람의 "수감기록 > 기록"에 그대로 뜬다 — 관리자만
 * 보는 메모가 아니다. 둘 다 비워 둘 수 있지만, 비워 두면 유저 쪽에는
 * "관리 · 코인 30개 지급" 한 줄만 남아 왜 받았는지 알 수 없다.
 */
function ReasonPicker({
  category,
  note,
  onCategory,
  onNote,
  disabled,
  placeholder = "사유 메모 — 유저에게 그대로 보인다",
}: {
  category: string | null;
  note: string;
  onCategory: (id: string | null) => void;
  onNote: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1">
        {ADMIN_REASONS.map((r) => {
          const on = category === r.id;
          return (
            <button
              key={r.id}
              type="button"
              disabled={disabled}
              // 한 번 더 누르면 해제된다 — 사유 없이 보내던 예전 동작도 남겨 둔다.
              onClick={() => onCategory(on ? null : r.id)}
              className={`state-fade label-11 border px-3 py-2 ${
                on
                  ? "border-brass-line bg-brass-fill text-fg-hi"
                  : "border-line bg-surface text-fg-mid enabled:hover:text-fg-hi"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <input
        value={note}
        onChange={(e) => onNote(e.target.value)}
        maxLength={200}
        placeholder={placeholder}
        className={FIELD}
        disabled={disabled}
      />
    </div>
  );
}

export default function AdminPanel({ username }: { username: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCodes, setShowCodes] = useState(false);

  // 새 플레이어
  const [newName, setNewName] = useState("");
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(
    null,
  );

  // 플레이어 삭제 — 이름과 코드가 모두 맞아야 하고, 되묻기를 한 번 거친다.
  const [delName, setDelName] = useState("");
  const [delCode, setDelCode] = useState("");
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
  const [trades, setTrades] = useState<AdminTrade[]>([]);
  const [relations, setRelations] = useState<AdminRelation[]>([]);
  // 반려 사유 입력 팝업 — 반려는 사유를 적어야만 확정된다.
  const [rejectTarget, setRejectTarget] = useState<AdminRelation | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // 진정함
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

  // 유저 간 거래 — 최신 5건만 먼저 보여준다.
  const [tradesListOpen, setTradesListOpen] = useState(false);
  // 거래 취소(압수) 확인 — 성사된 카드에서 펼쳐진다. 한 번에 한 건만.
  const [revertId, setRevertId] = useState<number | null>(null);
  const [revertReason, setRevertReason] = useState<string | null>(null);
  const [revertNote, setRevertNote] = useState("");

  // 상세의 거래 기록 — 상대가 삭제돼 거래 목록에서 사라진 거래도 여기엔 남는다.
  const [tradeLedger, setTradeLedger] = useState<AdminTradeLedger[]>([]);
  const [tradeLedgerOpen, setTradeLedgerOpen] = useState(false);
  // 거래 기록 상세 팝업 — 기록을 누르면 뜨고, 여기서 회수/취소한다.
  const [ledgerPopup, setLedgerPopup] = useState<AdminTradeLedger | null>(null);
  const [ledgerReason, setLedgerReason] = useState<string | null>(null);
  const [ledgerNote, setLedgerNote] = useState("");

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

  const loadTrades = useCallback(async () => {
    // 인자 없이 부르면 전체 거래를 돌려준다.
    const { data, error: e } = await supabase.rpc("panel_trades");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setTrades((data ?? []) as AdminTrade[]);
  }, [supabase]);

  const loadRelations = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("panel_relations");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
  }, [supabase]);

  async function approveRelation(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_relation_decide", {
      p_id: id,
      p_approve: true,
      p_reason: null,
    });
    setBusy(false);
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
  }

  async function confirmReject() {
    if (!rejectTarget || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_relation_decide", {
      p_id: rejectTarget.id,
      p_approve: false,
      p_reason: rejectReason.trim(),
    });
    setBusy(false);
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
    setRejectTarget(null);
    setRejectReason("");
  }

  async function deleteRelation(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("panel_relation_delete", {
      p_id: id,
    });
    setBusy(false);
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setRelations((data ?? []) as AdminRelation[]);
  }

  const loadPetitions = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("panel_petitions");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    setPetitions((data ?? []) as AdminPetition[]);
  }, [supabase]);

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
    [supabase, petitionReplyPhoto],
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

  useEffect(() => {
    load();
    loadTrades();
    loadRelations();
    loadPetitions();
    supabase.rpc("panel_items").then(({ data }) => {
      if (data) setCatalog(data as ItemDef[]);
    });
  }, [load, loadTrades, loadRelations, loadPetitions, supabase]);

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

    const result = data as { name: string; code: string };
    setIssued(result);
    setNewName("");
    await load();
  }

  async function deletePlayer() {
    const name = delName.trim();
    const code = delCode.trim();
    if (!name || !code || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setIssued(null);

    const { data, error: rpcError } = await supabase.rpc(
      "panel_delete_player",
      { p_name: name, p_code: code },
    );
    setBusy(false);
    setDelConfirmOpen(false);

    if (rpcError || !data) {
      setError(toKoreanError(rpcError?.message));
      return;
    }

    const result = data as { name: string };
    setNotice(`${result.name} 를 삭제했다.`);
    setDelName("");
    setDelCode("");
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
    // 첨부 사진은 SQL 로 지울 수 없어 여기서 Storage API 로 지운다. 진정은
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

  return (
    <main className="bg-bg-0 min-h-dvh px-3 pb-10 pt-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {/* ── 서식 헤더 ── */}
        <header className="border-line border bg-bg-1">
          <div className="scanline border-line-soft flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-3.5 py-1.5">
            <MonoLabel tone="low">
              <span className="hidden tab:inline">{FORM_LINE}</span>
              <span className="tab:hidden">{FORM_LINE_SHORT}</span>
            </MonoLabel>
            <MonoLabel tone="low">{WATCH_NOTE}</MonoLabel>
          </div>
          <div className="flex items-center gap-3 px-3.5 py-3">
            <div className="min-w-0">
              <MonoLabel tone="low">{LABEL.admin}</MonoLabel>
              <div className="title-19 text-fg-hi mt-1">관리자 단말</div>
            </div>
            <MonoLabel tone="mid" className="truncate">
              {username}
            </MonoLabel>
            <Link href="/play" className={`${PLAIN} ml-auto`}>
              게임으로
            </Link>
          </div>
        </header>

        {error && (
          <p className="mono-13 border border-loss/50 bg-bg-1 px-3.5 py-2.5 text-loss">
            {error}
          </p>
        )}
        {notice && (
          <p className="mono-13 border border-brass-line bg-brass-fill px-3.5 py-2.5 text-fg-hi">
            {notice}
          </p>
        )}

        {/* ── 새 플레이어 ── */}
        <Panel className="flex flex-col gap-2">
          <SectionHead
            title="플레이어 추가"
            desc="이름만 넣으면 겹치지 않는 코드를 서버가 자동으로 만들어 발급한다."
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPlayer()}
              placeholder="이름 (예: 홍길동)"
              className={FIELD}
            />
            <button
              disabled={busy || !newName.trim()}
              onClick={addPlayer}
              className={PRIMARY}
            >
              발급
            </button>
          </div>

          {issued && (
            <div className="mt-1 border border-brass-line bg-brass-fill p-4 text-center">
              <MonoLabel tone="dim">발급 완료</MonoLabel>
              <p className="title-19 text-fg-hi mt-1">{issued.name}</p>
              <p className="num-md text-brass mt-1 tracking-[0.2em] tabular-nums">
                {issued.code}
              </p>
              <p className="mono-13 text-fg-low mt-1">
                이 코드를 본인에게 전달하라.
              </p>
            </div>
          )}
        </Panel>

        {/* ── 진정함 ── */}
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="title-19 text-fg-hi">
              진정함{" "}
              {petitions.filter((p) => p.status === "open").length}건 미답변
            </h2>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {petitionSelectMode && petitionSelected.size > 0 && (
                <button
                  disabled={busy}
                  onClick={() => setPetitionBulkConfirm(true)}
                  className={`${SMALL} text-loss`}
                >
                  {petitionSelected.size}건 삭제
                </button>
              )}
              {petitionSelectMode && (
                <button
                  disabled={closedPetitionIds.length === 0}
                  onClick={() =>
                    setPetitionSelected(
                      allClosedSelected ? new Set() : new Set(closedPetitionIds),
                    )
                  }
                  className={SMALL}
                >
                  {allClosedSelected ? "선택해제" : "전체선택"}
                </button>
              )}
              <button
                disabled={busy || petitions.length === 0}
                onClick={togglePetitionSelectMode}
                className={SMALL}
              >
                {petitionSelectMode ? "취소" : "선택삭제"}
              </button>
              <button onClick={loadPetitions} className={SMALL}>
                새로고침
              </button>
            </div>
          </div>
          {petitionSelectMode && (
            <p className="mono-13 text-fg-low">
              종결된 진정만 선택할 수 있다.
            </p>
          )}

          {petitions.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              접수된 진정이 없다.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {(petitionsListOpen ? petitions : petitions.slice(0, 3)).map(
                  (p) => (
                    <li key={p.id} className="flex flex-col gap-1">
                      <button
                        disabled={petitionSelectMode && p.status !== "closed"}
                        onClick={() =>
                          petitionSelectMode
                            ? togglePetitionSelected(p.id)
                            : openPetitionThread(p.id)
                        }
                        className={`bg-surface state-fade flex w-full items-center gap-3 p-3 text-left hover:bg-surface-hi ${
                          petitionSelectMode && p.status !== "closed"
                            ? "cursor-not-allowed opacity-50"
                            : ""
                        }`}
                      >
                        {petitionSelectMode && p.status === "closed" && (
                          <input
                            type="checkbox"
                            readOnly
                            tabIndex={-1}
                            checked={petitionSelected.has(p.id)}
                            className="accent-brass pointer-events-none h-4 w-4 shrink-0"
                          />
                        )}
                        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
                          <span className="body-15 text-fg-hi">
                            {p.username}
                          </span>
                          <span className="text-fg-low">·</span>
                          <span
                            className={`body-15 ${p.status === "closed" ? "text-fg-low" : "text-fg"}`}
                          >
                            {p.subject}
                          </span>
                          <MonoLabel
                            tone={
                              p.status === "open"
                                ? "dim"
                                : p.status === "answered"
                                  ? "mid"
                                  : "low"
                            }
                          >
                            {PETITION_STATUS_LABEL[p.status]}
                          </MonoLabel>
                          <MonoLabel tone="low" className="ml-auto">
                            {formatShort(p.last_message_at)}
                          </MonoLabel>
                        </div>
                      </button>
                    </li>
                  ),
                )}
              </ul>
              {petitions.length > 3 && (
                <button
                  onClick={() => setPetitionsListOpen((v) => !v)}
                  className={SMALL}
                >
                  {petitionsListOpen
                    ? "접기"
                    : `나머지 ${petitions.length - 3}건 더 보기`}
                </button>
              )}
            </>
          )}

          {petitionThread && (
            <div className="border-line border bg-bg-0 p-3">
              <div className="mb-2 flex items-center gap-2">
                <h3
                  className={`title-19 truncate ${petitionThread.status === "closed" ? "text-fg-low" : "text-fg-hi"}`}
                >
                  {petitionThread.subject}
                </h3>
                <MonoLabel
                  tone={
                    petitionThread.status === "open"
                      ? "dim"
                      : petitionThread.status === "answered"
                        ? "mid"
                        : "low"
                  }
                >
                  {PETITION_STATUS_LABEL[petitionThread.status]}
                </MonoLabel>
                {petitionThread.status !== "closed" && (
                  <button
                    disabled={busy}
                    onClick={() => closePetition(petitionThread.id)}
                    className={`${SMALL} text-loss`}
                  >
                    종결
                  </button>
                )}
                <button
                  onClick={() => setPetitionThread(null)}
                  className={SMALL}
                >
                  닫기
                </button>
                {petitionThread.status === "closed" && (
                  <button
                    disabled={busy}
                    onClick={() => setPetitionDeleteTarget(petitionThread)}
                    className={`${SMALL} text-loss`}
                  >
                    삭제
                  </button>
                )}
              </div>

              <ul className="flex flex-col gap-2">
                {petitionThread.messages.map((m) => (
                  <li
                    key={m.id}
                    className={`p-3 ${
                      m.is_admin_reply
                        ? "border-brass-line border bg-brass-fill"
                        : "bg-surface"
                    }`}
                  >
                    <div className="mb-1 flex items-baseline gap-2">
                      <span
                        className={`label-11 ${
                          m.is_admin_reply ? "text-brass" : "text-fg-mid"
                        }`}
                      >
                        {m.author}
                      </span>
                      <MonoLabel tone="low" className="ml-auto">
                        {formatShort(m.created_at)}
                      </MonoLabel>
                    </div>
                    <p className="body-15 text-fg whitespace-pre-wrap">
                      {m.body}
                    </p>
                    {m.image_path && (
                      <PetitionPhoto supabase={supabase} path={m.image_path} />
                    )}
                  </li>
                ))}
              </ul>

              {petitionThread.status === "closed" ? (
                <p className="mono-13 text-fg-low mt-2 text-center">
                  종결된 진정이라 답변을 더 달 수 없다.
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea
                    value={petitionReply}
                    onChange={(e) => setPetitionReply(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="답변을 적어라. 신청자에게 '관리자'로만 표시된다."
                    className={`${FIELD} min-h-20 resize-none`}
                  />
                  <div className="flex items-end justify-end gap-2">
                    <PhotoAttachControl attach={petitionReplyPhoto} disabled={busy} />
                    <button
                      disabled={busy || !petitionReply.trim()}
                      onClick={sendPetitionReply}
                      className={PRIMARY}
                    >
                      답변 등록
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* ── 진정 삭제 확인 팝업 ── */}
        {petitionDeleteTarget && (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setPetitionDeleteTarget(null)}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>삭제 확인</MonoLabel>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg">
                  {petitionDeleteTarget.username} 의 &quot;
                  {petitionDeleteTarget.subject}&quot; 을(를) 삭제한다.
                  되돌릴 수 없다.
                </p>
                {error && <p className="mono-13 text-loss">{error}</p>}
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => deletePetition(petitionDeleteTarget.id)}
                    className={`${DANGER} flex-1`}
                  >
                    삭제 확정
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setPetitionDeleteTarget(null)}
                    className={`${PLAIN} flex-1`}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 진정 일괄 삭제 확인 팝업 ── */}
        {petitionBulkConfirm && (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setPetitionBulkConfirm(false)}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>삭제 확인</MonoLabel>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg">
                  종결된 진정 {petitionSelected.size}건을 삭제한다. 되돌릴 수
                  없다.
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() =>
                      // 새로고침으로 사라진 건은 빼고 보낸다.
                      deletePetitions(
                        closedPetitionIds.filter((id) =>
                          petitionSelected.has(id),
                        ),
                      )
                    }
                    className={`${DANGER} flex-1`}
                  >
                    {busy ? "삭제 중…" : "삭제 확정"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setPetitionBulkConfirm(false)}
                    className={`${PLAIN} flex-1`}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 관계 심사 ── */}
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="title-19 text-fg-hi">
              관계 신청 {relations.filter((r) => r.status === "pending").length}건
              대기
            </h2>
            <button onClick={loadRelations} className={`${SMALL} ml-auto`}>
              새로고침
            </button>
          </div>

          {relations.filter((r) => r.status === "pending").length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              대기 중인 신청이 없다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {relations
                .filter((r) => r.status === "pending")
                .map((r) => (
                <li key={r.id} className="bg-surface flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="body-15 text-fg-hi">{r.username}</span>
                    {r.partner && (
                      <>
                        <span className="text-fg-low">↔</span>
                        <span className="body-15 text-fg-hi">{r.partner}</span>
                      </>
                    )}
                    <MonoLabel
                      tone={r.status === "pending" ? "dim" : "low"}
                    >
                      {RELATION_STATUS_LABEL[r.status] ?? r.status}
                    </MonoLabel>
                    <MonoLabel tone="low" className="ml-auto">
                      {new Date(r.created_at).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </MonoLabel>
                  </div>
                  <p className="body-15 text-fg whitespace-pre-wrap break-words">{r.body}</p>
                  {r.status === "rejected" && r.reject_reason && (
                    <p className="mono-13 text-fg-mid border-line-soft bg-bg-1 border px-3 py-2">
                      반려 사유: {r.reject_reason}
                    </p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {r.status === "pending" && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => approveRelation(r.id)}
                          className={PRIMARY}
                        >
                          수락
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setRejectTarget(r);
                            setRejectReason("");
                          }}
                          className={PLAIN}
                        >
                          반려
                        </button>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <button
                        disabled={busy}
                        onClick={() => deleteRelation(r.id)}
                        className={`${SMALL} text-loss`}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── 반려 사유 입력 팝업 ── */}
        {rejectTarget && (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setRejectTarget(null)}
          >
            <div
              className="border-line w-full max-w-md border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>반려 사유</MonoLabel>
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  disabled={busy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="body-15 text-fg-hi">
                    {rejectTarget.username}
                  </span>
                  {rejectTarget.partner && (
                    <>
                      <span className="text-fg-low">↔</span>
                      <span className="body-15 text-fg-hi">
                        {rejectTarget.partner}
                      </span>
                    </>
                  )}
                </div>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  maxLength={300}
                  rows={4}
                  placeholder="반려 사유를 적어라. 신청자에게 그대로 보인다."
                  className={`${FIELD} min-h-24 resize-none`}
                />
                {error && <p className="mono-13 text-loss">{error}</p>}
                <div className="flex gap-2">
                  <button
                    disabled={busy || rejectReason.trim().length === 0}
                    onClick={confirmReject}
                    className={`${PRIMARY} flex-1`}
                  >
                    반려 확정
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setRejectTarget(null)}
                    className={`${PLAIN} flex-1`}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 목록 ── */}
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="title-19 text-fg-hi">
              플레이어 {listLoading && players.length === 0 ? "조회 중" : `${players.length}명`}
            </h2>
            <button
              onClick={() => setShowCodes((v) => !v)}
              className={`${SMALL} ml-auto`}
            >
              {showCodes ? "코드 숨기기" : "코드 보기"}
            </button>
            <button onClick={load} className={SMALL}>
              새로고침
            </button>
          </div>

          {/* 이미 읽어 둔 명단이 있는데 새로고침이 실패한 경우 — 표는 그대로 두고 여기서만 알린다 */}
          {listError && players.length > 0 && (
            <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">
              명단을 새로 읽지 못했다 — {listError} (아래는 마지막으로 읽은 값이다)
            </p>
          )}

          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[38rem] text-left">
              <thead>
                <tr className="label-11 text-fg-low border-line-soft border-b">
                  <th className="pb-2 pr-2 font-normal">이름</th>
                  <th className="pb-2 pr-2 font-normal">코드</th>
                  <th className="pb-2 pr-2 font-normal">상태</th>
                  <th className="pb-2 pr-2 text-right font-normal">체력</th>
                  <th className="pb-2 pr-2 text-right font-normal">코인</th>
                  <th className="pb-2 pr-2 text-right font-normal">횟수</th>
                  <th className="pb-2 font-normal">소지품</th>
                </tr>
              </thead>
              <tbody className="mono-13">
                {players.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6">
                      <p
                        className={`scanline-faint mono-13 border-line border border-dashed px-3 py-6 text-center ${
                          listError ? "text-loss" : "text-fg-low"
                        }`}
                      >
                        {listError
                          ? `명단을 읽지 못했다 — ${listError}`
                          : listLoading
                            ? "명단을 읽는 중"
                            : "등록된 플레이어 없음"}
                      </p>
                    </td>
                  </tr>
                )}
                {players.map((p) => (
                  <tr
                    key={p.username}
                    onClick={() => openDetail(p.username)}
                    className="border-line-soft state-fade cursor-pointer border-b hover:bg-surface"
                  >
                    <td className="text-fg-hi py-2 pr-2">
                      {p.username}
                      {p.is_admin && (
                        <span className="label-11 text-brass ml-1">ADMIN</span>
                      )}
                    </td>
                    <td className="text-fg-mid py-2 pr-2 tabular-nums">
                      {showCodes ? p.code : "••••-••••••"}
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={p.in_ward ? "text-loss" : "text-fg-mid"}
                      >
                        {p.hp_status}
                      </span>
                      {p.suspended_until && (
                        <span className="label-11 text-loss ml-1">정지</span>
                      )}
                    </td>
                    <td className="text-fg-mid py-2 pr-2 text-right tabular-nums">
                      {p.hp}
                    </td>
                    <td className="text-brass py-2 pr-2 text-right tabular-nums">
                      {p.coins}
                    </td>
                    <td className="text-fg-mid py-2 pr-2 text-right tabular-nums">
                      {p.plays_left}
                      {p.bonus_plays > 0 && (
                        <span className="text-brass ml-1">+{p.bonus_plays}</span>
                      )}
                    </td>
                    <td className="py-2">
                      {p.items.length === 0 ? (
                        <span className="text-fg-low">-</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {p.items.map((it) => (
                            <span
                              key={it.code}
                              title={`${it.name} ×${it.qty}`}
                              className="bg-surface text-fg-mid whitespace-nowrap px-1.5 py-0.5"
                            >
                              {it.emoji}
                              <span className="text-fg ml-0.5 tabular-nums">
                                {it.qty}
                              </span>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mono-13 text-fg-low">
            이름을 누르면 상세를 볼 수 있다. 코드는 되돌릴 수 없는 해시로
            저장되므로 확인용으로 따로 보관한 값이며, 이 표는 관리자에게만 보인다.
          </p>
        </Panel>

        {/* ── 플레이어 상세 ── */}
        {detail && (
          <Panel className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="title-19 text-fg-hi">{detail.username}</h2>
              <span
                className={`mono-13 ${detail.in_ward ? "text-loss" : "text-fg-mid"}`}
              >
                {detail.hp_status}
              </span>
              <button
                onClick={() => openDetail(detail.username)}
                className={`${SMALL} ml-auto`}
              >
                새로고침
              </button>
              <button
                onClick={() => {
                  if (detail.suspended_until) {
                    setSuspendPopup("unsuspend");
                  } else {
                    setSuspendDays(7);
                    setSuspendReason("");
                    setSuspendPopup("suspend");
                  }
                }}
                className={detail.suspended_until ? DANGER : SMALL}
              >
                {detail.suspended_until ? "정지 해제" : "일시중지"}
              </button>
              <button onClick={() => setDetail(null)} className={SMALL}>
                닫기
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="코인" value={detail.coins} brass />
              <Stat label="체력" value={`${detail.hp} / ${detail.hp_max}`} />
              <Stat
                label="남은 게임"
                value={`${detail.plays_left} (보너스 ${detail.bonus_plays})`}
              />
              <Stat
                label="병동"
                value={
                  detail.in_ward
                    ? formatDuration(detail.ward_left) + " 남음"
                    : "-"
                }
              />
              <Stat label="빚" value={detail.debt} />
              <Stat label="판돈 2배" value={`${detail.win_double}회`} />
              <Stat label="오늘 사용" value={`${detail.plays_used}판`} />
              <Stat
                label="발급일"
                value={new Date(detail.created_at).toLocaleDateString("ko-KR")}
              />
              <Stat
                label="정지"
                value={
                  detail.suspended_until
                    ? formatDaysLeft(
                        Math.max(
                          0,
                          (new Date(detail.suspended_until).getTime() -
                            Date.now()) /
                            1000,
                        ),
                      ) + " 남음"
                    : "-"
                }
              />
            </div>

            {detail.suspended_until && (
              <p className="mono-13 border-loss/40 border bg-bg-0 px-3 py-2 text-loss">
                정지 사유: {detail.suspend_reason || "미기재"}
              </p>
            )}

            <div>
              <MonoLabel tone="low">소지품 {detail.items.length}종</MonoLabel>
              {detail.items.length === 0 ? (
                <p className="mono-13 text-fg-low mt-2">가진 아이템이 없다.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.items.map((it) => (
                    <button
                      key={it.code}
                      type="button"
                      disabled={it.qty === 0}
                      onClick={() => openTakeItem(it)}
                      className="mono-13 bg-surface state-fade flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-hi disabled:opacity-50"
                    >
                      <span>{it.emoji}</span>
                      <span className="text-fg-hi">{it.name}</span>
                      <MonoLabel tone="low">
                        {ITEM_GRADE_LABEL[it.grade]}
                      </MonoLabel>
                      <span className="text-fg-mid tabular-nums">
                        ×{it.qty}
                        {/* 봉인된 갑은 회수 대상이지만, 개봉한 갑에 남은 개비는
                            panel_take_item 이 손대지 않는다 — 그대로 안내만 한다. */}
                        {!!it.open_left && ` (+${it.open_left}개비)`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="mono-13 text-fg-low mt-1.5">
                소지품을 누르면 회수할 수 있다.
              </p>
            </div>

            <div>
              <MonoLabel tone="low">최근 기록</MonoLabel>
              {detail.ledger.length === 0 ? (
                <p className="mono-13 text-fg-low mt-2">기록이 없다.</p>
              ) : (
                <ul className="mt-2 flex flex-col">
                  {detail.ledger.map((e) => {
                    // 거래 기록은 눌러서 상세를 연다.
                    const trade =
                      e.kind === "trade"
                        ? tradeLedger.find((t) => t.id === e.id)
                        : undefined;
                    return (
                      <li
                        key={e.id}
                        onClick={trade ? () => openLedgerPopup(trade) : undefined}
                        className={`mono-13 border-line-soft grid grid-cols-[46px_minmax(0,1fr)_54px] items-baseline gap-2 border-b py-1.5 ${
                          trade ? "state-fade cursor-pointer hover:bg-surface" : ""
                        }`}
                      >
                        <span className="text-fg-low truncate">
                          {LEDGER_KIND_LABEL[e.kind] ?? e.kind}
                        </span>
                        <span className="text-fg truncate">
                          {e.kind === "labor" ? laborTitle(e.title) : e.title}
                        </span>
                        <span
                          className={`text-right tabular-nums ${
                            e.coin_delta < 0 ? "text-loss" : "text-fg-hi"
                          }`}
                        >
                          {e.coin_delta > 0 ? `+${e.coin_delta}` : e.coin_delta}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <MonoLabel tone="low">거래 기록 {tradeLedger.length}건</MonoLabel>
              {tradeLedger.length === 0 ? (
                <p className="mono-13 text-fg-low mt-2">거래한 적이 없다.</p>
              ) : (
                <>
                  <ul className="mt-2 flex flex-col">
                    {(tradeLedgerOpen ? tradeLedger : tradeLedger.slice(0, 5)).map(
                      (e) => {
                        const st = ledgerState(e);
                        return (
                          <li
                            key={e.id}
                            onClick={() => openLedgerPopup(e)}
                            className="mono-13 border-line-soft state-fade flex cursor-pointer items-baseline gap-2 border-b py-1.5 hover:bg-surface"
                          >
                            <span className="text-fg-low shrink-0">
                              {formatShort(e.created_at)}
                            </span>
                            <span className="text-fg truncate">{e.title}</span>
                            {e.partner_deleted && (
                              <MonoLabel tone="low">삭제됨</MonoLabel>
                            )}
                            <MonoLabel
                              tone={st.actionable ? "dim" : "low"}
                              className="ml-auto shrink-0"
                            >
                              {st.label}
                            </MonoLabel>
                          </li>
                        );
                      },
                    )}
                  </ul>
                  {tradeLedger.length > 5 && (
                    <button
                      onClick={() => setTradeLedgerOpen((v) => !v)}
                      className={`${SMALL} mt-1.5`}
                    >
                      {tradeLedgerOpen
                        ? "접기"
                        : `나머지 ${tradeLedger.length - 5}건 더 보기`}
                    </button>
                  )}
                </>
              )}
              <p className="mono-13 text-fg-low mt-1.5">
                거래를 누르면 내용을 보고 회수할 수 있다. 상대가 삭제된
                거래는 이 사람이 받은 것만 거둔다.
              </p>
            </div>
          </Panel>
        )}

        {/* ── 거래 기록 상세 팝업 ── */}
        {detail && ledgerPopup && (() => {
          const e = ledgerPopup;
          const st = ledgerState(e);
          return (
            <div
              className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={() => !busy && setLedgerPopup(null)}
            >
              <div
                className="border-line max-h-[90dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                  <MonoLabel>거래 기록</MonoLabel>
                  <button
                    type="button"
                    onClick={() => setLedgerPopup(null)}
                    disabled={busy}
                    className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                  >
                    닫기
                  </button>
                </div>
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="body-15 text-fg-hi">{detail.username}</span>
                    <span className="text-fg-low">↔</span>
                    <span className="body-15 text-fg-hi">{e.partner}</span>
                    {e.partner_deleted && <MonoLabel tone="low">삭제됨</MonoLabel>}
                    <MonoLabel tone="low" className="ml-auto">
                      {new Date(e.created_at).toLocaleString("ko-KR")}
                    </MonoLabel>
                  </div>
                  <p className="body-15 text-fg">{e.title}</p>
                  <div className="mono-13 bg-surface flex flex-col gap-0.5 p-3">
                    <p>
                      <span className="text-fg-low">준 것 </span>
                      <Offer coins={e.gave_coins} items={e.gave_items} />
                    </p>
                    <p>
                      <span className="text-fg-low">받은 것 </span>
                      <Offer coins={e.got_coins} items={e.got_items} />
                    </p>
                    {e.confiscated && (
                      <p>
                        <span className="text-loss">회수 </span>
                        <Offer
                          coins={e.confiscated.coins}
                          items={e.confiscated.items}
                        />
                      </p>
                    )}
                  </div>
                  <p className="mono-13 text-fg-mid">
                    상태: {st.label}
                    {e.trade && ` · 거래 #${e.trade.id}`}
                  </p>
                  {e.maybe_reverted && !e.trade && !e.confiscated && (
                    <p className="mono-13 border-loss/40 border bg-bg-0 px-3 py-2 text-loss">
                      이 기록 뒤에 같은 상대와의 &quot;거래 취소 — 회수&quot;
                      기록이 있다. 이미 처리된 거래일 수 있으니 확인하고 진행하라.
                    </p>
                  )}

                  {st.kind === "revert" && (
                    <p className="body-15 text-fg">
                      거래 목록에 남아 있는 거래라 양쪽이 받은 것을 각자에게서
                      압수한다
                      {(e.trade?.from_deleted || e.trade?.to_deleted) &&
                        " (삭제된 사람 몫은 건너뛴다)"}
                      . 되돌릴 수 없다.
                    </p>
                  )}
                  {st.kind === "confiscate" && (
                    <p className="body-15 text-fg">
                      {detail.username} 이(가) 이 거래로 받은 것을 거둔다.
                      이미 쓴 몫은 건너뛰고 지금 가진 만큼만(코인은 잔액까지,
                      장착 중이면 해제 후) 거둔다. 되돌릴 수 없다.
                    </p>
                  )}

                  {st.actionable && (
                    <>
                      <ReasonPicker
                        category={ledgerReason}
                        note={ledgerNote}
                        onCategory={setLedgerReason}
                        onNote={setLedgerNote}
                        disabled={busy}
                      />
                      {error && <p className="mono-13 text-loss">{error}</p>}
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={
                            st.kind === "revert"
                              ? confirmLedgerRevert
                              : confirmLedgerConfiscate
                          }
                          className={`${DANGER} flex-1`}
                        >
                          {st.kind === "revert" ? "거래 취소(양쪽)" : "받은 것 회수"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setLedgerPopup(null)}
                          className={`${PLAIN} flex-1`}
                        >
                          취소
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── 소지품 회수 팝업 ── */}
        {detail && takeTarget && (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setTakeTarget(null)}
          >
            <div
              className="border-line w-full max-w-md border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>소지품 회수</MonoLabel>
                <button
                  type="button"
                  onClick={() => setTakeTarget(null)}
                  disabled={busy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <div className="flex items-baseline gap-2">
                  <span>{takeTarget.emoji}</span>
                  <span className="body-15 text-fg-hi">{takeTarget.name}</span>
                  <MonoLabel tone="low" className="ml-auto">
                    보유 {takeTarget.held}개
                  </MonoLabel>
                </div>
                <input
                  type="number"
                  min={1}
                  max={takeTarget.held}
                  value={takeQty}
                  onChange={(e) =>
                    setTakeQty(
                      Math.max(
                        1,
                        Math.min(takeTarget.held, Number(e.target.value)),
                      ),
                    )
                  }
                  className={FIELD}
                />
                <ReasonPicker
                  category={takeReason}
                  note={takeNote}
                  onCategory={setTakeReason}
                  onNote={setTakeNote}
                  disabled={busy}
                  placeholder="회수 사유 — 예: 부정 수급 조사"
                />
                {error && <p className="mono-13 text-loss">{error}</p>}
                <div className="flex gap-2">
                  <button
                    disabled={
                      busy || takeQty < 1 || takeQty > takeTarget.held
                    }
                    onClick={confirmTakeItem}
                    className={`${DANGER} flex-1`}
                  >
                    회수
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setTakeTarget(null)}
                    className={`${PLAIN} flex-1`}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 정지 / 정지 해제 팝업 ── */}
        {detail && suspendPopup === "suspend" && (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setSuspendPopup(null)}
          >
            <div
              className="border-line w-full max-w-sm border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>{detail.username} 일시중지</MonoLabel>
                <button
                  type="button"
                  onClick={() => setSuspendPopup(null)}
                  disabled={busy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <MonoLabel tone="low">정지 일수</MonoLabel>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={suspendDays}
                  onChange={(e) =>
                    setSuspendDays(
                      Math.max(1, Math.min(365, Number(e.target.value))),
                    )
                  }
                  className={FIELD}
                />
                <Presets
                  values={[1, 3, 7, 14, 30]}
                  value={suspendDays}
                  onPick={setSuspendDays}
                />
                <input
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  maxLength={200}
                  placeholder="정지 사유 (예: 부정 수급 조사)"
                  className={FIELD}
                />
                {error && <p className="mono-13 text-loss">{error}</p>}
                <div className="flex gap-2">
                  <button
                    disabled={busy || suspendDays < 1 || suspendDays > 365}
                    onClick={confirmSuspend}
                    className={`${DANGER} flex-1`}
                  >
                    정지
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setSuspendPopup(null)}
                    className={`${PLAIN} flex-1`}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {detail && suspendPopup === "unsuspend" && (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setSuspendPopup(null)}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>정지 해제 확인</MonoLabel>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg">
                  {detail.username} 의 정지를 지금 해제한다. 정말 해제하겠나?
                </p>
                {error && <p className="mono-13 text-loss">{error}</p>}
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={confirmUnsuspend}
                    className={`${PRIMARY} flex-1`}
                  >
                    해제 확정
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setSuspendPopup(null)}
                    className={`${PLAIN} flex-1`}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 플레이어 삭제 ── */}
        <Panel className="flex flex-col gap-2">
          <SectionHead
            title="플레이어 삭제"
            desc="이름과 코드가 모두 맞아야 지운다. 지우면 기록도 함께 사라진다."
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={delName}
              onChange={(e) => setDelName(e.target.value)}
              placeholder="이름"
              className={FIELD}
            />
            <input
              value={delCode}
              onChange={(e) => setDelCode(e.target.value)}
              placeholder="코드 (0000-XXXXXX)"
              className={FIELD}
            />
            <button
              disabled={busy || !delName.trim() || !delCode.trim()}
              onClick={() => setDelConfirmOpen(true)}
              className={DANGER}
            >
              삭제
            </button>
          </div>
        </Panel>

        {/* ── 삭제 확인 팝업 ── */}
        {delConfirmOpen && (
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !busy && setDelConfirmOpen(false)}
          >
            <div
              className="border-line w-full max-w-xs border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>삭제 확인</MonoLabel>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="body-15 text-fg">
                  {delName} 을(를) 삭제한다. 코인·소지품·관계·기록이 전부
                  사라지고 되돌릴 수 없다. 정말 삭제하겠나?
                </p>
                {error && <p className="mono-13 text-loss">{error}</p>}
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={deletePlayer}
                    className={`${DANGER} flex-1`}
                  >
                    삭제 확정
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setDelConfirmOpen(false)}
                    className={`${PLAIN} flex-1`}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 코인 지급 ── */}
        <Panel className="flex flex-col gap-2">
          <SectionHead
            title="코인 지급"
            desc="음수를 넣으면 회수된다. 잔액은 0 밑으로 내려가지 않는다. 고른 사유는 받은 사람의 수감기록에 그대로 남는다."
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={FIELD}
            >
              <option value="">플레이어 선택…</option>
              {players.map((p) => (
                <option key={p.username} value={p.username}>
                  {p.username} ({p.coins} 코인)
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={amountText}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^-?\d*$/.test(raw)) return;
                  setAmountText(raw);
                  setAmount(raw === "" || raw === "-" ? 0 : Number(raw));
                }}
                className={`${FIELD} sm:w-32`}
              />
              <button
                disabled={busy || !target || amount === 0}
                onClick={grantCoins}
                className={PLAIN}
              >
                지급
              </button>
            </div>
          </div>
          <Presets
            values={[10, 20, 50, 100, 500]}
            value={amount}
            onPick={(n) => {
              setAmount(n);
              setAmountText(String(n));
            }}
          />
          <ReasonPicker
            category={coinReason}
            note={coinNote}
            onCategory={setCoinReason}
            onNote={setCoinNote}
            disabled={busy}
          />
        </Panel>

        {/* ── 아이템 지급 ── */}
        <Panel className="flex flex-col gap-2">
          <SectionHead
            title="아이템 지급"
            desc="배급소 순환과 무관하게 모든 아이템을 줄 수 있다. 음수를 넣으면 회수된다. 고른 사유는 받은 사람의 수감기록에 그대로 남는다."
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={itemTarget}
              onChange={(e) => setItemTarget(e.target.value)}
              className={FIELD}
            >
              <option value="">플레이어 선택…</option>
              {players.map((p) => (
                <option key={p.username} value={p.username}>
                  {p.username}
                </option>
              ))}
            </select>
            <select
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              className={FIELD}
            >
              <option value="">아이템 선택…</option>
              {catalog.map((it) => (
                <option key={it.code} value={it.code}>
                  [{ITEM_GRADE_LABEL[it.grade]}] {it.name} — {itemEffect(it)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={itemQtyText}
              onChange={(e) => {
                const raw = e.target.value;
                if (!/^-?\d*$/.test(raw)) return;
                setItemQtyText(raw);
                setItemQty(raw === "" || raw === "-" ? 0 : Number(raw));
              }}
              className={`${FIELD} sm:w-28`}
            />
            <button
              disabled={busy || !itemTarget || !itemCode || itemQty === 0}
              onClick={giveItem}
              className={PRIMARY}
            >
              지급
            </button>
          </div>
          <ReasonPicker
            category={itemReason}
            note={itemNote}
            onCategory={setItemReason}
            onNote={setItemNote}
            disabled={busy}
          />
        </Panel>

        {/* ── 게임 횟수 ── */}
        <Panel className="flex flex-col gap-2">
          <SectionHead
            title="게임 횟수"
            desc="초기화는 오늘 쓴 횟수를 0으로 되돌린다. 추가는 기본 한도 위에 얹으며, 아이템의 하루 상한과는 별개다."
          />
          <select
            value={playTarget}
            onChange={(e) => setPlayTarget(e.target.value)}
            className={FIELD}
          >
            <option value="">플레이어 선택…</option>
            {players.map((p) => (
              <option key={p.username} value={p.username}>
                {p.username} (남은 {p.plays_left} · 사용 {p.plays_used} · 보너스{" "}
                {p.bonus_plays})
              </option>
            ))}
          </select>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              disabled={busy || !playTarget}
              onClick={() => adjustPlays("reset")}
              className={PLAIN}
            >
              오늘 사용분 초기화
            </button>
            <div className="flex flex-1 gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={playAmountText}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^-?\d*$/.test(raw)) return;
                  setPlayAmountText(raw);
                  setPlayAmount(raw === "" || raw === "-" ? 0 : Number(raw));
                }}
                className={`${FIELD} sm:w-28`}
              />
              <button
                disabled={busy || !playTarget || playAmount === 0}
                onClick={() => adjustPlays("give")}
                className={PRIMARY}
              >
                횟수 추가
              </button>
            </div>
          </div>
          <Presets
            values={[1, 3, 5, 10, -5]}
            value={playAmount}
            onPick={(n) => {
              setPlayAmount(n);
              setPlayAmountText(String(n));
            }}
            signed
          />
          {/* 초기화에는 붙지 않는다 — 사유가 남는 건 "횟수 추가" 쪽뿐이다. */}
          <ReasonPicker
            category={playReason}
            note={playNote}
            onCategory={setPlayReason}
            onNote={setPlayNote}
            disabled={busy}
          />
        </Panel>

        {/* ── 거래 내역 ── */}
        <Panel className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="title-19 text-fg-hi">
              유저 간 거래 {trades.length}건
            </h2>
            <button onClick={loadTrades} className={`${SMALL} ml-auto`}>
              새로고침
            </button>
          </div>

          {trades.length === 0 ? (
            <p className="scanline-faint mono-13 text-fg-low border-line border border-dashed px-3 py-6 text-center">
              아직 거래가 없다.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {(tradesListOpen ? trades : trades.slice(0, 5)).map((t) => (
                  <li
                    key={t.id}
                    className="bg-surface flex flex-col gap-1.5 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="body-15 text-fg-hi">{t.from}</span>
                      {t.from_deleted && <MonoLabel tone="low">삭제됨</MonoLabel>}
                      <span className="text-fg-low">→</span>
                      <span className="body-15 text-fg-hi">{t.to}</span>
                      {t.to_deleted && <MonoLabel tone="low">삭제됨</MonoLabel>}
                      {t.is_gift && <MonoLabel>선물</MonoLabel>}
                      <MonoLabel tone="low" className="ml-auto">
                        {TRADE_STATUS_LABEL[t.status]}
                      </MonoLabel>
                      <MonoLabel tone="low">
                        {new Date(t.created_at).toLocaleString("ko-KR", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </MonoLabel>
                    </div>
                    <div className="mono-13 flex flex-col gap-0.5">
                      <p>
                        <span className="text-fg-low">보냄 </span>
                        <Offer coins={t.from_coins} items={t.from_items} />
                      </p>
                      <p>
                        <span className="text-fg-low">받음 </span>
                        <Offer coins={t.to_coins} items={t.to_items} />
                      </p>
                      {t.reverted_detail && (
                        <>
                          <p>
                            <span className="text-loss">회수 </span>
                            <span className="text-fg-low">{t.from} </span>
                            <Offer
                              coins={t.reverted_detail.from_coins}
                              items={t.reverted_detail.from_items}
                            />
                          </p>
                          <p>
                            <span className="text-loss">회수 </span>
                            <span className="text-fg-low">{t.to} </span>
                            <Offer
                              coins={t.reverted_detail.to_coins}
                              items={t.reverted_detail.to_items}
                            />
                          </p>
                        </>
                      )}
                    </div>

                    {t.status === "done" && revertId !== t.id && (
                      <button
                        onClick={() => openRevert(t.id)}
                        disabled={busy}
                        className={`${SMALL} self-end`}
                      >
                        거래 취소
                      </button>
                    )}

                    {t.status === "done" && revertId === t.id && (
                      <div className="border-loss/60 flex flex-col gap-2 border border-dashed p-3">
                        <p className="body-15 text-fg">
                          양쪽이 이 거래로 받은 것을 각자에게서 압수한다.
                          돌려주지 않으며, 이미 쓴 몫은 건너뛰고 지금 가진
                          만큼만(코인은 잔액까지, 장착 중이면 해제 후) 거둔다.
                          되돌릴 수 없다.
                        </p>
                        {(t.from_deleted || t.to_deleted) && (
                          <p className="mono-13 text-fg-mid">
                            삭제된 사람(
                            {[t.from_deleted && t.from, t.to_deleted && t.to]
                              .filter(Boolean)
                              .join(", ")}
                            ) 몫은 거둘 것이 없어 건너뛴다.
                          </p>
                        )}
                        <ReasonPicker
                          category={revertReason}
                          note={revertNote}
                          onCategory={setRevertReason}
                          onNote={setRevertNote}
                          disabled={busy}
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => setRevertId(null)}
                            disabled={busy}
                            className={PLAIN}
                          >
                            닫기
                          </button>
                          <button
                            onClick={confirmRevertTrade}
                            disabled={busy}
                            className={DANGER}
                          >
                            취소 확정
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {trades.length > 5 && (
                <button
                  onClick={() => setTradesListOpen((v) => !v)}
                  className={SMALL}
                >
                  {tradesListOpen
                    ? "접기"
                    : `나머지 ${trades.length - 5}건 더 보기`}
                </button>
              )}
            </>
          )}
        </Panel>
      </div>
    </main>
  );
}

/**
 * 거래 기록 한 줄로 할 수 있는 일.
 *   revert     — 거래 목록에 남은 성립 거래: 거래 취소(양쪽 회수)
 *   confiscate — 상대가 삭제돼 거래 행이 없음: 이 사람이 받은 것만 회수
 */
function ledgerState(e: AdminTradeLedger): {
  kind: "revert" | "confiscate" | "none";
  label: string;
  actionable: boolean;
} {
  if (e.confiscated) return { kind: "none", label: "회수됨", actionable: false };
  if (e.trade) {
    if (e.trade.status === "done")
      return { kind: "revert", label: "양쪽 취소 가능", actionable: true };
    return {
      kind: "none",
      label: TRADE_STATUS_LABEL[e.trade.status],
      actionable: false,
    };
  }
  if (e.got_coins === 0 && e.got_items.length === 0)
    return { kind: "none", label: "받은 것 없음", actionable: false };
  return { kind: "confiscate", label: "회수 가능", actionable: true };
}

function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="title-19 text-fg-hi">{title}</h2>
      <p className="body-15 text-fg-mid">{desc}</p>
    </div>
  );
}

/** 자주 쓰는 값 프리셋 칩 */
function Presets({
  values,
  value,
  onPick,
  signed = false,
}: {
  values: number[];
  value: number;
  onPick: (n: number) => void;
  signed?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={`state-fade mono-13 flex-1 border py-1.5 tabular-nums ${
            value === v
              ? "border-brass-line bg-brass-fill text-fg-hi"
              : "border-line bg-surface text-fg-mid"
          }`}
        >
          {signed && v > 0 ? `+${v}` : v}
        </button>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  brass = false,
}: {
  label: string;
  value: React.ReactNode;
  brass?: boolean;
}) {
  return (
    <div className="bg-surface flex flex-col gap-1 p-3">
      <MonoLabel tone="mid">{label}</MonoLabel>
      <div className={`mono-13 ${brass ? "text-brass" : "text-fg-hi"}`}>
        {value}
      </div>
    </div>
  );
}

function Offer({ coins, items }: { coins: number; items: TradeItem[] }) {
  if (coins === 0 && items.length === 0) {
    return <span className="text-fg-low">없음</span>;
  }
  return (
    <span className="text-fg">
      {coins > 0 && <span className="text-brass">{coins} 코인</span>}
      {coins > 0 && items.length > 0 && <span className="text-fg-low"> + </span>}
      {items.map((i, n) => (
        <span key={i.code}>
          {n > 0 && <span className="text-fg-low">, </span>}
          {i.emoji} {i.name} ×{i.qty}
        </span>
      ))}
    </span>
  );
}
