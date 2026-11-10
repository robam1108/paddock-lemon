"use client";

import CatGiftPopup from "./CatGiftPopup";
import ResultPopup from "./ui/ResultPopup";
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
 * 이 구역만 색상각이 없다(chroma 0). 놋쇠 토큰까지 무채색으로 덮여 있어서
 * 여기서는 강조색이 나오지 않는다. 전부 등폭이고, 배치는 표다.
 */
export default function Record(props: RecordProps) {
  const m = useRecordModel(props);
  const {
    supabase,
    onRefresh,
    tab,
    setTab,
    catGiftsOpen,
    catStatus,
    setCatGiftsOpen,
    loadCat,
    catNote,
    setCatNote,
  } = m;

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

      {catGiftsOpen && catStatus && (
        <CatGiftPopup
          supabase={supabase}
          gifts={catStatus.gifts}
          name={catStatus.cat_name}
          onKept={() => {
            onRefresh();
          }}
          onClose={() => {
            setCatGiftsOpen(false);
            loadCat();
          }}
        />
      )}

      {catNote && (
        <ResultPopup title={catNote.title} lines={catNote.lines} onClose={() => setCatNote(null)} />
      )}

      <RelationPopups m={m} />
      <ConfirmPopup m={m} />
      <AvatarPopups m={m} />
      <DetailsPopup m={m} />
    </div>
  );
}
