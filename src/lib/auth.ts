// 계정은 관리자가 Supabase SQL Editor 에서 admin_create_player() 로 발급한다.
// 사이트에는 회원가입이 없고, 발급받은 [이름 / 코드] 로 로그인만 한다.
//
// Supabase Auth 는 이메일 기반이라 이름을 이메일로 바꿔야 하는데, 이름이 한글이라
// 그대로 넣을 수 없다. 그래서 이름을 UTF-8 바이트의 16진수로 인코딩해 쓴다.
//   윤태강 -> "ec9ca4ed839ceab095@minicasino.local"
// 같은 규칙을 supabase/admin.sql 의 encode(convert_to(...), 'hex') 가 그대로 쓴다.

export const AUTH_EMAIL_DOMAIN = "minicasino.local";

/** 이름 표기 흔들림(앞뒤 공백·유니코드 조합형·영문 대소문자)을 흡수한다. */
export function normalizeName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

export function nameToEmail(name: string): string {
  const bytes = new TextEncoder().encode(normalizeName(name));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${hex}@${AUTH_EMAIL_DOMAIN}`;
}

export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "이름을 입력해 주세요.";
  if (n.length > 20) return "이름은 20자 이하여야 합니다.";
  return null;
}

/** 코드는 전부 대문자·숫자다. 소문자로 쳐도 통과시킨다. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateCode(code: string): string | null {
  const c = normalizeCode(code);
  if (!c) return "코드를 입력해 주세요.";
  if (!/^\d{4}-[A-Z0-9]{6}$/.test(c))
    return "코드 형식이 다르다. 0000-XXXXXX 형태로 입력하라.";
  return null;
}
