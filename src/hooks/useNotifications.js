import { useState, useEffect, useCallback } from "react";

let permissionRequested = false;

const tryRequestPermission = () => {
    if (permissionRequested) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    permissionRequested = true;
    Notification.requestPermission().catch(() => {});
};

let initStarted = false;
const permissionListeners = new Set();

function initNotificationsOnce(onPermission) {
    permissionListeners.add(onPermission);
    if (initStarted) return;
    initStarted = true;

    const run = () => {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/notification-sw.js").catch(() => {});
        }
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission()
                .then(perm => permissionListeners.forEach(fn => fn(perm)))
                .catch(() => {});
        }
    };
    if (document.readyState === "complete") setTimeout(run, 0);
    else window.addEventListener("load", run, { once: true });

    // Some browsers silently ignore requestPermission from non-gesture context.
    // Retry on the first real user gesture so Gold Move notifications can fire.
    document.addEventListener("click", tryRequestPermission, { once: true });
    document.addEventListener("touchstart", tryRequestPermission, { once: true });
    document.addEventListener("keydown", tryRequestPermission, { once: true });
}

export function useNotifications() {
  const [enabled, setEnabled] = useState(() => {
    // Default ON — only false if user explicitly disabled it
    const stored = localStorage.getItem("notificationsEnabled");
    return stored === null ? true : stored === "true";
  });
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

  // Register the service worker (needed so MTF signal notifications work in background)
  // and auto-request permission since notifications are on by default.
  // Runs once per page (not once per chart panel), after the page has loaded.
  useEffect(() => {
    const onPermission = (perm) => setPermission(perm);
    initNotificationsOnce(onPermission);
    return () => { permissionListeners.delete(onPermission); };
  }, []);

  useEffect(() => {
    const handleStorage = (e) => {
        if (e.type === "storage" && e.key === "notificationsEnabled") {
            setEnabled(e.newValue === "true");
        } else if (e.type === "notificationsToggled") {
            const stored = localStorage.getItem("notificationsEnabled");
            setEnabled(stored === "true");
        }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("notificationsToggled", handleStorage);
    return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener("notificationsToggled", handleStorage);
    };
  }, []);

  const disableNotifications = useCallback(() => {
    setEnabled(false);
    localStorage.setItem("notificationsEnabled", "false");
    window.dispatchEvent(new Event("notificationsToggled"));
  }, []);

  const enableNotifications = useCallback(async () => {
    if (!("Notification" in window)) { alert("Browser does not support notifications."); return; }
    let perm = Notification.permission;
    if (perm === "default") { perm = await Notification.requestPermission(); setPermission(perm); }
    if (perm !== "granted") { alert("Please allow notifications in your browser settings."); return; }
    setEnabled(true);
    localStorage.setItem("notificationsEnabled", "true");
    window.dispatchEvent(new Event("notificationsToggled"));
  }, []);

  const toggle = useCallback(() => {
    if (enabled) { disableNotifications(); } else { enableNotifications(); }
  }, [enabled, enableNotifications, disableNotifications]);

  return { enabled, permission, toggle, disableNotifications };
}
