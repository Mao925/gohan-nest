import { AvailabilityStatus, MealTimeSlot, TimeSlot, Weekday } from '@prisma/client';
import { getWeekdayInJst, startOfDayInJst } from './date.js';

export type RealMeetMode = 'REAL' | 'MEET';

export function isRealCandidate(status: AvailabilityStatus): boolean {
  return status === AvailabilityStatus.AVAILABLE;
}

export function isMeetCandidate(status: AvailabilityStatus): boolean {
  return (
    status === AvailabilityStatus.AVAILABLE || status === AvailabilityStatus.MEET_ONLY
  );
}

export function mealTimeSlotToTimeSlot(mealTimeSlot: MealTimeSlot): TimeSlot {
  return mealTimeSlot === MealTimeSlot.LUNCH ? TimeSlot.DAY : TimeSlot.NIGHT;
}

export function getWeekdayForDate(date: Date): Weekday {
  return getWeekdayInJst(date);
}

export function startOfDayForDate(date: Date): Date {
  return startOfDayInJst(date);
}

export function computeExpiresAt(baseDate: Date, mealTimeSlot: MealTimeSlot): Date {
  const start = startOfDayForDate(baseDate);
  const jstOffsetHours = mealTimeSlot === MealTimeSlot.LUNCH ? 16 : 24;
  return new Date(start.getTime() + jstOffsetHours * 60 * 60 * 1000);
}
