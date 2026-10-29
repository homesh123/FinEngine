// Notification Service Worker — Gold Move + Livermore alerts
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus the first open chart tab, or open a new one
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            client.postMessage({ type: "NOTIFICATION_CLICKED" });
            return;
          }
        }
        if (clients.openWindow) clients.openWindow("/");
      })
  );
});

self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SHOW_NOTIFICATION") {
    const { title = "fx24charts", body = "Markets are live.", tag = "fx-ping" } = event.data;

    event.waitUntil(
      self.registration
        .showNotification(title, {
          body,
          // favicon.svg is guaranteed to exist in /public
          icon: "/favicon.svg",
          badge: "/favicon.svg",
          tag,
          renotify: true,           // always re-fire even if same tag exists
          requireInteraction: false,
          silent: false,            // allow OS to play its own alert sound
        })
        .then(() => {
          // Ask every open tab to play our custom bell chime too
          return clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clientList) => {
              clientList.forEach((client) => {
                client.postMessage({ type: "PLAY_NOTIFICATION_SOUND" });
              });
            });
        })
    );
  }
});