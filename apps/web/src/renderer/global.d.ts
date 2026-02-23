import type { DesktopApi } from "../shared/ipc.js";

declare global {
  interface Window {
    autoagent: DesktopApi;
  }
}

export {};
