const WEEKDAY_FROM_INDEX = [
    'SUN',
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT'
];
export function getTodayWeekdayInJst() {
    const now = new Date();
    const jstMillis = now.getTime() + 9 * 60 * 60 * 1000;
    const jstDate = new Date(jstMillis);
    return WEEKDAY_FROM_INDEX[jstDate.getUTCDay()];
}
