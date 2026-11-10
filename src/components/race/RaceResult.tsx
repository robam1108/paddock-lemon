import {
  COND_NAME,
  KIND_NAME,
  margins,
  oddsText,
  quinKey,
  raceTime,
  saddle,
  ticketHit,
  type Race,
  type RaceHorse,
} from "@/lib/race";
import MonoLabel from "../ui/MonoLabel";

/** 끝난 경주의 성적표 — 착순 · 기록 · 착차 · (경주 뒤 공개되는) 컨디션 · 확정 배당 · 내 마권. */
export default function RaceResult({
  race,
  horses,
  onReplay,
}: {
  race: Race;
  horses: Map<number, RaceHorse>;
  onReplay: () => void;
}) {
  if (!race.result) return null;
  const { order, splits } = race.result;
  const gap = margins(race);
  const nameOf = (g: number) => horses.get(race.entries[g - 1].horse)?.name ?? `${g}번`;
  const [w1, w2] = order;

  return (
    <div className="bg-bg-1 flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <MonoLabel>성적</MonoLabel>
        <button
          type="button"
          onClick={onReplay}
          className="state-fade label-11 border-brass-line border bg-brass-fill px-3 py-2 text-fg-hi"
        >
          다시보기
        </button>
      </div>

      <table className="mono-13 w-full border-collapse">
        <thead>
          <tr className="text-fg-low text-left">
            <th className="py-1 pr-2 font-normal">착</th>
            <th className="py-1 pr-2 font-normal">번</th>
            <th className="py-1 pr-2 font-normal">마명</th>
            <th className="py-1 pr-2 text-right font-normal">기록</th>
            <th className="py-1 pr-2 text-right font-normal">착차</th>
            <th className="py-1 text-right font-normal">컨디션</th>
          </tr>
        </thead>
        <tbody>
          {order.map((g, i) => (
            <tr key={g} className={`border-line-soft border-t ${i < 3 ? "text-fg-hi" : "text-fg-mid"}`}>
              <td className="py-1 pr-2">{i + 1}</td>
              <td className="py-1 pr-2">
                <Chip gate={g} />
              </td>
              <td className="py-1 pr-2 break-keep">{nameOf(g)}</td>
              <td className="py-1 pr-2 text-right">{raceTime(splits[g - 1][9])}</td>
              <td className="py-1 pr-2 text-right">{gap[g]}</td>
              <td className="py-1 text-right">{race.cond ? COND_NAME[race.cond[g - 1]] : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mono-13 border-line-soft grid grid-cols-1 gap-1 border-t pt-2 tab:grid-cols-3">
        <span className="text-fg">
          단승 <Chip gate={w1} /> ×{oddsText(race.odds.win[w1 - 1])}
        </span>
        <span className="text-fg">
          연승{" "}
          {order.slice(0, 3).map((g) => (
            <span key={g} className="mr-1.5">
              <Chip gate={g} /> ×{oddsText(race.odds.place[g - 1])}
            </span>
          ))}
        </span>
        <span className="text-fg">
          복승 <Chip gate={Math.min(w1, w2)} />-<Chip gate={Math.max(w1, w2)} /> ×
          {oddsText(race.odds.quin[quinKey(w1, w2)])}
        </span>
      </div>

      {race.tickets.length > 0 && (
        <ul className="border-line-soft flex flex-col gap-1 border-t pt-2">
          {race.tickets.map((t) => {
            const hit = ticketHit(race, t);
            return (
              <li key={t.id} className={`mono-13 flex justify-between gap-2 ${hit ? "text-brass" : "text-fg-low"}`}>
                <span>
                  {KIND_NAME[t.kind]} {t.picks.join("-")} · {t.amount} × {oddsText(t.odds)}
                </span>
                <span>
                  {hit
                    ? `${race.is_test ? "가상 지급" : "적중"} +${t.payout ?? Math.floor(t.amount * t.odds)}`
                    : "낙첨"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Chip({ gate }: { gate: number }) {
  const s = saddle(gate);
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center px-1 align-middle font-bold"
      style={{ background: s.bg, color: s.fg, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / .22)" }}
    >
      {gate}
    </span>
  );
}
