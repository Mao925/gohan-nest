import { Weekday } from '@prisma/client';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_FROM_INDEX: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function getWeekdayInJst(date = new Date()): Weekday {
  const jstMillis = date.getTime() + JST_OFFSET_MS;
  const jstDate = new Date(jstMillis);
  return WEEKDAY_FROM_INDEX[jstDate.getUTCDay()];
}

export function startOfDayInJst(date = new Date()): Date {
  const jstMillis = date.getTime() + JST_OFFSET_MS;
  const jstDayStart = new Date(Math.floor(jstMillis / DAY_MS) * DAY_MS);
  return new Date(jstDayStart.getTime() - JST_OFFSET_MS);
}

export function getTodayWeekdayInJst(): Weekday {
  return getWeekdayInJst();
}
