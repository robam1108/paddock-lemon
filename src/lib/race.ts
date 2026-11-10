/* ---------------- 경마장 (Arena) ----------------
 * 서버 정본은 supabase/22_horse_race.sql. 여기 있는 건 표시용 값과 타입뿐이다.
 */

/** 정식 오픈 스위치 — 서버 app.race_public() 과 같이 바꾼다(2026-10-29 오픈).
 *  false 면 시험 계정에게만 경마장 탭과 라디오 경마 소식이 보인다. */
export const RACE_PUBLIC = true;

/** 시험 계정 이름 — 관리자 권한이 있고 이 이름인 계정 하나. 서버 app.race_tester_name() 과 같이 바꾼다. */
export const RACE_TESTER = "관리자";

export function isRaceTester(s: { is_admin: boolean; username: string }): boolean {
  return s.is_admin && s.username === RACE_TESTER;
}

/** 경마장이 보이는가 — 오픈 뒤엔 모두, 그 전엔 시험 계정만 */
export function canSeeRace(s: { is_admin: boolean; username: string }): boolean {
  return RACE_PUBLIC || isRaceTester(s);
}

export type RaceKind = "win" | "place" | "quin";

export type RaceHorse = {
  id: number;
  name: string;
  coat: string;
  face: string;
  legs: string;
  sex: string;
  age: number;
  weight: number;
  spd: number;
  sta: number;
  acc: number;
  gut: number;
  stb: number;
  style: 1 | 2 | 3 | 4;
  dist: "S" | "M" | "L";
  wet: -1 | 0 | 1;
  bio: string;
  runs: number;
  wins: number;
  top3: number;
  /** 최근 착순(최신이 앞) */
  last5: number[];
};

export type RaceEntry = { gate: number; horse: number; weight: number; wdelta: number };

export type RaceTicket = {
  id: number;
  kind: RaceKind;
  picks: number[];
  amount: number;
  odds: number;
  payout: number | null;
};

export type RaceOdds = {
  win: number[];
  place: number[];
  quin: Record<string, number>;
};

export type Race = {
  id: number;
  day: string;
  no: number;
  is_test: boolean;
  post_at: string;
  distance: number;
  track: number;
  status: "open" | "done";
  entries: RaceEntry[];
  odds: RaceOdds;
  /** order: 착순대로 게이트, splits: 게이트별 10구간 누적 타임(초) */
  result: { order: number[]; splits: number[][] } | null;
  ranks: number[] | null;
  /** 끝난 경주에서만 공개되는 컨디션(게이트 순서) */
  cond: number[] | null;
  tickets: RaceTicket[];
};

export type RaceCard = {
  public: boolean;
  /** 시험 계정 — 테스트 바가 보인다 */
  tester: boolean;
  now: string;
  min_bet: number;
  max_bet: number;
  tips_per_race: number;
  horses: RaceHorse[];
  upcoming: Race[];
  recent: Race[];
  test: Race | null;
};

export type RadioTip = {
  gate: number;
  horse: number;
  name: string;
  level: number;
  wdelta: number;
};

export type RadioNews = {
  race: {
    id: number;
    day: string;
    no: number;
    is_test: boolean;
    post_at: string;
    distance: number;
    track: number;
  } | null;
  tips: RadioTip[];
  left: number;
  fresh: boolean;
};

export const KIND_NAME: Record<RaceKind, string> = {
  win: "단승",
  place: "연승",
  quin: "복승",
};

export const KIND_DESC: Record<RaceKind, string> = {
  win: "1착을 맞힌다",
  place: "3착 안에 든다",
  quin: "1·2착 두 마리, 순서 무관",
};

export const STYLE_NAME: Record<number, string> = { 1: "선행", 2: "선입", 3: "차입", 4: "추입" };
export const DIST_NAME: Record<string, string> = { S: "단거리", M: "중거리", L: "장거리" };
export const WET_NAME: Record<number, string> = { [-1]: "마른 주로", 0: "가리지 않음", 1: "젖은 주로" };
export const TRACK_NAME = ["건조", "양호", "다습", "불량"] as const;
export const COND_NAME = ["최상", "양호", "보통", "저조", "최악"] as const;

/** 모색 → 몸통 · 갈기 색. 화면 톤과 상관없이 말 색은 말 색이다. */
export const COAT: Record<string, { body: string; mane: string }> = {
  밤색: { body: "#9a5630", mane: "#5e3018" },
  갈색: { body: "#6a4026", mane: "#2a1a10" },
  흑갈색: { body: "#3a261b", mane: "#16100c" },
  청모: { body: "#a9adb0", mane: "#6c7074" },
  적다모: { body: "#a8665a", mane: "#6a3a30" },
  흑모: { body: "#1f1b1a", mane: "#0c0a0a" },
};

