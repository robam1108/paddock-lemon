// 한국어 조사 도우미. 끝 글자의 받침으로 고른다.

/** 목적격 조사. 끝 글자에 받침이 있으면 "을", 없으면 "를". 한글로 안 끝나면 "을(를)". */
export function eulReul(word: string): string {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? "을" : "를";
  return "을(를)";
}

/** 공동격 조사. 끝 글자에 받침이 있으면 "과", 없으면 "와". 한글로 안 끝나면 "와(과)". */
export function waGwa(word: string): string {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? "과" : "와";
  return "와(과)";
}

/** 받침 있으면 "이", 없으면 "가". 한글로 안 끝나면 "이(가)". */
export function iGa(word: string): string {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? "이" : "가";
  return "이(가)";
}
