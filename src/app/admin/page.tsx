import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminPanel from "@/components/AdminPanel";
import type { PlayerState } from "@/lib/game";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_my_state");
  const state = data as PlayerState | null;

  // 화면 차단은 편의일 뿐이고, 실제 방어는 panel_* 함수 안의
  // app.require_admin() 이 담당한다.
  if (!state?.is_admin) redirect("/play");

  return <AdminPanel username={state.username} />;
}
