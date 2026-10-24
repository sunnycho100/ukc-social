// Drawn rather than fetched: a strict CSP and an offline-capable page both rule
// out hotlinking Kakao's logo CDN, and one inline path costs less than a network
// round trip. Its own file because the hangout board shows it beside a member's
// name and PeopleBrowser shows it in the contact sheet.
export default function KakaoMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      style={{ width: 20, height: 20, flexShrink: 0 }}
    >
      <path
        fill="#FEE500"
        d="M12 3.6c-4.7 0-8.5 2.98-8.5 6.65 0 2.36 1.57 4.43 3.94 5.6l-.99 3.65a.3.3 0 0 0 .46.33l4.32-2.85c.25.02.5.03.77.03 4.7 0 8.5-2.98 8.5-6.76S16.7 3.6 12 3.6Z"
      />
    </svg>
  );
}
