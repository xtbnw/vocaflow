const PERMISSION_DENIED: NotificationPermission = "denied";

export function getNotificationPermission(): NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return PERMISSION_DENIED;
  }
  return Notification.permission;
}

export function isNotificationSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return PERMISSION_DENIED;
  try {
    return await Notification.requestPermission();
  } catch {
    return PERMISSION_DENIED;
  }
}

export function showBrowserNotification(title: string, body: string): void {
  if (getNotificationPermission() !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // ignore — toast still works regardless
  }
}
