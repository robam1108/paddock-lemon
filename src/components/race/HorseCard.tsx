import {
  DIST_NAME,
  STAT_LABELS,
  STYLE_NAME,
  WET_NAME,
  grade,
  type RaceHorse,
} from "@/lib/race";
import HorseSprite from "./HorseSprite";

/** 출전표에서 펼치는 경주마 카드 — 마적(馬籍) 한 장. */
export default function HorseCard({ horse, gate }: { horse: RaceHorse; gate: number }) {
  const rate = horse.runs > 0 ? Math.round((horse.top3 / horse.runs) * 100) : null;

  return (
    <div className="bg-bg-0 flex flex-col gap-3 p-3 tab:flex-row">
      <div className="flex shrink-0 flex-col items-center gap-1 tab:w-36">
        <HorseSprite coat={horse.coat} face={horse.face} legs={horse.legs} gate={gate} size={96} />
        <span className="mono-13 text-fg-mid">
          {horse.coat} · {horse.face === "없음" ? "무늬 없음" : horse.face}
        </span>
        <span className="mono-13 text-fg-low">{horse.legs === "없음" ? "흰 발 없음" : horse.legs}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <dl className="mono-13 grid grid-cols-2 gap-x-3 gap-y-0.5 tab:grid-cols-3">
          <Row k="성별·나이" v={`${horse.sex} ${horse.age}세`} />
          <Row k="습성" v={STYLE_NAME[horse.style]} />
          <Row k="거리" v={DIST_NAME[horse.dist]} />
          <Row k="주로" v={WET_NAME[horse.wet]} />
          <Row
            k="전적"
            v={
              horse.runs > 0
                ? `${horse.runs}전 ${horse.wins}승 · 입상률 ${rate}%`
                : "기록 없음"
            }
          />
          <Row k="최근" v={horse.last5.length ? horse.last5.join("-") : "-"} />
        </dl>

        <ul className="flex flex-col gap-1">
          {STAT_LABELS.map((s) => {
            const v = horse[s.key];
            return (
              <li key={s.key} className="mono-13 grid grid-cols-[4.5rem_1.5rem_1fr] items-center gap-2">
                <span className="text-fg-mid">{s.name}</span>
                <span className="text-fg-hi font-bold">{grade(v)}</span>
                <span className="bg-surface h-1.5">
                  <span
                    className="bg-brass block h-full"
                    style={{ width: `${Math.max(4, ((v - 45) / 55) * 100)}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>

        <p className="body-15 text-fg-mid">{horse.bio}</p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="text-fg-low shrink-0">{k}</dt>
      <dd className="text-fg min-w-0 break-keep">{v}</dd>
    </div>
  );
}
