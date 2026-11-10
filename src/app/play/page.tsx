import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import Casino from "@/components/Casino";
import type { PlayerState } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 로그인 직후에는 Supabase 의 인증 서버와 Data API 서버 사이의 미세한 시계 차이 때문에
 * 갓 발급된 토큰이 "JWT issued at future" 로 잠깐 거부될 수 있다. 몇백 밀리초면
 * 해소되므로, 에러 화면을 띄우기 전에 짧게 재시도한다.
 */
async function loadState(supabase: SupabaseClient) {
  const delays = [0, 400, 900];
  let lastError: string | null = null;

  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    const { data, error } = await supabase.rpc("get_my_state");
    if (!error && data) return { state: data as PlayerState, error: null };

    lastError = error?.message ?? "알 수 없는 오류";
    // 시계 차이로 인한 실패만 재시도할 가치가 있다. 나머지는 즉시 포기한다.
    if (!/issued at future|JWT/i.test(lastError)) break;
  }

  return { state: null, error: lastError };
}

export default async function PlayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { state, error } = await loadState(supabase);

  if (!state) {
    const schemaMissing = /does not exist|schema cache|PGRST202/i.test(
      error ?? "",
    );

    return (
      <div className="bg-bg-0 flex min-h-dvh items-center justify-center p-4">
        <main className="border-line w-full max-w-md border bg-bg-1">
          <div className="border-line-soft scanline border-b px-3.5 py-1.5">
            <span className="label-11 text-fg-low">조회 실패</span>
          </div>
          <div className="flex flex-col gap-1 p-4">
            <p className="title-19 text-loss">프로필을 불러오지 못했습니다.</p>
            <p className="mono-13 text-fg-mid break-all">{error}</p>

            <a
              href="/play"
              className="state-fade title-19 border-line mt-3 flex min-h-12 items-center justify-center border bg-surface-hi text-fg-hi"
            >
              다시 조회
            </a>

            <p className="body-15 text-fg-low mt-2">
              {schemaMissing
                ? "Supabase 에서 supabase/APPLY.md 의 순서대로 SQL 을 실행했는지 확인할 것."
                : "일시적인 장애일 수 있습니다. 반복되면 관리자에게 문의해 주세요."}
            </p>
          </div>
        </main>
      </div>
    );
  }

  return <Casino userId={user.id} initialState={state} />;
}
