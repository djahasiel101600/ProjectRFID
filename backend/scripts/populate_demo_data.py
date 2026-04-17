"""
populate_demo_data.py
=====================
Populates 3 weeks of realistic demo data for the Weekly Schedule page.

Run from the backend/ directory:
    python scripts/populate_demo_data.py

Or via Django shell:
    python manage.py shell < scripts/populate_demo_data.py
"""

import os
import sys
import django
import random
from datetime import date, time, timedelta
from decimal import Decimal

# ── Django setup ──────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from django.utils import timezone
from django.contrib.auth import get_user_model
from core.models import (
    Classroom, Schedule, AttendanceSession, TeacherEnergyUsage,
)

User = get_user_model()

# ── Configuration ─────────────────────────────────────────────────────────────
WEEKS_BACK = 3          # how many full past weeks to generate
ATTENDANCE_RATE = 0.82  # ~82 % of slots will have attendance
SEED = 42               # reproducible randomness

random.seed(SEED)

# ── Demo teachers (created if they don't exist) ───────────────────────────────
DEMO_TEACHERS = [
    {"username": "teacher_reyes",   "first_name": "Maria",   "last_name": "Reyes",    "rfid_uid": "RFID-DEMO-001"},
    {"username": "teacher_santos",  "first_name": "Jose",    "last_name": "Santos",   "rfid_uid": "RFID-DEMO-002"},
    {"username": "teacher_garcia",  "first_name": "Ana",     "last_name": "Garcia",   "rfid_uid": "RFID-DEMO-003"},
    {"username": "teacher_lim",     "first_name": "Carlos",  "last_name": "Lim",      "rfid_uid": "RFID-DEMO-004"},
    {"username": "teacher_dizon",   "first_name": "Rosa",    "last_name": "Dizon",    "rfid_uid": "RFID-DEMO-005"},
]

# ── Demo classrooms (created if they don't exist) ─────────────────────────────
DEMO_CLASSROOMS = [
    {"name": "Room 101", "device_id": "ESP32-DEMO-01", "device_token": "tok-demo-101"},
    {"name": "Room 102", "device_id": "ESP32-DEMO-02", "device_token": "tok-demo-102"},
    {"name": "Room 201", "device_id": "ESP32-DEMO-03", "device_token": "tok-demo-103"},
]

