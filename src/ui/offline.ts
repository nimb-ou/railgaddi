// Works on the train, too: a service worker keeps the app, the whole timetable and every photo
// you've seen, so it still works when the signal drops. New versions wait for a reload.
import { registerSW } from "virtual:pwa-register";

interface Toaster {
  toast(text: string, ms?: number, action?: { label: string; run: () => void }): void;
}

export function registerOffline(app: Toaster) {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  // the offline copy is a few megabytes: fetch it once the page and its photos are in, so on a
  // slow connection it never competes with what you're looking at
  const start = () => {
    const update = registerSW({
      immediate: true,
      onOfflineReady() {
        app.toast("Railgaddi now works offline, even on the train", 4000);
      },
      onNeedRefresh() {
        app.toast("A newer version is ready", 12000, { label: "Reload", run: () => update(true) });
      },
    });
  };
  const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const later = () => setTimeout(() => (idle ? idle(start, { timeout: 10000 }) : start()), 4000);
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
  window.addEventListener("offline", () => app.toast("You're offline. The timetable and places you've opened still work."));
  window.addEventListener("online", () => app.toast("Back online", 1800));
}
