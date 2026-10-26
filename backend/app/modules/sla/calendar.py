"""Working-day calendar backed by the calendar_day table (national holidays; weekends off)."""

from __future__ import annotations

import bisect
import datetime as dt
import threading
import time
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

IST = ZoneInfo("Asia/Kolkata")


class WorkCalendar:
    def __init__(self, rows: list[tuple[dt.date, bool, int]]) -> None:
        self.index = {d: i for d, _, i in rows}
        self.working_days = [d for d, w, _ in rows if w]
        self.first = rows[0][0] if rows else dt.date(2024, 1, 1)
        self.last = rows[-1][0] if rows else dt.date(2030, 12, 31)

    def is_working(self, day: dt.date) -> bool:
        if self.first <= day <= self.last:
            pos = bisect.bisect_left(self.working_days, day)
            return pos < len(self.working_days) and self.working_days[pos] == day
        return day.weekday() < 5

    def add_working_days(self, start: dt.date, n: int) -> dt.date:
        """The n-th working day after `start` (n may be negative)."""
        if not (self.first <= start <= self.last):
            step = 1 if n >= 0 else -1
            day, left = start, abs(n)
            while left:
                day += dt.timedelta(days=step)
                if day.weekday() < 5:
                    left -= 1
            return day
        target = self.index[start] + n
        if n <= 0 and not self.is_working(start):
            target += 1
        target = max(1, min(target, len(self.working_days)))
        return self.working_days[target - 1]

    def working_days_between(self, a: dt.date, b: dt.date) -> int:
        """Working days in (a, b]; negative if b is before a."""
        if a in self.index and b in self.index:
            return self.index[b] - self.index[a]
        sign = 1 if b >= a else -1
        lo, hi = (a, b) if b >= a else (b, a)
        return sign * sum(1 for i in range(1, (hi - lo).days + 1) if (lo + dt.timedelta(days=i)).weekday() < 5)

    def add_days(self, start: dt.date, n: int, basis: str) -> dt.date:
        return self.add_working_days(start, n) if basis == "WORKING" else start + dt.timedelta(days=n)


_cache: tuple[float, WorkCalendar] | None = None
_lock = threading.Lock()


def get_calendar(db: Session, max_age_s: float = 300.0) -> WorkCalendar:
    global _cache
    with _lock:
        if _cache and time.monotonic() - _cache[0] < max_age_s:
            return _cache[1]
    rows = [tuple(r) for r in db.execute(text("SELECT day, is_working, wd_index FROM calendar_day ORDER BY day")).all()]
    cal = WorkCalendar(rows)  # type: ignore[arg-type]
    with _lock:
        _cache = (time.monotonic(), cal)
    return cal


def invalidate() -> None:
    global _cache
    with _lock:
        _cache = None


def at_ist(day: dt.date, hour: int = 9) -> dt.datetime:
    return dt.datetime.combine(day, dt.time(hour, 0), tzinfo=IST)


def today_ist() -> dt.date:
    return dt.datetime.now(IST).date()
