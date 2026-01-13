"""
Celery tasks for the attendance system with proper timezone handling.
"""

from celery import shared_task
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from datetime import datetime
from django.conf import settings
import zoneinfo
import logging

logger = logging.getLogger(__name__)

@shared_task(name='core.tasks.timeout_session')
def timeout_session(session_id):
    """
    Timeout a specific attendance session.
    
    This task is scheduled to run at exactly the expected_out time.
    """
    from core.models import AttendanceSession
    
    try:
        session = AttendanceSession.objects.select_related('teacher', 'classroom').get(id=session_id)
        
        if session.status != 'IN':
            logger.info(f'Session {session_id} already has status {session.status}, skipping')
            return f'Session {session_id} already {session.status}'
        
        # Get current time in the correct timezone
        now_local = timezone.localtime(timezone.now())
        
        # Update session
        session.status = 'AUTO_OUT'
        session.time_out = now_local  # Use current local time for actual timeout
        session.save()
        
        logger.info(f'Real-time timeout: {session.teacher} from {session.classroom} at {session.time_out}')
        
        # Broadcast to dashboard
        channel_layer = get_channel_layer()
        if channel_layer:
            try:
                async_to_sync(channel_layer.group_send)(
                    f'dashboard_classroom_{session.classroom_id}',
                    {
                        'type': 'auto_timeout_event',
                        'data': {
                            'session_id': session.id,
                            'teacher': session.teacher.get_full_name(),
                            'teacher_id': session.teacher_id,
                            'classroom': session.classroom.name,
                            'classroom_id': session.classroom_id,
                            'time_out': session.time_out.strftime('%H:%M')
                        }
                    }
                )
            except Exception as e:
                logger.error(f"Error broadcasting auto-timeout: {e}")
        
        return f'Timed out session {session_id}'
        
    except AttendanceSession.DoesNotExist:
        logger.warning(f'Session {session_id} not found')
        return f'Session {session_id} not found'


def schedule_session_timeout(session):
    """
    Schedule a timeout task to run at the session's expected_out time.
    """
    if not session.expected_out:
        logger.info(f'No expected_out for session {session.id}, skipping schedule')
        return
    
    # Get timezone from settings
    tz_name = getattr(settings, 'CELERY_TIMEZONE', None) or getattr(settings, 'TIME_ZONE', 'UTC')
    tz = zoneinfo.ZoneInfo(tz_name)
    
    # Ensure expected_out is timezone-aware
    expected_out = session.expected_out
    
    # If naive datetime, assume it's in the local timezone
    if expected_out.tzinfo is None:
        expected_out = expected_out.replace(tzinfo=tz)
    
    # Convert to UTC for Celery (Celery stores all ETA times in UTC)
    eta_utc = expected_out.astimezone(zoneinfo.ZoneInfo('UTC'))
    
    # Schedule the task
    timeout_session.apply_async(
        args=[session.id],
        eta=eta_utc
    )
    
    logger.info(f'Scheduled timeout for session {session.id} at {expected_out} (UTC: {eta_utc})')


@shared_task(name='core.tasks.auto_timeout_sessions')
def auto_timeout_sessions():
    """
    Auto-timeout attendance sessions that have passed their expected end time.
    Run periodically via Celery Beat (recommended: every 30-60 seconds).
    """
    from core.models import AttendanceSession
    
    # Get current time in local timezone
    now_local = timezone.localtime(timezone.now())
    
    # Find all sessions that should be timed out
    # Compare with local time since expected_out should be in local timezone
    sessions_to_timeout = AttendanceSession.objects.filter(
        status='IN',
        expected_out__lte=now_local
    ).select_related('teacher', 'classroom')
    
    count = 0
    channel_layer = get_channel_layer()
    
    for session in sessions_to_timeout:
        session.status = 'AUTO_OUT'
        session.time_out = now_local  # Use current time for timeout
        session.save()
        
        # Broadcast auto-timeout event to dashboard
        if channel_layer:
            try:
                async_to_sync(channel_layer.group_send)(
                    f'dashboard_classroom_{session.classroom_id}',
                    {
                        'type': 'auto_timeout_event',
                        'data': {
                            'session_id': session.id,
                            'teacher': session.teacher.get_full_name(),
                            'teacher_id': session.teacher_id,
                            'classroom': session.classroom.name,
                            'classroom_id': session.classroom_id,
                            'time_out': session.time_out.strftime('%H:%M')
                        }
                    }
                )
            except Exception as e:
                logger.error(f"Error broadcasting auto-timeout: {e}")
        
        count += 1
        logger.info(f'Auto-timed out: {session.teacher} from {session.classroom}')
    
    if count > 0:
        logger.info(f'Successfully processed {count} attendance sessions')
    
    return f'Processed {count} sessions'


@shared_task(name='core.tasks.cleanup_old_sessions')
def cleanup_old_sessions(days=30):
    """
    Clean up old attendance sessions (optional maintenance task).
    """
    from core.models import AttendanceSession
    from datetime import timedelta
    
    cutoff_date = timezone.localtime(timezone.now()) - timedelta(days=days)
    
    # For now, just count old sessions
    old_sessions = AttendanceSession.objects.filter(date__lt=cutoff_date.date())
    count = old_sessions.count()
    
    logger.info(f'Found {count} attendance sessions older than {days} days')
    
    return f'Found {count} old sessions'