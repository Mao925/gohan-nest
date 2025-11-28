import { Weekday } from '@prisma/client';

const WEEKDAY_FROM_INDEX: Weekday[] = [
  'SUN',
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT'
];

export function getTodayWeekdayInJst(): Weekday {
  const now = new Date();
  const jstMillis = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMillis);
  return WEEKDAY_FROM_INDEX[jstDate.getUTCDay()];
}
