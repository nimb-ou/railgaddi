// Works on the train, too: a service worker keeps the app, the whole timetable and every photo
// you've seen, so it still works when the signal drops. New versions wait for a reload.
import { registerSW } from "virtual:pwa-register";

interface Toaster {
  toast(text: string, ms?: number, action?: { label: string; run: () => void }): void;
}

export function registerOffline(app: Toaster) {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  const update = registerSW({
    immediate: true,
    onOfflineReady() {
      app.toast("Railgaddi now works offline, even on the train", 4000);
    },
    onNeedRefresh() {
      app.toast("A newer version is ready", 12000, { label: "Reload", run: () => update(true) });
    },
  });
  window.addEventListener("offline", () => app.toast("You're offline. The timetable and places you've opened still work."));
  window.addEventListener("online", () => app.toast("Back online", 1800));
}
