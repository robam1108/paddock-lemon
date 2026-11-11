"use client";

import { setRules, type Rules } from "@/lib/server-rules";
import { useAdminModel } from "./admin/useAdminModel";
import AdminHeader from "./admin/AdminHeader";
import NewPlayerSection from "./admin/NewPlayerSection";
import PetitionSection from "./admin/PetitionSection";
import RelationSection from "./admin/RelationSection";
import PlayerListSection from "./admin/PlayerListSection";
import PlayerDetailSection from "./admin/PlayerDetailSection";
import DetailPopups from "./admin/DetailPopups";
import DeletePlayerSection from "./admin/DeletePlayerSection";
import GrantSection from "./admin/GrantSection";
import TradeSection from "./admin/TradeSection";

/**
 * 관리자 화면 — 게임 화면과 같은 헤더 골격을 쓴다.
 * 표면 5단계 · 골드 강조 · 등폭 라벨. 색은 상태선에만 얹는다.
 *
 * 위에서 아래 순서: 플레이어 추가 → 피드백 → 친구 신청 → 플레이어 목록/상세
 * → 플레이어 삭제 → 코인 지급 → 아이템 지급 → 게임 횟수 → 유저 간 거래.
 * 매일 손이 가는 것(추가·피드백·친구·조회)을 위에, 파괴적이거나 드문 것
 * (삭제·지급류·거래 열람/취소)을 아래에 둔다.
 */
export default function AdminPanel({ username, rules }: { username: string; rules: Rules }) {
  setRules(rules);
  const m = useAdminModel(username);

  return (
    <main className="bg-bg-0 min-h-dvh px-3 pb-10 pt-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <AdminHeader m={m} />
        <NewPlayerSection m={m} />
        <PetitionSection m={m} />
        <RelationSection m={m} />
        <PlayerListSection m={m} />
        <PlayerDetailSection m={m} />
        <DetailPopups m={m} />
        <DeletePlayerSection m={m} />
        <GrantSection m={m} />
        <TradeSection m={m} />
      </div>
    </main>
  );
}
