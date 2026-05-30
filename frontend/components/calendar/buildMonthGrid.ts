export type MonthCell = {
  date: Date;
  day: number;
  isoDate: string;
  isCurrentMonth: boolean;
  isToday: boolean;
};

const calendarCellCount = 42;

export function buildMonthGrid(year: number, monthIndex: number): MonthCell[] {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const firstWeekday = firstOfMonth.getDay();
  const gridStart = new Date(year, monthIndex, 1 - firstWeekday);
  const today = new Date();
  const todayKey = toDateKey(today);

  return Array.from({ length: calendarCellCount }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    const isoDate = toDateKey(date);

    return {
      date,
      day: date.getDate(),
      isoDate,
      isCurrentMonth: date.getMonth() === monthIndex && date.getFullYear() === year,
      isToday: isoDate === todayKey,
    };
  });
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
