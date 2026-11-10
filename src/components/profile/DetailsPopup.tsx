"use client";

import { createPortal } from "react-dom";
import MonoLabel from "../ui/MonoLabel";
import { action, inputField } from "./shared";
import type { RecordModel } from "./useRecordModel";

/** 프로필 수정 팝업. */
export default function DetailsPopup({ m }: { m: RecordModel }) {
  const {
    dAge,
    dBio,
    dCrime,
    dHeight,
    dWeight,
    detailsBusy,
    detailsError,
    detailsOpen,
    saveDetails,
    setDAge,
    setDBio,
    setDCrime,
    setDHeight,
    setDWeight,
    setDetailsOpen,
  } = m;
  return (
    <>
      {/* 프로필 수정 팝업 — 상태 메시지 · 나이 · 키/체중 · 소개 */}
      {detailsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bg-bg-0/80 fixed inset-0 z-50 flex items-center justify-center p-4"
            data-zone="record"
            onClick={() => !detailsBusy && setDetailsOpen(false)}
          >
            <div
              className="border-line max-h-[85dvh] w-full max-w-md overflow-y-auto border bg-bg-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-line-soft flex items-center justify-between border-b px-4 py-3">
                <MonoLabel>프로필 수정</MonoLabel>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                  disabled={detailsBusy}
                  className="label-11 text-fg-mid hover:text-fg-hi disabled:text-fg-low"
                >
                  닫기
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="mono-13 text-fg-low">
                  사진은 프로필 카드의 사진 칸을 눌러 바꿉니다. 휴대전화에서는 길게 누르세요.
                </p>

                <MonoLabel tone="low">상태 메시지</MonoLabel>
                <input
                  value={dCrime}
                  onChange={(e) => setDCrime(e.target.value)}
                  maxLength={40}
                  placeholder="예: 오늘은 경마만 봅니다"
                  className={inputField}
                />

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-2">
                    <MonoLabel tone="low">나이</MonoLabel>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={dAge}
                      onChange={(e) => setDAge(e.target.value)}
                      min={1}
                      max={120}
                      placeholder="세"
                      className={inputField}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <MonoLabel tone="low">키 / 체중</MonoLabel>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={dHeight}
                        onChange={(e) => setDHeight(e.target.value)}
                        min={50}
                        max={250}
                        step={0.1}
                        placeholder="cm"
                        className={inputField}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        value={dWeight}
                        onChange={(e) => setDWeight(e.target.value)}
                        min={20}
                        max={300}
                        step={0.1}
                        placeholder="kg"
                        className={inputField}
                      />
                    </div>
                  </div>
                </div>

                <MonoLabel tone="low">소개</MonoLabel>
                <textarea
                  value={dBio}
                  onChange={(e) => setDBio(e.target.value)}
                  maxLength={300}
                  rows={5}
                  placeholder="예: 주말 저녁에 주로 접속합니다."
                  className="mono-13 border-line bg-surface text-fg-hi placeholder:text-fg-low focus:border-brass-line min-h-32 w-full resize-none border px-3 py-2.5 outline-none"
                />


                {detailsError && (
                  <p className="mono-13 text-loss">{detailsError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={detailsBusy}
                    onClick={saveDetails}
                    className="label-11 state-fade flex-1 border border-brass-line bg-brass-fill px-3 py-2.5 text-fg-hi disabled:border-line-soft disabled:bg-surface disabled:text-fg-low"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    disabled={detailsBusy}
                    onClick={() => setDetailsOpen(false)}
                    className={action}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
