/**
 * 수용자 신원 표기.
 *
 * 시설은 사람을 이름이 아니라 번호로 부른다. 그런데 이 단말의 DB 는 이름과
 * 형기까지는 관리하지 않는다 — 번호도 형기도 원래 종이 대장에만 있고 전산으로는
 * 안 올라왔다. 그래서 단말은 이름에서 번호를 되짚어 만들어 띄운다. 같은 사람은
 * 언제 접속해도 같은 번호가 나온다.
 *
 * 수용실은 이제 DB(profiles.cell_id)가 관리한다 — PlayerState.cell 을 쓴다.
 *
 * 방 번호는 여기서 만들지 않는다. 이름만으로는 알 수 없고 배정된 사람이 있어야
 * 알 수 있다 — useRooms 가 inmate_roster() 로 읽는다.
 *
 * 순수 표시용이다. 게임 판정·정산 어디에도 쓰이지 않는다.
 */

export type Identity = {
  /** 수용번호 4자리 */
  no: string;
  /** 전원 동일. "무기 징역" */
  term: string;
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

/** 같은 이름에서 서로 무관한 값을 여러 개 뽑기 위해 소금을 섞는다. */
function pick(text: string, salt: string, size: number): number {
  return hash(`${salt}:${text}`) % size;
}

/** 이 시설에 다른 형기는 없다. 나가는 사람이 없으니 잔여 기한을 셀 이유도 없다. */
const TERM = "무기 징역";

export function identityOf(username: string | null | undefined): Identity {
  const name = (username ?? "").trim() || "미상";

  // 1000~9999. 네 자리 미만은 시설 대장에 올라간 적이 없다.
  // supabase/02_schema.sql 의 app.name_no() 와 반드시 같은 값을 내야 한다 —
  // 그쪽이 로그인 코드 앞 4자리(죄수번호)를 만드는 데 이 계산을 그대로 옮겨 쓴다.
  // 한쪽만 고치면 코드 앞자리와 화면의 NO. 가 어긋난다.
  const no = String(1000 + pick(name, "no", 9000));

  return { no, term: TERM };
}
