/**
 * 화면 질감.
 *
 * 이 단말은 CRT 도 아니고 새 LCD 도 아닌, 창고에 오래 있던 물건이다.
 * 노이즈는 배경 3% / 텍스트 위 1.2%, 비네트는 가장자리에만. 스캔라인은
 * 여기 없다 — 헤더 서식 스트립에만 얹는다(globals.css 의 .scanline).
 *
 * 세 겹 다 aria-hidden + pointer-events:none. 읽는 데 방해가 되면 실패다.
 *
 * 참고: 소진 상태에서 루트에 filter 가 걸리면 이 fixed 레이어들의 기준이
 * 루트로 바뀐다. 루트가 페이지 전체 높이를 덮으므로 결과는 오히려 더 낫다
 * (뷰포트가 아니라 문서 전체에 결이 깔린다).
 */

const GRAIN_BG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

const GRAIN_FG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n2'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(%23n2)'/></svg>\")";

export default function Texture() {
  return (
    <>
      {/* 배경 결 — 본문 아래 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          opacity: 0.03,
          backgroundImage: GRAIN_BG,
          backgroundSize: "160px 160px",
        }}
      />
      {/* 본문 위에 한 겹 더. 글자에 미세하게 얹혀 인쇄물처럼 보이게 한다. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-62"
        style={{
          opacity: 0.012,
          backgroundImage: GRAIN_FG,
          backgroundSize: "160px 160px",
        }}
      />
      {/* 가장자리가 죽은 화면. 오래된 패널의 광량 저하. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-63"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 45%, transparent 62%, oklch(0 0 0 / 0.12) 100%)",
        }}
      />
    </>
  );
}
