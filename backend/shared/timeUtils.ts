/**
 * Shared time utilities for calendar operations.
 * All comparisons use epoch milliseconds to avoid timezone string-comparison bugs.
 */

export function toTimestamp(iso: string): number {
  return new Date(iso).getTime();
}

export function isInRange(
  eventStartAt: string,
  eventEndAt: string,
  rangeStartAt: string,
  rangeEndAt: string,
): boolean {
  const eventStart = toTimestamp(eventStartAt);
  const eventEnd = toTimestamp(eventEndAt);
  const rangeStart = toTimestamp(rangeStartAt);
  const rangeEnd = toTimestamp(rangeEndAt);
  return eventStart < rangeEnd && eventEnd > rangeStart;
}

/** Check whether an ISO datetime falls on the given local date (YYYY-MM-DD). */
export function isOnLocalDate(iso: string, dateKey: string): boolean {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` === dateKey;
}

export function defaultEndAt(startAt: string): string {
  return new Date(toTimestamp(startAt) + 3_600_000).toISOString();
}

export function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hour}:${min}`;
}

export function formatTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const startTime = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  const endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  return `${startTime}-${endTime}`;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
