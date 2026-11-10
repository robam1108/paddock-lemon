import type { ItemGrade } from "@/lib/game";

/**
 * 품목 표시.
 *
 * DB 에 저장된 이모지를 그대로 띄운다. 등급은 색이 아니라 면의 밝기와 테두리
 * 한 단으로 읽힌다. 프로필 구역에서는 놋쇠 토큰이 무채색으로 덮이므로 이
 * 컴포넌트의 테두리·면도 자동으로 색을 잃는다.
 *
 * emoji 가 없으면 분류 한 글자로 대체한다.
 */

const KIND_MARK: Record<string, string> = {
  food: "식",
  liquor: "음",
  medicine: "회",
  luxury: "꾸",
  permit: "증",
  treat: "간",
  tool: "도",
  gift: "선",
};

const GRADE_TONE: Record<ItemGrade, string> = {
  common: "border-transparent bg-surface text-fg-mid",
  uncommon: "border-transparent bg-surface-hi text-fg",
  rare: "border-line bg-surface-hi text-fg-hi",
  epic: "border-brass-line bg-brass-fill text-fg-hi",
  legendary: "border-brass bg-brass-fill text-fg-hi",
};

const SIZE = {
  sm: "h-7 w-7 text-[13px]",
  md: "h-9 w-9 text-[15px]",
  lg: "h-12 w-12 text-[19px]",
};

export default function ItemMark({
  kind,
  grade,
  emoji,
  size = "md",
}: {
  kind: string;
  grade: ItemGrade;
  emoji?: string;
  size?: keyof typeof SIZE;
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center border font-mono font-semibold ${SIZE[size]} ${GRADE_TONE[grade]}`}
    >
      {emoji || KIND_MARK[kind] || "물"}
    </span>
  );
}
