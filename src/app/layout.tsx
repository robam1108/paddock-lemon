import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DISCLAIMER, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${SITE_TAGLINE} · ${DISCLAIMER}`,
};

export const viewport: Viewport = {
  // --bg-0 과 같은 색. 브라우저 크롬까지 화면 바닥색으로 이어 붙인다.
  themeColor: "#1b2124",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard 는 Google Fonts 에 없어 jsDelivr 에서 받는다.
            등폭 두 벌은 Google Fonts. 명조는 상점 라벨에서만 쓴다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Noto+Serif+KR:wght@400;600&display=swap"
        />
      </head>
      <body>
        {children}
        <footer className="mono-13 text-fg-low bg-bg-0 px-4 pb-4 text-center">
          {SITE_NAME} · {DISCLAIMER}
        </footer>
      </body>
    </html>
  );
}
