const DAY_MS = 86400000;

/** Calendar-day index; it is not a timestamp for the source business event. */
export function isoCalendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) return null;
  return instant / DAY_MS;
}

/** Includes today and the preceding days - 1 calendar dates in the business zone. */
export function calendarWindow(asOf: string, timezone: string, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new RangeError('Invalid report window.');
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(asOf));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  const endDate = value('year') + '-' + value('month') + '-' + value('day');
  const end = isoCalendarDay(endDate);
  if (end === null) throw new RangeError('Invalid report date.');
  return { start: end - days + 1, end };
}
