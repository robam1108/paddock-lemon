"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Room } from "@/lib/rooms";

type RosterRow = {
  username: string;
  cell_id: number | null;
  cell: string | null;
  in_ward: boolean;
};

/** "4동 08실" → [4, 8]. 형식이 어긋나면 맨 뒤로 보낸다. */
function cellOrder(label: string): [number, number] {
  const m = label.match(/(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [Infinity, Infinity];
}

/**
 * 룸 배치(안내)용. 배정 자체는 DB(app.assign_cell() / 매주 월요일 06:00 KST 에
 * 도는 app.cell_rotate())가 이미 정해 두었으므로,
 * 여기서는 inmate_roster() 가 주는 cell_id/cell 을 그대로 묶기만 한다 —
 * 다시 계산하지 않으므로 프로필(state.cell)과 항상 일치한다.
 *
 * public.cells 는 RLS 정책이 없어 클라이언트가 직접 못 읽는다. inmate_roster() 는
 * 배정된 사람이 있는 룸만 보여 주므로, 빈 룸은 배치에 나타나지 않는다.
 */
export function useRooms(supabase: SupabaseClient) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase.rpc("inmate_roster");
      if (active && data) {
        setRoster(data as RosterRow[]);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [supabase]);

  /** 명단을 다시 읽는다 — 함께 쓰기 팝업이 열릴 때 휴식 여부를 새로 맞춘다. */
  const reload = useCallback(async () => {
    const { data } = await supabase.rpc("inmate_roster");
    if (data) setRoster(data as RosterRow[]);
  }, [supabase]);

  /** 함께 쓰기에서 고를 수 있는 사람 — 휴식 중인 사람은 뺀다(방 배정 여부는 무관). */
  const mates = useMemo(
    () => (roster ?? []).filter((r) => !r.in_ward).map((r) => r.username),
    [roster],
  );

  const rooms = useMemo<Room[]>(() => {
    if (!roster) return [];

    const byCell = new Map<number, { cell: string; members: string[] }>();
    for (const r of roster) {
      if (r.cell_id == null || !r.cell) continue;
      const entry = byCell.get(r.cell_id);
      if (entry) {
        entry.members.push(r.username);
      } else {
        byCell.set(r.cell_id, { cell: r.cell, members: [r.username] });
      }
    }

    // 동 오름차순 → 실 오름차순. cell_id 는 매주 새로 뽑는 이름표의 생성 순이라
    // 순서를 믿을 수 없다. 문자열로 비교하면 "10동"이 "2동"보다 앞서는데, 주간
    // 재배치 전에 배정된 방에는 10동 이상·12실 이상이 남아 있을 수 있어 숫자로 센다.
    //
    // 이 정렬이 실 번호까지 줄 세우지는 않는다 — app.cell_rotate() 가 동과 실을
    // 따로 섞으므로, 동 순으로 늘어놓아도 실은 흩어진 채로 남는다.
    return [...byCell.values()].sort((a, b) => {
      const [ab, ar] = cellOrder(a.cell);
      const [bb, br] = cellOrder(b.cell);
      return ab - bb || ar - br;
    });
  }, [roster]);

  const cells = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms) {
      for (const m of r.members) map.set(m, r.cell);
    }
    return map;
  }, [rooms]);

  /** 아직 명단을 못 읽었거나 룸이 배정되지 않은 이름이면 null. */
  const cellOf = useMemo(
    () => (username: string) => cells.get(username) ?? null,
    [cells],
  );

  return { rooms, cellOf, mates, reload, loading: roster === null };
}