# ── Schedule definition ───────────────────────────────────────────────────────
# (teacher_idx, classroom_idx, day_of_week, start_time, end_time, subject)
SCHEDULE_DEFS = [
    # Reyes — Mon/Wed/Fri Room 101
    (0, 0, 0, time(7, 30),  time(9, 0),   "Mathematics"),
    (0, 0, 2, time(7, 30),  time(9, 0),   "Mathematics"),
    (0, 0, 4, time(7, 30),  time(9, 0),   "Mathematics"),
    # Santos — Tue/Thu Room 101
    (1, 0, 1, time(9, 30),  time(11, 0),  "Filipino"),
    (1, 0, 3, time(9, 30),  time(11, 0),  "Filipino"),
    # Garcia — Mon/Tue/Wed Room 102
    (2, 1, 0, time(10, 0),  time(11, 30), "Science"),
    (2, 1, 1, time(13, 0),  time(14, 30), "Science"),
    (2, 1, 2, time(10, 0),  time(11, 30), "Science"),
    # Lim — Thu/Fri Room 201
    (3, 2, 3, time(14, 0),  time(15, 30), "English"),
    (3, 2, 4, time(14, 0),  time(15, 30), "English"),
    # Dizon — Mon-Fri Room 201 morning
    (4, 2, 0, time(8, 0),   time(9, 30),  "AP"),
    (4, 2, 1, time(8, 0),   time(9, 30),  "AP"),
    (4, 2, 2, time(8, 0),   time(9, 30),  "AP"),
    (4, 2, 3, time(8, 0),   time(9, 30),  "AP"),
    (4, 2, 4, time(8, 0),   time(9, 30),  "AP"),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_aware_local(dt_naive):
    """Make a naive datetime timezone-aware in the project's local timezone."""
    tz = timezone.get_current_timezone()
    return timezone.make_aware(dt_naive, tz)


def rand_minutes(lo, hi):
    return timedelta(minutes=random.randint(lo, hi))


def build_energy_stats(duration_min):
    """Return plausible avg/max/min watts, total_kwh for a session."""
    avg_w = Decimal(str(round(random.uniform(80, 320), 2)))
    max_w = avg_w + Decimal(str(round(random.uniform(10, 60), 2)))
    min_w = avg_w - Decimal(str(round(random.uniform(5, 40), 2)))
    min_w = max(min_w, Decimal("5.00"))
    # kWh = avg_w * hours
    total_kwh = (avg_w * Decimal(str(duration_min)) / Decimal("60000")).quantize(Decimal("0.0001"))
    reading_count = max(1, int(duration_min * 2))  # ~2 readings/min
    return avg_w, max_w, min_w, total_kwh, reading_count


# ── Step 1: Ensure teachers exist ─────────────────────────────────────────────
print("── Creating teachers ──")
teachers = []
for td in DEMO_TEACHERS:
    user, created = User.objects.get_or_create(
        username=td["username"],
        defaults={
            "first_name": td["first_name"],
            "last_name":  td["last_name"],
            "rfid_uid":   td["rfid_uid"],
            "role":       "teacher",
        },
    )
    if created:
        user.set_password("demo1234")
        user.save()
        print(f"  Created  {user.get_full_name()}")
    else:
        print(f"  Existing {user.get_full_name()}")
    teachers.append(user)

# ── Step 2: Ensure classrooms exist ───────────────────────────────────────────
print("\n── Creating classrooms ──")
classrooms = []
for cd in DEMO_CLASSROOMS:
    room, created = Classroom.objects.get_or_create(
        device_id=cd["device_id"],
        defaults={"name": cd["name"], "device_token": cd["device_token"]},
    )
    if created:
        print(f"  Created  {room.name}")
    else:
        print(f"  Existing {room.name}")
    classrooms.append(room)

# ── Step 3: Ensure schedules exist ────────────────────────────────────────────
print("\n── Creating schedules ──")
schedules_by_def = {}  # index → Schedule object
for i, (ti, ci, dow, st, et, subj) in enumerate(SCHEDULE_DEFS):
    sched, created = Schedule.objects.get_or_create(
        teacher=teachers[ti],
        classroom=classrooms[ci],
        day_of_week=dow,
        start_time=st,
        defaults={"end_time": et, "subject": subj},
    )
    if created:
        print(f"  Created  {sched}")
    else:
        print(f"  Existing {sched}")
    schedules_by_def[i] = sched

# ── Step 4: Build list of weeks to populate ───────────────────────────────────
today = date.today()
# Start from Monday of (WEEKS_BACK) weeks ago; end at end of last week (Sunday)
current_monday = today - timedelta(days=today.weekday())
start_monday   = current_monday - timedelta(weeks=WEEKS_BACK)

weeks = []
for w in range(WEEKS_BACK):
    wm = start_monday + timedelta(weeks=w)
    weeks.append(wm)

print(f"\n── Generating attendance for {WEEKS_BACK} weeks ──")
print(f"   Range: {weeks[0]} → {weeks[-1] + timedelta(days=6)}")

sessions_created   = 0
sessions_skipped   = 0
energy_created     = 0
energy_skipped     = 0

STATUS_OPTIONS = [
    ("MANUAL_OUT",   45),   # most common clean close
    ("AUTO_OUT",     30),
    ("CASCADE_OUT",  15),
    ("INVALID",      10),
]
STATUSES, WEIGHTS = zip(*STATUS_OPTIONS)

for week_monday in weeks:
    week_dates = {i: week_monday + timedelta(days=i) for i in range(7)}

    for def_idx, (ti, ci, dow, sched_start, sched_end, _) in enumerate(SCHEDULE_DEFS):
        target_date = week_dates[dow]

        # Don't generate for the future
        if target_date >= today:
            continue

        # Skip with probability (1 - ATTENDANCE_RATE)
        if random.random() > ATTENDANCE_RATE:
            continue

        teacher   = teachers[ti]
        classroom = classrooms[ci]
        sched_obj = schedules_by_def[def_idx]

        # Skip if session already exists for this combo
        if AttendanceSession.objects.filter(
            teacher=teacher, classroom=classroom, date=target_date
        ).exists():
            sessions_skipped += 1
            continue

        # Build time_in: scheduled start ± 0–15 min late
        time_in_naive = timezone.datetime.combine(
            target_date,
            sched_start,
        ) + rand_minutes(0, 15)

        # Build time_out
        scheduled_duration = (
            timezone.datetime.combine(target_date, sched_end)
            - timezone.datetime.combine(target_date, sched_start)
        )
        # actual duration = scheduled ± up to 20 min
        actual_duration = scheduled_duration + timedelta(minutes=random.randint(-10, 20))
        actual_duration = max(actual_duration, timedelta(minutes=10))

        time_out_naive  = time_in_naive + actual_duration
        expected_out_naive = timezone.datetime.combine(target_date, sched_end)

        time_in_aware       = make_aware_local(time_in_naive)
        time_out_aware      = make_aware_local(time_out_naive)
        expected_out_aware  = make_aware_local(expected_out_naive)

        status = random.choices(STATUSES, weights=WEIGHTS, k=1)[0]

        # Create AttendanceSession
        # time_in is auto_now_add so we must use update() after create
        session = AttendanceSession(
            teacher=teacher,
            classroom=classroom,
            schedule=sched_obj,
            date=target_date,
            time_out=time_out_aware,
            expected_out=expected_out_aware,
            status=status,
            rfid_uid_used=teacher.rfid_uid or f"RFID-{teacher.pk:04d}",
            is_override=False,
        )
        session.save()
        # Override auto_now_add time_in
        AttendanceSession.objects.filter(pk=session.pk).update(time_in=time_in_aware)
        session.refresh_from_db()
        sessions_created += 1

        # Create TeacherEnergyUsage (skipped if already exists)
        if not TeacherEnergyUsage.objects.filter(attendance_session=session).exists():
            dur_min = int(actual_duration.total_seconds() / 60)
            avg_w, max_w, min_w, total_kwh, rc = build_energy_stats(dur_min)

            TeacherEnergyUsage.objects.create(
                teacher=teacher,
                attendance_session=session,
                classroom=classroom,
                start_time=time_in_aware,
                end_time=time_out_aware,
                duration_minutes=dur_min,
                avg_watts=avg_w,
                max_watts=max_w,
                min_watts=min_w,
                total_kwh=total_kwh,
                reading_count=rc,
            )
            energy_created += 1
        else:
            energy_skipped += 1

print(f"\n── Done ──────────────────────────────────────────────────────────")
print(f"   AttendanceSessions  created: {sessions_created:>4}  |  skipped (already exist): {sessions_skipped}")
print(f"   TeacherEnergyUsage  created: {energy_created:>4}  |  skipped (already exist): {energy_skipped}")
print(f"──────────────────────────────────────────────────────────────────")
