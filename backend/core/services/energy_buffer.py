"""
Energy reading buffer service for averaging before DB storage.

Buffers power readings per classroom. When the time window (since first reading)
exceeds ENERGY_SAVE_WINDOW_SECONDS, flushes and returns aggregated values.
Excludes null fields when computing averages.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)

# Per-classroom buffers: {classroom_id: [{"timestamp": datetime, "voltage": float|None, "current": float|None, "watts": float}, ...]}
_buffer: dict[int, list[dict]] = {}
_window_start: dict[int, datetime] = {}


def _get_window_seconds() -> int:
    return getattr(settings, 'ENERGY_SAVE_WINDOW_SECONDS', 60)


def add_reading(
    classroom_id: int,
    voltage: Optional[float],
    current: Optional[float],
    watts: float,
    timestamp: Optional[datetime] = None,
) -> bool:
    """
    Add a power reading to the buffer for the given classroom.

    Returns True if the window is complete and the caller should flush and save.
    """
    from django.utils import timezone

    now = timestamp if timestamp is not None else timezone.now()

    if classroom_id not in _buffer:
        _buffer[classroom_id] = []
        _window_start[classroom_id] = now

    _buffer[classroom_id].append({
        "timestamp": now,
        "voltage": voltage,
        "current": current,
        "watts": watts,
    })

    window_seconds = _get_window_seconds()
    elapsed = (now - _window_start[classroom_id]).total_seconds()
    should_flush = elapsed >= window_seconds

    if should_flush:
        logger.debug(f"[EnergyBuffer] Classroom {classroom_id} window complete after {elapsed:.1f}s")

    return should_flush


def flush_and_aggregate(classroom_id: int) -> Optional[dict]:
    """
    Flush the buffer for the given classroom, compute aggregates, and clear the buffer.

    Averages exclude null values. Timestamp is the midpoint of the window.

    Returns dict with keys: avg_voltage, avg_current, avg_watts, reading_count, timestamp
    or None if buffer is empty.
    """
    from django.utils import timezone

    if classroom_id not in _buffer or not _buffer[classroom_id]:
        return None

    readings = _buffer[classroom_id]
    start_time = _window_start.get(classroom_id)
    window_seconds = _get_window_seconds()

    # Compute averages, excluding nulls
    voltages = [r["voltage"] for r in readings if r["voltage"] is not None]
    currents = [r["current"] for r in readings if r["current"] is not None]
    watts_list = [r["watts"] for r in readings if r["watts"] is not None]

    avg_voltage = sum(voltages) / len(voltages) if voltages else None
    avg_current = sum(currents) / len(currents) if currents else None
    avg_watts = sum(watts_list) / len(watts_list) if watts_list else None

    # Midpoint of the window
    if start_time:
        midpoint = start_time + timedelta(seconds=window_seconds / 2)
    else:
        midpoint = timezone.now()

    agg = {
        "avg_voltage": avg_voltage,
        "avg_current": avg_current,
        "avg_watts": avg_watts,
        "reading_count": len(readings),
        "timestamp": midpoint,
    }

    # Clear buffer so next reading starts a new window
    del _buffer[classroom_id]
    if classroom_id in _window_start:
        del _window_start[classroom_id]

    logger.debug(f"[EnergyBuffer] Flushed classroom {classroom_id}: {len(readings)} readings, avg_watts={avg_watts}")

    return agg
