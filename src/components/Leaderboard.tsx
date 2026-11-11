"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { LABEL } from "@/lib/copy";
import SidePanel from "./ui/SidePanel";
import { usePageVisible } from "@/hooks/usePageVisible";

type Row = { username: string; coins: number };

export default function Leaderboard({
  supabase,
  username,
  refreshKey,
}: {
  supabase: SupabaseClient;
  username: string;
  /** 내 게임이 끝날 때마다 값이 바뀌어 즉시 갱신된다 */
  refreshKey: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const visible = usePageVisible();

  useEffect(() => {
    if (!visible) return;
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username, coins")
        .order("coins", { ascending: false })
        .limit(3);
      if (active && data) setRows(data as Row[]);
    };

    load();
    // 다른 사람의 코인 변화도 반영되도록 주기적으로 다시 읽는다.
    const timer = window.setInterval(load, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [supabase, refreshKey, visible]);

  // 메달도 트로피도 없다. 등수만 담백하게 적는다.
  return (
    <SidePanel title={LABEL.rank} meta="실시간">
      <ul className="flex flex-col gap-2">
        {rows.length === 0 && (
          <li className="mono-13 text-fg-low py-2">불러오는 중…</li>
        )}
        {rows.map((r, i) => {
          const me = r.username === username;
          return (
            <li
              key={r.username}
              className={`mono-13 grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 ${
                me
                  ? "border-brass-line border bg-brass-fill"
                  : "bg-surface"
              }`}
            >
              <span className="text-fg-low tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={`truncate ${me ? "text-fg-hi" : "text-fg"}`}
              >
                {r.username}
              </span>
              <span
                className={`tabular-nums ${me ? "text-fg-hi" : "text-fg"}`}
              >
                {r.coins}
              </span>
            </li>
          );
        })}
      </ul>
    </SidePanel>
  );
}
