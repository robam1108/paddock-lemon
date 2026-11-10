"use client";

import { ITEM_GRADE_LABEL, itemEffect } from "@/lib/game";
import Panel from "../ui/Panel";
import { FIELD, PLAIN, Presets, PRIMARY, ReasonPicker, SectionHead } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 코인 · 아이템 지급과 게임 횟수 조정. */
export default function GrantSection({ m }: { m: AdminModel }) {
  const {
    adjustPlays,
    amount,
    amountText,
    busy,
    catalog,
    coinNote,
    coinReason,
    giveItem,
    grantCoins,
    itemCode,
    itemNote,
    itemQty,
    itemQtyText,
    itemReason,
    itemTarget,
    playAmount,
    playAmountText,
    playNote,
    playReason,
    playTarget,
    players,
    setAmount,
    setAmountText,
    setCoinNote,
    setCoinReason,
    setItemCode,
    setItemNote,
    setItemQty,
    setItemQtyText,
    setItemReason,
    setItemTarget,
    setPlayAmount,
    setPlayAmountText,
    setPlayNote,
    setPlayReason,
    setPlayTarget,
    setTarget,
    target,
  } = m;
  return (
    <>
      {/* ── 코인 지급 ── */}
      <Panel className="flex flex-col gap-2">
        <SectionHead
          title="코인 지급"
          desc="음수를 넣으면 회수된다. 잔액은 0 밑으로 내려가지 않는다. 고른 사유는 받은 사람의 프로필 기록에 그대로 남는다."
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
          desc="상점 진열과 무관하게 모든 아이템을 줄 수 있다. 음수를 넣으면 회수된다. 고른 사유는 받은 사람의 프로필 기록에 그대로 남는다."
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

    </>
  );
}
