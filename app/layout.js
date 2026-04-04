export const metadata = {
  title: '전국 학교 지도',
  description: '전국 고등학교·대학교 위치 및 급식 정보 지도 서비스',
};

export default function RootLayout({ children }) {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  return (
    <html lang="ko">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        {/* 카카오맵 SDK - 서버에서 키를 직접 주입 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          type="text/javascript"
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=clusterer`}
        />
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: "'Noto Sans KR', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
