"use client";

import type { PlayerState } from "@/lib/game";
import { facilityRules } from "@/lib/rules";
import { LABEL } from "@/lib/copy";
import SidePanel from "./ui/SidePanel";

/**
 * 서식 K-77 부칙.
 *
 * 항상 펼쳐 둔다 — 규칙을 접을 수 있게 만들면 몰랐다고 할 수 있게 되고,
 * 시설은 그걸 허용하지 않는다. 그래서 이 패널만 배경이 한 단 밝다.
 *
 * 본문 높이를 고정하지 않는다. 부칙은 스크롤 없이 전부 보여야 하므로,
 * 항목 수만큼 자연스럽게 늘어나고 아래 두 패널이 밀리는 건 감수한다.
 */
export default function RulesPanel({ state }: { state: PlayerState }) {
  const rules = facilityRules(state);

  return (
    <SidePanel
      title={LABEL.rules}
      meta={`부칙 ${rules.length}항`}
      defaultOpen
    >
      <ol className="flex flex-col gap-2">
        {rules.map((r) => (
          <li
            key={r.no}
            className="grid grid-cols-[26px_minmax(0,1fr)] gap-2"
          >
            <span className="mono-13 text-fg-low tabular-nums">{r.no}</span>
            <span
              className={`body-15 ${
                r.personal ? "text-fg border-brass-line border-l pl-2" : "text-fg-mid"
              }`}
            >
              {r.text}
            </span>
          </li>
        ))}
      </ol>
    </SidePanel>
  );
}
