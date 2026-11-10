/**
 * 서버 규칙 값(get_rules) — 배당표 · 한도 · 키노 개수 등.
 *
 * 정본은 서버(supabase/migrations/*_rules.sql)다. 클라이언트에 같은 숫자를 따로
 * 적지 않고, 플레이 화면이 처음 열릴 때 서버에서 한 번 받아 여기에 둔다
 * (src/app/play/page.tsx → Casino 가 setRules). 모든 사용자에게 같은 값이라
 * 모듈 하나에 담아 두고 어디서든 getRules() 로 읽는다.
 */

export type Rules = {
  play_limit: number;
  play_wage: number;
  initial_coins: number;
  hp_max: number;
  hp_per_play: number;
  rest_hours: number;
  bonus_plays_max: number;
  extra_plays_max: number;
  pvp_min_bet: number;
  operator_name: string;
  roulette: { slots: number; color_mult: number; number_mult: number };
  slots: { pool: string[]; triple: Record<string, number>; pair_mult: number };
  highlow: { max_stage: number; edge: number[]; max_mult: number };
  keno: { range: number; picks: number; draws: number; mult: Record<string, number> };
  clover_stake: number;
  cat: { bird_stake: number; bird_plays: number };
  race: { public: boolean; min_bet: number; max_bet: number; take: number };
};

let current: Rules | null = null;

export function setRules(r: Rules): void {
  current = r;
}

export function getRules(): Rules {
  if (!current) throw new Error("규칙(get_rules)을 아직 불러오지 않았습니다.");
  return current;
}
