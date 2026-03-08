"""
Service for calculating teacher energy usage based on attendance sessions.
Includes robust database handling for SQLite concurrency issues.
"""

import time
import logging
from functools import wraps
from django.db import transaction, OperationalError
from django.db.models import Avg, Max, Min, Count, Sum
from core.models import AttendanceSession, EnergyLog, TeacherEnergyUsage

logger = logging.getLogger(__name__)

# Configuration for retry logic
MAX_RETRIES = 5
RETRY_DELAY_BASE = 0.1  # Base delay in seconds
RETRY_DELAY_MAX = 2.0   # Maximum delay in seconds


def with_database_retry(max_retries=MAX_RETRIES, delay_base=RETRY_DELAY_BASE):
    """
    Decorator that retries database operations on OperationalError (database locked).
    Uses exponential backoff with jitter.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except OperationalError as e:
                    last_exception = e
                    if 'database is locked' in str(e).lower():
                        # Calculate delay with exponential backoff
                        delay = min(delay_base * (2 ** attempt), RETRY_DELAY_MAX)
                        # Add some jitter to prevent thundering herd
                        import random
                        delay += random.uniform(0, delay * 0.1)
                        logger.warning(
                            f"Database locked on attempt {attempt + 1}/{max_retries}, "
                            f"retrying in {delay:.2f}s: {func.__name__}"
                        )
                        time.sleep(delay)
                    else:
                        raise
            logger.error(f"Max retries ({max_retries}) exceeded for {func.__name__}")
            raise last_exception
        return wrapper
    return decorator


@with_database_retry()
def calculate_teacher_energy_for_session(session: AttendanceSession) -> TeacherEnergyUsage | None:
    """
    Calculate energy consumption for a completed attendance session.
    Only works for sessions with time_out (MANUAL_OUT, CASCADE_OUT, or AUTO_OUT status).
    
    Args:
        session: The completed AttendanceSession instance
        
    Returns:
        TeacherEnergyUsage instance or None if calculation not possible
    """
    if not session.time_out or session.status not in ['AUTO_OUT', 'MANUAL_OUT', 'CASCADE_OUT']:
        return None
    
    # Get energy logs during the session period (read-only, no lock needed)
    energy_logs = EnergyLog.objects.filter(
        classroom=session.classroom,
        timestamp__gte=session.time_in,
        timestamp__lte=session.time_out
    )
    
    if not energy_logs.exists():
        return None
    
    # Calculate aggregates (read-only operation)
    stats = energy_logs.aggregate(
        avg_watts=Avg('watts'),
        max_watts=Max('watts'),
        min_watts=Min('watts'),
        reading_count=Count('id')
    )
    
    # Calculate duration and kWh
    duration = session.time_out - session.time_in
    duration_minutes = int(duration.total_seconds() / 60)
    hours = duration.total_seconds() / 3600
    
    # Calculate total energy consumption in kWh
    # kWh = (average watts * hours) / 1000
    total_kwh = (float(stats['avg_watts']) * hours) / 1000
    
    # Use atomic transaction with IMMEDIATE mode for write operation
    with transaction.atomic():
        usage, created = TeacherEnergyUsage.objects.update_or_create(
            attendance_session=session,
            defaults={
                'teacher': session.teacher,
                'classroom': session.classroom,
                'start_time': session.time_in,
                'end_time': session.time_out,
                'duration_minutes': duration_minutes,
                'avg_watts': stats['avg_watts'],
                'max_watts': stats['max_watts'],
                'min_watts': stats['min_watts'],
                'total_kwh': round(total_kwh, 4),
                'reading_count': stats['reading_count']
            }
        )
    
    return usage


def calculate_teacher_energy_summary(teacher_id: int, start_date=None, end_date=None) -> dict:
    """
    Get aggregated energy usage summary for a specific teacher.
    
    Args:
        teacher_id: The teacher's user ID
        start_date: Optional start date filter
        end_date: Optional end date filter
        
    Returns:
        Dictionary with aggregated energy statistics
    """
    queryset = TeacherEnergyUsage.objects.filter(teacher_id=teacher_id)
    
    if start_date:
        queryset = queryset.filter(start_time__gte=start_date)
    if end_date:
        queryset = queryset.filter(end_time__lte=end_date)
    
    return queryset.aggregate(
        total_kwh=Sum('total_kwh'),
        total_minutes=Sum('duration_minutes'),
        avg_watts=Avg('avg_watts'),
        session_count=Count('id')
    )


def recalculate_all_teacher_energy(batch_size=10, delay_between_batches=0.5):
    """
    Recalculate energy usage for all completed attendance sessions.
    Processes in batches with delays to avoid database locking issues.
    
    Args:
        batch_size: Number of sessions to process per batch
        delay_between_batches: Seconds to wait between batches
        
    Returns:
        Dictionary with success/error counts and details
    """
    # Get all session IDs that need processing (read-only)
    session_ids = list(
        AttendanceSession.objects.filter(
            status__in=['AUTO_OUT', 'MANUAL_OUT', 'CASCADE_OUT'],
            time_out__isnull=False
        ).values_list('id', flat=True)
    )
    
    total = len(session_ids)
    success_count = 0
    error_count = 0
    skipped_count = 0
    errors = []
    
    logger.info(f"Starting recalculation for {total} sessions in batches of {batch_size}")
    
    # Process in batches
    for i in range(0, total, batch_size):
        batch_ids = session_ids[i:i + batch_size]
        
        for session_id in batch_ids:
            try:
                # Fetch session fresh to avoid stale data
                session = AttendanceSession.objects.select_related(
                    'teacher', 'classroom'
                ).get(id=session_id)
                
                result = calculate_teacher_energy_for_session(session)
                
                if result:
                    success_count += 1
                else:
                    skipped_count += 1
                    
            except AttendanceSession.DoesNotExist:
                skipped_count += 1
            except Exception as e:
                error_count += 1
                error_msg = f"Session {session_id}: {str(e)}"
                errors.append(error_msg)
                logger.error(f"Error processing session {session_id}: {e}")
        
        # Log progress
        processed = min(i + batch_size, total)
        logger.info(f"Processed {processed}/{total} sessions ({success_count} success, {error_count} errors)")
        
        # Delay between batches to allow other operations
        if i + batch_size < total:
            time.sleep(delay_between_batches)
    
    result = {
        'total': total,
        'success': success_count,
        'skipped': skipped_count,
        'errors': error_count,
        'error_details': errors[:10]  # Limit error details to first 10
    }
    
    logger.info(f"Recalculation complete: {result}")
    return result


@with_database_retry(max_retries=3)
def calculate_single_session_safe(session_id: int) -> dict:
    """
    Safely calculate energy for a single session by ID.
    Returns a result dict instead of raising exceptions.
    
    Args:
        session_id: The attendance session ID
        
    Returns:
        Dictionary with status and result/error
    """
    try:
        session = AttendanceSession.objects.select_related(
            'teacher', 'classroom'
        ).get(id=session_id)
        
        result = calculate_teacher_energy_for_session(session)
        
        if result:
            return {
                'status': 'success',
                'session_id': session_id,
                'kwh': float(result.total_kwh)
            }
        else:
            return {
                'status': 'skipped',
                'session_id': session_id,
                'reason': 'No energy logs found or session not complete'
            }
            
    except AttendanceSession.DoesNotExist:
        return {
            'status': 'error',
            'session_id': session_id,
            'error': 'Session not found'
        }
    except Exception as e:
        return {
            'status': 'error',
            'session_id': session_id,
            'error': str(e)
        }
    """
    Recalculate energy usage for all completed attendance sessions.
    Useful for backfilling data or after schema changes.
    """
    sessions = AttendanceSession.objects.filter(
        status__in=['AUTO_OUT', 'MANUAL_OUT', 'CASCADE_OUT'],
        time_out__isnull=False
    ).select_related('teacher', 'classroom')
    
    count = 0
    for session in sessions:
        result = calculate_teacher_energy_for_session(session)
        if result:
            count += 1
    
    return count
