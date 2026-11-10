// 계정은 관리자가 발급한다(admin_create_player). 사이트에는 회원가입이 없고,
// 발급받은 [아이디 / 비밀번호]로 로그인만 한다.
//
// Supabase Auth 는 이메일 기반이라 아이디를 내부용 이메일로 바꿔 쓴다.
//   demo01 -> "demo01@paddock.local"
// DB 쪽 app.username_to_email() 이 같은 규칙을 쓴다(P2에서 맞춘다).

export const AUTH_EMAIL_DOMAIN = "paddock.local";

/** 아이디: 영문 소문자·숫자 3~20자. 대문자로 쳐도 소문자로 맞춘다. */
export const USERNAME_PATTERN = /^[a-z0-9]{3,20}$/;
export const PASSWORD_MIN = 6;

export function normalizeUsername(id: string): string {
  return id.trim().toLowerCase();
}

export function usernameToEmail(id: string): string {
  return `${normalizeUsername(id)}@${AUTH_EMAIL_DOMAIN}`;
}

export function validateUsername(id: string): string | null {
  const n = normalizeUsername(id);
  if (!n) return "아이디를 입력해 주세요.";
  if (!USERNAME_PATTERN.test(n)) return "아이디는 영문 소문자와 숫자 3~20자입니다.";
  return null;
}

export function validatePassword(pw: string): string | null {
  if (!pw) return "비밀번호를 입력해 주세요.";
  if (pw.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상입니다.`;
  return null;
}
