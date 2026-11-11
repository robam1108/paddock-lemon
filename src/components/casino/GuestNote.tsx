/** 게스트로 들어온 사람에게만 뜨는 한 줄 — 계정이 언제 지워지는지 알린다. */
export default function GuestNote({ expiresAt }: { expiresAt: string }) {
  // 서버 렌더와 브라우저의 시간대가 달라도 같은 글자가 나오도록 KST 로 고정한다.
  const when = new Date(expiresAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <p className="mono-13 border-brass-line border bg-brass-fill px-3 py-2 text-fg-hi">
      게스트 체험 중입니다. 이 계정과 기록은 {when}(KST)에 지워지며, 사진 올리기는 막혀 있습니다.
    </p>
  );
}
