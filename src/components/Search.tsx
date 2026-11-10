"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAT_FISH_CODES,
  CHURU,
  toKoreanError,
  type CatTestAction,
  type PlayerState,
  type SearchBoard as SearchBoardType,
  type SearchResult,
} from "@/lib/game";
import { blockedState, catName, eulReul, nonGameBlockedLine, searchLines } from "@/lib/copy";
import { SEARCH_PLACES } from "@/lib/labor";
import CatPopup from "./CatPopup";
import CatTestPanel from "./CatTestPanel";
import BlockedRow from "./ui/BlockedRow";
import ItemMark from "./ui/ItemMark";
import MonoLabel from "./ui/MonoLabel";
import ResultPopup from "./ui/ResultPopup";

/**
 * 탐색.
 *
 * 수용동·식당·샤워실·작업장·의료동 중 한 곳을 하루 한 번 뒤진다. 무엇이
 * 나올지, 빈손인지 비상식량인지도 해 보기 전엔 모른다.
 *
 * 유저마다·날마다 한 곳은 고양이 자리라, 거기를 고르면 물건 대신 고양이를
 * 만난다(CatPopup). 팝업을 닫아도 행동 전이면 다시 열 수 있다.
 */
export default function Search({
  supabase,
  state,
  busy,
  onRefresh,
}: {
  supabase: SupabaseClient;
  state: PlayerState;
  busy: boolean;
  onRefresh: () => void;
}) {
  const [board, setBoard] = useState<SearchBoardType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<SearchResult | null>(null);
  const [catOpen, setCatOpen] = useState<"meet" | "name" | null>(null);
  // 방금 고양이를 만난 곳. board 를 다시 읽기 전에도 팝업에 장소를 띄운다.
  const [catPlace, setCatPlace] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("search_board");
    if (e) {
      setError(toKoreanError(e.message));
      return;
    }
    if (data) {
      setBoard(data as SearchBoardType);
      setError(null);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const look = useCallback(
    async (place: string) => {
      setWorking(true);
      const { data, error: e } = await supabase.rpc("search_look", {
        p_place: place,
      });
      setWorking(false);

      if (e || !data) {
        setError(toKoreanError(e?.message));
        // 서버가 거절했다는 건 내 화면이 낡았다는 뜻이다(다른 곳에서
        // 이미 오늘 몫을 썼거나) — 다시 읽어 맞춘다.
        load();
        return;
      }

      setError(null);
      const result = (data as { search: SearchResult }).search;
      if (result.cat) {
        setCatPlace(result.place);
        setCatOpen("meet");
      }
      else setOutcome(result);
      // 체력·가방이 다 바뀐다.
      onRefresh();
      load();
    },
    [supabase, onRefresh, load],
  );

  // 시험 계정의 테스트 패널. 돌려받는 값이 곧 새 board 다.
  const runTest = useCallback(
    async (action: CatTestAction) => {
      setWorking(true);
      const { data, error: e } = await supabase.rpc("cat_test", { p_action: action });
      setWorking(false);
      if (e || !data) {
        setError(toKoreanError(e?.message));
        return;
      }
      const next = data as SearchBoardType;
      setError(null);
      setBoard(next);
      if (action === "here") {
        setCatPlace(next.cat_place ?? null);
        setCatOpen("meet");
      }
      if (action === "churu" || action === "fish") onRefresh();
    },
    [supabase, onRefresh],
  );

  // 탐색도 배정 횟수와는 무관하다 — 정지·병동만 막는다.
  const blocked = blockedState(state, false, false);
  const busyAll = busy || working;
  const tester = !!board?.tester;
  const hpCost = board?.hp_cost ?? 15;
  // 시험 계정은 체력과 하루 한 번 제한 없이 늘 장소를 고른다.
  const noHp = !tester && state.hp <= hpCost;
  const usedPlace = board?.used
    ? (SEARCH_PLACES.find((p) => p.id === board.place)?.label ?? board.place)
    : null;
  const cat = catName(board?.cat_name);
  // 고양이에게 줄 수 있는 간식 — 츄르 먼저, 그다음 날생선.
  const snacks = state.items
    .filter((i) => i.qty > 0 && (i.code === CHURU || CAT_FISH_CODES.has(i.code)))
    .sort((a, b) => Number(b.code === CHURU) - Number(a.code === CHURU))
    .map((i) => ({ code: i.code, name: i.name, qty: i.qty }));

  return (
    <div className="flex flex-col gap-2">
      <section className="bg-bg-1 flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <MonoLabel>탐색</MonoLabel>
          <MonoLabel tone="low">체력 -{hpCost}{tester && " · 테스트"}</MonoLabel>
        </div>

        {error && (
          <p className="mono-13 border-loss/40 border bg-bg-2 px-3 py-2 text-loss">
            {error}
          </p>
        )}

        {blocked ? (
          <BlockedRow
            blocked={{ ...blocked, line: nonGameBlockedLine(blocked) }}
            disabled={busyAll}
          />
        ) : board === null ? (
          <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
            불러오는 중…
          </p>
        ) : noHp ? (
          <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
            체력이 {hpCost} 이하면 나설 수 없다. 지금 {state.hp}.
          </p>
        ) : usedPlace && !tester ? (
          <div className="flex flex-col gap-1.5">
            <p className="scanline-faint mono-13 border-line-soft text-fg-low border border-dashed bg-bg-2 px-3 py-6 text-center">
              {board?.cat_met
                ? `오늘은 ${usedPlace}에서 ${cat}${eulReul(cat)} 만났다.`
                : `오늘은 ${usedPlace}을 돌아봤다.`}
            </p>
            {board?.cat_waiting ? (
              <button
                type="button"
                disabled={busyAll}
                onClick={() => setCatOpen("meet")}
                className="state-fade label-11 border-line w-full border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi"
              >
                {cat}에게 돌아가기
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5 tab:grid-cols-5">
            {SEARCH_PLACES.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busyAll}
                  onClick={() => look(p.id)}
                  className="state-fade border-line-soft relative flex h-full w-full flex-col items-start gap-1 border bg-surface p-3 text-left enabled:hover:bg-surface-hi disabled:opacity-50"
                >
                  <span className="body-15 text-fg-hi">{p.label}</span>
                  <span className="mono-13 text-fg-mid">{p.desc}</span>
                  {board.cat_spot === p.id && (
                    // 이름을 지어 준 고양이가 오늘 있는 곳. 피해 가면 생선이 있어도 안 나온다.
                    <span
                      role="img"
                      aria-label={`${cat}의 발자국`}
                      title={`${cat}의 발자국`}
                      className="absolute right-2 bottom-1.5 text-[13px] leading-none opacity-80"
                    >
                      🐾
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {tester && board?.cat_waiting && !catOpen && (
          <button
            type="button"
            disabled={busyAll}
            onClick={() => setCatOpen("meet")}
            className="state-fade label-11 border-line w-full border bg-surface px-4 py-3 text-fg-mid enabled:hover:text-fg-hi"
          >
            {cat}에게 돌아가기
          </button>
        )}

        {board?.can_name && !catOpen && (
          <button
            type="button"
            onClick={() => setCatOpen("name")}
            className="state-fade label-11 border-brass-line w-full border bg-brass-fill px-4 py-3 text-fg-hi"
          >
            고양이 이름 지어 주기
          </button>
        )}
      </section>

      {tester && board && (
        <CatTestPanel board={board} disabled={busyAll} onAction={runTest} />
      )}

      {outcome && (
        <ResultPopup
          title="탐색 결과"
          icon={
            outcome.item ? (
              <div className="flex items-center gap-2.5">
                <ItemMark
                  kind={outcome.item.kind}
                  grade={outcome.item.grade}
                  emoji={outcome.item.emoji}
                />
                <span className="body-15 text-fg-hi">{outcome.item.name}</span>
              </div>
            ) : undefined
          }
          lines={searchLines(outcome)}
          onClose={() => setOutcome(null)}
        />
      )}

      {catOpen && board && (
        <CatPopup
          supabase={supabase}
          mode={catOpen}
          place={catPlace ?? board.place ?? "cell"}
          name={board.cat_name ?? null}
          hpCut={hpCost}
          snacks={snacks}
          onChanged={() => {
            onRefresh();
            load();
          }}
          onClose={() => setCatOpen(null)}
        />
      )}
    </div>
  );
}
