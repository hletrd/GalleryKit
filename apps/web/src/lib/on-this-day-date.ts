export type MonthDay = {
    month: number;
    day: number;
};

export function getLocalMonthDay(now: Date = new Date()): MonthDay {
    return {
        month: now.getMonth() + 1,
        day: now.getDate(),
    };
}
