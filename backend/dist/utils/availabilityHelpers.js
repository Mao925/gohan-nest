import { AvailabilityStatus, MealTimeSlot, TimeSlot } from '@prisma/client';
import { getWeekdayInJst, startOfDayInJst } from './date.js';
export function isRealCandidate(status) {
    return status === AvailabilityStatus.AVAILABLE;
}
export function isMeetCandidate(status) {
    return (status === AvailabilityStatus.AVAILABLE || status === AvailabilityStatus.MEET_ONLY);
}
export function mealTimeSlotToTimeSlot(mealTimeSlot) {
    return mealTimeSlot === MealTimeSlot.LUNCH ? TimeSlot.DAY : TimeSlot.NIGHT;
}
export function getWeekdayForDate(date) {
    return getWeekdayInJst(date);
}
export function startOfDayForDate(date) {
    return startOfDayInJst(date);
}
export function computeExpiresAt(baseDate, mealTimeSlot) {
    const start = startOfDayForDate(baseDate);
    const jstOffsetHours = mealTimeSlot === MealTimeSlot.LUNCH ? 16 : 24;
    return new Date(start.getTime() + jstOffsetHours * 60 * 60 * 1000);
}
