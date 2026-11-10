// Supabase 의 Connect 대화상자는 새 프로젝트에 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 를,
// 예전 프로젝트에는 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 내려준다. 둘 다 받아준다.
//
// process.env.NEXT_PUBLIC_* 는 빌드 시점에 문자열로 치환되므로 반드시 이렇게
// 리터럴로 적어야 한다. 변수로 조합해서 읽으면 값이 들어오지 않는다.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
