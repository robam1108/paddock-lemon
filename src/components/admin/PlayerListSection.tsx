"use client";

import Panel from "../ui/Panel";
import { SMALL } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 플레이어 목록. */
export default function PlayerListSection({ m }: { m: AdminModel }) {
  const {
    listError,
    listLoading,
    load,
    openDetail,
    players,
  } = m;
  return (
    <>
      {/* ── 목록 ── */}
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="title-19 text-fg-hi">
            플레이어 {listLoading && players.length === 0 ? "조회 중" : `${players.length}명`}
          </h2>
          <button onClick={load} className={`${SMALL} ml-auto`}>
            새로고침
          </button>
        </div>

        {/* 이미 읽어 둔 명단이 있는데 새로고침이 실패한 경우 — 표는 그대로 두고 여기서만 알린다 */}
        {listError && players.length > 0 && (
          <p className="mono-13 border-loss/40 border bg-bg-1 px-3 py-2 text-loss">
            명단을 새로 읽지 못했다 — {listError} (아래는 마지막으로 읽은 값이다)
          </p>
        )}

        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[38rem] text-left">
            <thead>
              <tr className="label-11 text-fg-low border-line-soft border-b">
                <th className="pb-2 pr-2 font-normal">아이디</th>
                <th className="pb-2 pr-2 font-normal">상태</th>
                <th className="pb-2 pr-2 text-right font-normal">에너지</th>
                <th className="pb-2 pr-2 text-right font-normal">코인</th>
                <th className="pb-2 pr-2 text-right font-normal">횟수</th>
                <th className="pb-2 font-normal">소지품</th>
              </tr>
            </thead>
            <tbody className="mono-13">
              {players.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6">
                    <p
                      className={`scanline-faint mono-13 border-line border border-dashed px-3 py-6 text-center ${
                        listError ? "text-loss" : "text-fg-low"
                      }`}
                    >
                      {listError
                        ? `명단을 읽지 못했다 — ${listError}`
                        : listLoading
                          ? "명단을 읽는 중"
                          : "등록된 플레이어 없음"}
                    </p>
                  </td>
                </tr>
              )}
              {players.map((p) => (
                <tr
                  key={p.username}
                  onClick={() => openDetail(p.username)}
                  className="border-line-soft state-fade cursor-pointer border-b hover:bg-surface"
                >
                  <td className="text-fg-hi py-2 pr-2">
                    {p.username}
                    {p.is_admin && (
                      <span className="label-11 text-brass ml-1">ADMIN</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <span
                      className={p.in_ward ? "text-loss" : "text-fg-mid"}
                    >
                      {p.hp_status}
                    </span>
                    {p.suspended_until && (
                      <span className="label-11 text-loss ml-1">정지</span>
                    )}
                  </td>
                  <td className="text-fg-mid py-2 pr-2 text-right tabular-nums">
                    {p.hp}
                  </td>
                  <td className="text-brass py-2 pr-2 text-right tabular-nums">
                    {p.coins}
                  </td>
                  <td className="text-fg-mid py-2 pr-2 text-right tabular-nums">
                    {p.plays_left}
                    {p.bonus_plays > 0 && (
                      <span className="text-brass ml-1">+{p.bonus_plays}</span>
                    )}
                  </td>
                  <td className="py-2">
                    {p.items.length === 0 ? (
                      <span className="text-fg-low">-</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {p.items.map((it) => (
                          <span
                            key={it.code}
                            title={`${it.name} ×${it.qty}`}
                            className="bg-surface text-fg-mid whitespace-nowrap px-1.5 py-0.5"
                          >
                            {it.emoji}
                            <span className="text-fg ml-0.5 tabular-nums">
                              {it.qty}
                            </span>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mono-13 text-fg-low">
          아이디를 누르면 상세를 볼 수 있습니다. 비밀번호는 해시로만 저장되어 관리자도
          볼 수 없습니다. 초기 비밀번호는 발급할 때 한 번만 보여 줍니다.
        </p>
      </Panel>

    </>
  );
}
