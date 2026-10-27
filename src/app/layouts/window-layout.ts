export type WindowLayout = Readonly<{
  seamless: boolean;
  platform: "macos" | "windows" | "linux" | "browser";
}>;

declare global {
  interface Window {
    readonly __ICEON_WINDOW_LAYOUT__?: WindowLayout;
  }
}

export function getWindowLayout(): WindowLayout {
  return typeof window === "undefined"
    ? { seamless: false, platform: "browser" }
    : window.__ICEON_WINDOW_LAYOUT__ ?? { seamless: false, platform: "browser" };
}
