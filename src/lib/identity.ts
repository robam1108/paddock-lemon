/**
 * 플레이어 번호 표기.
 *
 * 화면에서 이름 앞에 붙는 "#0001" 형태의 번호다. 같은 아이디는 언제 접속해도
 * 같은 번호가 나온다. 지금은 아이디에서 결정적으로 계산하고, DB 재구성(P2)에서
 * profiles 의 발급 순번으로 바꾼다.
 *
 * 순수 표시용이다. 게임 판정·정산 어디에도 쓰이지 않는다.
 */

export type Identity = {
  /** "#0001" 형태의 플레이어 번호 */
  no: string;
};

/** FNV-1a 32bit. 짧고 결정적이면 충분하다. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 번호를 "#0001" 형태로 */
export function formatPlayerNo(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}

export function identityOf(username: string | null | undefined): Identity {
  const name = (username ?? "").trim() || "unknown";
  return { no: formatPlayerNo(1 + (hash(`no:${name}`) % 9999)) };
}
