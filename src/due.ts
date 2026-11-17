// A todo's due and repeat in words, for the notes and the reminder bubble,
// which has no use for the rest of the notes' page.

// The ways a todo repeats, for Todo.repeat.
export const REPEATS: Record<string, string> = { day: "每天", weekday: "工作日", week: "每周", month: "每月", year: "每年" };

export const WEEKDAYS = "日一二三四五六";

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// dueInfo describes a todo's due, 2026-11-12 or 2026-11-12T15:00: how many
// days away its date is, whether it passed, and a label such as 明天 15:00.
export function dueInfo(due: string, now = new Date()) {
  const [y, m, d] = due.slice(0, 10).split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const time = due.slice(11);
  const days = Math.round((date.getTime() - startOfDay(now).getTime()) / 86400000);
  const at = time ? new Date(`${due.slice(0, 10)}T${time}`) : null;
  const overdue = at ? at < now : days < 0;
  const names: Record<number, string> = { [-1]: "昨天", 0: "今天", 1: "明天", 2: "后天" };
  let label = names[days];
  if (!label) {
    label = y === now.getFullYear() ? `${m}月${d}日` : `${y}年${m}月${d}日`;
    if (Math.abs(days) < 7) label += ` 周${WEEKDAYS[date.getDay()]}`;
  }
  return { days, overdue, label: time ? `${label} ${time}` : label };
}
