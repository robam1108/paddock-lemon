import {
  KIND_DESC,
  KIND_NAME,
  oddsText,
  ticketOdds,
  type Race,
  type RaceKind,
} from "@/lib/race";
import BetControl from "../BetControl";
import TabRail from "../ui/TabRail";
import { Chip } from "./RaceResult";

const KINDS: { id: RaceKind; label: string }[] = [
  { id: "win", label: KIND_NAME.win },
  { id: "place", label: KIND_NAME.place },
  { id: "quin", label: KIND_NAME.quin },
];

/** 마권 한 장 고르기 — 승식 · 고른 말 · 금액. 말은 출전표에서 고른다. */
export default function BetSlip({
  race,
  kind,
  onKind,
  picks,
  amount,
  onAmount,
  minBet,
  maxBet,
  spent,
  coins,
  hp,
  busy,
  onBuy,
}: {
  race: Race;
  kind: RaceKind;
  onKind: (k: RaceKind) => void;
  picks: number[];
  amount: number;
  onAmount: (n: number) => void;
  minBet: number;
  maxBet: number;
  spent: number;
  coins: number;
  hp: number;
  busy: boolean;
  onBuy: (amount: number) => void;
}) {
  const room = maxBet - spent;
  // 테스트 경주는 코인을 움직이지 않으므로 잔액으로 막지 않는다.
  const cap = race.is_test ? room : Math.min(room, coins);
  const canBet = cap >= minBet;
  const value = Math.max(minBet, Math.min(amount, Math.max(minBet, cap)));
  const need = kind === "quin" ? 2 : 1;
  const odds = ticketOdds(race, kind, picks);
  // 정식 경주는 베팅 한 장마다 에너지 1(서버 app.hp_per_play)
  const noHp = !race.is_test && hp < 1;
  const ready = canBet && !noHp && picks.length === need && odds !== null && !busy;

  return (
    <div className="flex flex-col gap-2">
      <TabRail
        items={KINDS}
        value={kind}
        onChange={onKind}
        disabled={busy}
        marker="left"
        columns="grid-cols-3"
        height="h-10"
      />
      <div className="bg-bg-1 flex flex-col gap-1 px-3 py-2">
        <p className="mono-13 text-fg-mid">
          {KIND_NAME[kind]} — {KIND_DESC[kind]}. 출전표에서 {need === 2 ? "두 마리" : "한 마리"}를 고르세요.
        </p>
        <p className="mono-13 flex min-h-6 flex-wrap items-center gap-1.5 text-fg-hi">
          {picks.length === 0 ? (
            <span className="text-fg-low">고른 말 없음</span>
          ) : (
            picks.map((g) => <Chip key={g} gate={g} />)
          )}
          {odds !== null && (
            <span className="text-brass ml-1">
              ×{oddsText(odds)} · 맞으면 {Math.floor(value * odds)}코인
            </span>
          )}
        </p>
      </div>

      <BetControl
        value={value}
        min={minBet}
        max={Math.max(minBet, cap)}
        disabled={busy || !canBet}
        onChange={onAmount}
        held={coins}
      />

      <button
        type="button"
        disabled={!ready}
        onClick={() => onBuy(value)}
        className="state-fade title-19 border-brass-line min-h-12 border bg-brass-fill text-fg-hi disabled:border-line-soft disabled:bg-bg-1 disabled:text-fg-low"
      >
        마권 구매
      </button>

      <p className="mono-13 text-fg-low">
        이 경주 {spent} / {maxBet}코인 · 한 장 최소 {minBet}
        {race.is_test ? " · 테스트 경주라 코인·에너지가 움직이지 않습니다" : " · 한 장마다 에너지 1"}
        {noHp ? " · 에너지가 부족합니다" : ""}
        {!canBet && !race.is_test && room >= minBet ? " · 코인이 부족합니다" : ""}
        {room < minBet ? " · 이 경주 한도를 모두 썼습니다" : ""}
      </p>
    </div>
  );
}
