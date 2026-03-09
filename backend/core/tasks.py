"""
Celery tasks for the attendance system with proper timezone handling.
"""

from celery import shared_task
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import logging

logger = logging.getLogger(__name__)


@shared_task(name='core.tasks.auto_timeout_sessions')
def auto_timeout_sessions():
    """
    Auto-timeout attendance sessions at the configured daily cutoff time.
    When enabled, teachers who forgot to tap out are auto-timed out at the
    configured time (e.g., 10:00 PM). Excess time stops at that moment.
    Run periodically via Celery Beat (e.g., every minute).
    Notifies both dashboard and IoT devices (ESP32) so lights turn off and display updates.
    """
    from core.models import AttendanceSession, SystemConfig
    from core.services.energy_calculation import calculate_teacher_energy_for_session

    config = SystemConfig.load()
    if not config.auto_timeout_enabled:
        return 'Auto-timeout disabled, skipped'

    # Get current time in local timezone
    now_local = timezone.localtime(timezone.now())
    current_time = now_local.time()

    # Only run when current time is at or past the configured cutoff
    if current_time < config.auto_timeout_time:
        return f'Before cutoff time ({config.auto_timeout_time}), skipped'

    # Timeout all sessions still IN (teachers who forgot to tap out)
    sessions_to_timeout = AttendanceSession.objects.filter(
        status='IN'
    ).select_related('teacher', 'classroom')
    
    count = 0
    channel_layer = get_channel_layer()
    
    for session in sessions_to_timeout:
        session.status = 'AUTO_OUT'
        session.time_out = now_local
        session.save()

        # Calculate energy for completed session
        try:
            calculate_teacher_energy_for_session(session)
        except Exception as e:
            logger.error(f"Could not calculate energy for session {session.id}: {e}")

        # Broadcast to dashboard and to IoT (ESP32) so device turns off lights and updates display
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
                # Notify ESP32 so it runs handleTimeoutFinal(): lights off, "Session Ended", etc.
                async_to_sync(channel_layer.group_send)(
                    f'iot_classroom_{session.classroom_id}',
                    {
                        'type': 'timeout_notification',
                        'session_id': session.id,
                        'teacher': session.teacher.get_full_name()
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
