"use client";

import Panel from "../ui/Panel";
import MonoLabel from "../ui/MonoLabel";
import { DANGER, FIELD, PLAIN, SectionHead } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 플레이어 삭제(아이디 재입력 확인). */
export default function DeletePlayerSection({ m }: { m: AdminModel }) {
  const {
    busy,
    delConfirm,
    delConfirmOpen,
    delName,
    deletePlayer,
    error,
    setDelConfirm,
    setDelConfirmOpen,
    setDelName,
  } = m;
  return (
    <>
      {/* ── 플레이어 삭제 ── */}
      <Panel className="flex flex-col gap-2">
        <SectionHead
          title="플레이어 삭제"
          desc="실수를 막으려고 아이디를 두 번 입력합니다. 지우면 기록도 함께 사라집니다."
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={delName}
            onChange={(e) => setDelName(e.target.value)}
            placeholder="아이디"
            className={FIELD}
          />
          <input
            value={delConfirm}
            onChange={(e) => setDelConfirm(e.target.value)}
            placeholder="아이디 한 번 더"
            className={FIELD}
          />
          <button
            disabled={busy || !delName.trim() || !delConfirm.trim()}
            onClick={() => setDelConfirmOpen(true)}
            className={DANGER}
          >
            삭제
          </button>
        </div>
      </Panel>

      {/* ── 삭제 확인 팝업 ── */}
      {delConfirmOpen && (
        <div
          className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setDelConfirmOpen(false)}
        >
          <div
            className="border-line w-full max-w-xs border bg-bg-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
              <MonoLabel>삭제 확인</MonoLabel>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <p className="body-15 text-fg">
                {delName} 을(를) 삭제한다. 코인·소지품·관계·기록이 전부
                사라지고 되돌릴 수 없다. 정말 삭제할까요?
              </p>
              {error && <p className="mono-13 text-loss">{error}</p>}
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={deletePlayer}
                  className={`${DANGER} flex-1`}
                >
                  삭제 확정
                </button>
                <button
                  disabled={busy}
                  onClick={() => setDelConfirmOpen(false)}
                  className={`${PLAIN} flex-1`}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