/** 게이트 번호천 — 한국 경마의 번호별 색 관례를 따른다. */
export const SADDLE: { bg: string; fg: string }[] = [
  { bg: "#f2f2ee", fg: "#111" },
  { bg: "#1b1b1b", fg: "#f2f2ee" },
  { bg: "#c33b32", fg: "#fff" },
  { bg: "#2c56b8", fg: "#fff" },
  { bg: "#e9c22c", fg: "#111" },
  { bg: "#2f7d3a", fg: "#fff" },
  { bg: "#e7782a", fg: "#111" },
  { bg: "#e58ab0", fg: "#111" },
];
export const saddle = (gate: number) => SADDLE[(gate - 1) % SADDLE.length];

export const STAT_LABELS: { key: "spd" | "sta" | "acc" | "gut" | "stb"; name: string }[] = [
  { key: "spd", name: "스피드" },
  { key: "sta", name: "지구력" },
  { key: "acc", name: "순발력" },
  { key: "gut", name: "근성" },
  { key: "stb", name: "안정성" },
];

export function grade(v: number): string {
  if (v >= 90) return "S";
  if (v >= 82) return "A";
  if (v >= 74) return "B";
  if (v >= 66) return "C";
  return "D";
}

const KST = "Asia/Seoul";

/** "10:00" (KST) */
export function kstTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "10월 29일" — race.day(YYYY-MM-DD) 기준 */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}월 ${d}일`;
}

export function raceTitle(r: { day: string; no: number; is_test: boolean }): string {
  return r.is_test ? "테스트 경주" : `${dayLabel(r.day)} 제${r.no}경주`;
}

/** 마감까지 남은 시간 "2:03:15" / "4:05" */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 주파 기록 "1:34.2" */
export function raceTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : s.toFixed(1);
}

/** 배당 표기 — 항상 소수 한 자리 */
export function oddsText(x: number | null | undefined): string {
  return x == null ? "-" : Number(x).toFixed(1);
}

export function quinKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function ticketOdds(race: Race, kind: RaceKind, picks: number[]): number | null {
  if (kind === "quin") return picks.length === 2 ? (race.odds.quin[quinKey(picks[0], picks[1])] ?? null) : null;
  return picks.length === 1 ? (race.odds[kind][picks[0] - 1] ?? null) : null;
}

/** 마신 차 → 한국식 착차 표기 */
export function marginText(lengths: number): string {
  if (lengths < 0.08) return "코";
  if (lengths < 0.2) return "머리";
  if (lengths < 0.35) return "목";
  if (lengths > 10) return "대차";
  const q = lengths <= 2 ? Math.round(lengths * 4) / 4 : lengths <= 3 ? Math.round(lengths * 2) / 2 : Math.round(lengths);
  const whole = Math.floor(q);
  const frac = q - whole;
  // ¼ · ½ · ¾ 글리프는 고정폭 글꼴에서 %처럼 보여 분수로 쓴다(1 1/2마신).
  const f = frac === 0.25 ? "1/4" : frac === 0.5 ? "1/2" : frac === 0.75 ? "3/4" : "";
  return `${[whole > 0 ? whole : "", f].filter(Boolean).join(" ")}마신`;
}

/** 말 한 마리 몸 길이(m) — 착차 계산용 */
export const HORSE_LENGTH_M = 2.4;

/** 게이트별 착차(앞 말과의 차이). 1착은 "". */
export function margins(race: Race): Record<number, string> {
  const out: Record<number, string> = {};
  if (!race.result) return out;
  const { order, splits } = race.result;
  const win = splits[order[0] - 1][9];
  const speed = race.distance / win;
  order.forEach((g, i) => {
    if (i === 0) {
      out[g] = "";
      return;
    }
    const prev = splits[order[i - 1] - 1][9];
    out[g] = marginText(((splits[g - 1][9] - prev) * speed) / HORSE_LENGTH_M);
  });
  return out;
}

/** 경주 시각 t(초)에 이 말이 달린 거리(m). 구간 사이는 직선 보간, 결승 뒤는 마지막 구간 속도로 이어 달린다. */
export function positionAt(split: number[], distance: number, t: number): number {
  const seg = distance / 10;
  if (t <= 0) return 0;
  let prevT = 0;
  for (let k = 0; k < split.length; k++) {
    if (t <= split[k]) return seg * k + (seg * (t - prevT)) / (split[k] - prevT);
    prevT = split[k];
  }
  const last = split[9] - split[8];
  return distance + (seg * (t - split[9])) / last;
}

/** 이 마권이 맞았는지(끝난 경주만) */
export function ticketHit(race: Race, t: RaceTicket): boolean {
  if (!race.ranks) return false;
  const r = (g: number) => race.ranks![g - 1];
  if (t.kind === "win") return r(t.picks[0]) === 1;
  if (t.kind === "place") return r(t.picks[0]) <= 3;
  return r(t.picks[0]) <= 2 && r(t.picks[1]) <= 2;
}
