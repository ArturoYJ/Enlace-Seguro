export function getLocalDate(date: Date = new Date(), timezone = 'America/Mexico_City'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date); // Formats as YYYY-MM-DD
}

export function getNextLocalMidnight(date: Date = new Date(), timezone = 'America/Mexico_City'): Date {
  const localDateStr = getLocalDate(date, timezone);
  const [yearStr, monthStr, dayStr] = localDateStr.split('-');
  const year = parseInt(yearStr ?? '1970', 10);
  const month = parseInt(monthStr ?? '1', 10);
  const day = parseInt(dayStr ?? '1', 10);

  // Advance by 1 day in local terms
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 6, 0, 0)); // Approx 00:00 Mexico City UTC-6
  return nextDay;
}
