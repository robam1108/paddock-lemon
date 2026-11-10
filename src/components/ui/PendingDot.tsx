/** 대기·답변 알림 점. 건수는 보이지 않고 유무만 표시한다. */
export default function PendingDot({
  label = "확인할 대기 있음",
}: {
  /** 화면에는 안 보이고 스크린리더만 읽는 문구 */
  label?: string;
}) {
  return (
    <>
      <span
        aria-hidden
        className="bg-alert ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
      />
      <span className="sr-only">{label}</span>
    </>
  );
}
