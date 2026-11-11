"use client";

import TabRail from "./ui/TabRail";
import { TABS } from "./profile/shared";
import { useRecordModel, type RecordProps } from "./profile/useRecordModel";
import ProfileTab from "./profile/ProfileTab";
import ItemsTab from "./profile/ItemsTab";
import RosterTab from "./profile/RosterTab";
import HistoryTab from "./profile/HistoryTab";
import RelationPopups from "./profile/RelationPopups";
import ConfirmPopup from "./profile/ConfirmPopup";
import AvatarPopups from "./profile/AvatarPopups";
import DetailsPopup from "./profile/DetailsPopup";

/**
 * 프로필 — 내 정보 · 소지품 · 친구 · 기록.
 *
 * 아이보리 바탕에 골드는 아껴 쓴다. 전부 등폭이고, 배치는 표다.
 */
export default function Record(props: RecordProps) {
  const m = useRecordModel(props);
  const { tab, setTab } = m;

  return (
    <div className="flex flex-col gap-2">
      <TabRail
        items={TABS}
        value={tab}
        onChange={setTab}
        marker="left"
        columns="grid-cols-4"
        height="h-10"
      />

      <ProfileTab m={m} />
      <ItemsTab m={m} />
      <RosterTab m={m} />
      <HistoryTab m={m} />

      <RelationPopups m={m} />
      <ConfirmPopup m={m} />
      <AvatarPopups m={m} />
      <DetailsPopup m={m} />
    </div>
  );
}
