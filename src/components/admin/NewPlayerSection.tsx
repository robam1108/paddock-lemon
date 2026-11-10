"use client";

import Panel from "../ui/Panel";
import MonoLabel from "../ui/MonoLabel";
import { FIELD, PRIMARY, SectionHead } from "./ui";
import type { AdminModel } from "./useAdminModel";

/** 새 플레이어 발급 — 초기 비밀번호는 한 번만 보여 준다. */
export default function NewPlayerSection({ m }: { m: AdminModel }) {
  const {
    addPlayer,
    busy,
    issued,
    newName,
    setNewName,
  } = m;
  return (
    <>
      {/* ── 새 플레이어 ── */}
      <Panel className="flex flex-col gap-2">
        <SectionHead
          title="플레이어 추가"
          desc="아이디만 넣으면 서버가 초기 비밀번호를 만들어 발급합니다."
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPlayer()}
            placeholder="아이디 (예: demo01)"
            className={FIELD}
          />
          <button
            disabled={busy || !newName.trim()}
            onClick={addPlayer}
            className={PRIMARY}
          >
            발급
          </button>
        </div>

        {issued && (
          <div className="mt-1 border border-brass-line bg-brass-fill p-4 text-center">
            <MonoLabel tone="dim">발급 완료</MonoLabel>
            <p className="title-19 text-fg-hi mt-1">{issued.name}</p>
            <p className="num-md text-brass mt-1 tracking-[0.2em] tabular-nums">
              {issued.password}
            </p>
            <p className="mono-13 text-fg-low mt-1">
              초기 비밀번호는 지금 한 번만 보입니다. 본인에게 전달해 주세요.
            </p>
          </div>
        )}
      </Panel>

    </>
  );
}
