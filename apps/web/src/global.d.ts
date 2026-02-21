import type { DesktopApi } from "./preload.js";

declare global {
  interface Window {
    autoagent: DesktopApi;
  }
}

export {};
