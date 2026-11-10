"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { HpStatus } from "@/lib/game";

export type Presence = {
  username: string;
  status: HpStatus;
  joined_at: string;
};

/**
 * 지금 이 화면을 실제로 보고 있는가.
 *
 * document.hasFocus() 는 일부러 보지 않는다 — 모바일 브라우저와, 개발자도구나
 * 다른 창에 포커스가 가 있는 데스크톱에서 항상 false 라, 그걸 조건에 넣으면
 * 멀쩡히 화면을 띄워 둔 사람이 남의 접속자 목록에서 통째로 빠진다.
 */
function screenIsActive() {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible";
}

/**
 * 로비 접속자 목록. "로그인해 둔 사람"이 아니라
 * "지금 화면을 보고 있는 사람"만 담긴다.
 *
 * 채널은 마운트당 딱 한 번만 만든다. 예전에는 status(에너지 등급)가 deps 에
 * 들어 있어서 게임 한 판·아이템 하나·PvP 폴링마다 removeChannel -> channel
 * 을 다시 탔고, removeChannel 을 await 하지 않아 옛 채널의 phx_leave 가 새
 * 채널의 join 뒤에 처리되면 서버가 presence key 를 지워 버렸다. 그게 "서로
 * 접속자 목록에 안 뜬다" 의 정체다. 바뀌는 값은 ref 로 들고 track() 으로만 민다.
 */
export function usePresence(
  supabase: SupabaseClient,
  userId: string,
  username: string,
  status: HpStatus,
  hidden: boolean,
) {
  const [online, setOnline] = useState<Presence[]>([]);
  const [active, setActive] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const readyRef = useRef(false);

  // 구독 이펙트가 최신 값을 읽되 다시 구독하지는 않도록 ref 로 들고 다닌다.
  const meRef = useRef({ username, status, hidden });
  meRef.current = { username, status, hidden };

  useEffect(() => {
    const update = () => setActive(screenIsActive());
    update();

    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let retry: number | null = null;
    let channel: RealtimeChannel | null = null;

    const join = () => {
      if (!alive) return;

      const ch = supabase.channel("lobby", {
        config: { presence: { key: userId } },
      });
      channel = ch;
      channelRef.current = ch;
      readyRef.current = false;

      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<Presence>();
        const list = Object.values(state)
          .map((entries) => entries[0])
          .filter((p) => Boolean(p?.username))
          .sort((a, b) => a.username.localeCompare(b.username, "ko"));
        setOnline(list);
      }).subscribe((s) => {
        if (!alive) return;

        if (s === "SUBSCRIBED") {
          readyRef.current = true;
          const me = meRef.current;
          if (!me.hidden && me.username && screenIsActive()) {
            ch.track({
              username: me.username,
              status: me.status,
              joined_at: new Date().toISOString(),
            });
          }
          return;
        }

        // 소켓이 끊기거나 조인이 늦으면 스스로 다시 붙는다. 여기서 포기하면
        // 새로고침 전까지 목록이 비어 있는 채로 남는다.
        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          readyRef.current = false;
          if (retry !== null) return;
          retry = window.setTimeout(() => {
            retry = null;
            if (!alive) return;
            supabase.removeChannel(ch);
            join();
          }, 2000);
        }
      });
    };

    join();

    return () => {
      alive = false;
      readyRef.current = false;
      if (retry !== null) window.clearTimeout(retry);
      channelRef.current = null;
      if (channel) {
        const ch = channel;
        // untrack 을 먼저 보내야 leave 가 늦어도 남들 목록에서 바로 빠진다.
        // 아직 조인 중인 채널에 보내면 거부될 수 있으므로 결과는 묻지 않는다.
        try {
          void Promise.resolve(ch.untrack()).catch(() => {});
        } catch {
          // 무시 — 아래 removeChannel 이 어차피 정리한다.
        }
        supabase.removeChannel(ch);
      }
    };
  }, [supabase, userId]);

  // 화면을 보기 시작하면 등록, 벗어나면 즉시 목록에서 내린다. 에너지 등급이
  // 바뀔 때도 여기로 들어와 track 만 다시 민다(채널은 그대로 둔다).
  // (숨김 계정은 애초에 등록하지 않는다 — 본인은 계속 목록을 볼 수 있다)
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !readyRef.current) return;

    if (active && !hidden && username) {
      channel.track({ username, status, joined_at: new Date().toISOString() });
    } else {
      channel.untrack();
    }
  }, [active, username, status, hidden]);

  return { online, active };
}
