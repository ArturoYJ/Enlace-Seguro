import type { DateRange } from './api';

export function mexicoToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function defaultRange(now = new Date()): DateRange {
  const today = mexicoToday(now);
  return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
}

export function validRange(range: DateRange): boolean {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return valid(range.startDate) && valid(range.endDate) && range.startDate <= range.endDate;
}
