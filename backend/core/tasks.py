"""
Celery tasks for the attendance system.

Contains tasks for auto-timeout functionality:
1. schedule_session_timeout - Scheduled to run at exactly expected_out time
2. auto_timeout_sessions - Fallback periodic task for missed timeouts
"""

from celery import shared_task
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from datetime import datetime


@shared_task(name='core.tasks.timeout_session')
def timeout_session(session_id):
    """
    Timeout a specific attendance session.
    
    This task is scheduled to run at exactly the expected_out time
    when an attendance session is created. This provides real-time
    timeout functionality.
    
    Args:
        session_id: The ID of the AttendanceSession to timeout
    """
    from core.models import AttendanceSession
    
    try:
        session = AttendanceSession.objects.select_related('teacher', 'classroom').get(id=session_id)
        
        # Only timeout if still IN status (might have been manually closed)
        if session.status != 'IN':
            print(f'[Celery] Session {session_id} already has status {session.status}, skipping')
            return f'Session {session_id} already {session.status}'
        
        # Update session
        session.status = 'AUTO_OUT'
        session.time_out = session.expected_out or datetime.now()
        session.save()
        
        print(f'[Celery] Real-time timeout: {session.teacher} from {session.classroom} at {session.time_out}')
        
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
                print(f"[Celery] Error broadcasting auto-timeout: {e}")
        
        return f'Timed out session {session_id}'
        
    except AttendanceSession.DoesNotExist:
        print(f'[Celery] Session {session_id} not found')
        return f'Session {session_id} not found'


def schedule_session_timeout(session):
    """
    Schedule a timeout task to run at the session's expected_out time.
    
    Call this when creating an attendance session with a valid expected_out.
    
    Args:
        session: AttendanceSession instance with expected_out set
    """
    if not session.expected_out:
        print(f'[Celery] No expected_out for session {session.id}, skipping schedule')
        return
    
    # Schedule the task to run at exactly expected_out
    timeout_session.apply_async(
        args=[session.id],
        eta=session.expected_out
    )
    print(f'[Celery] Scheduled timeout for session {session.id} at {session.expected_out}')


@shared_task(name='core.tasks.auto_timeout_sessions')
def auto_timeout_sessions():
    """
    Auto-timeout attendance sessions that have passed their expected end time.
    
    This task:
    1. Finds all sessions with status='IN' where expected_out <= now
    2. Updates their status to 'AUTO_OUT' and sets time_out
    3. Broadcasts the event to connected dashboard clients via WebSocket
    
    Run periodically via Celery Beat (recommended: every 30-60 seconds).
    """
    from core.models import AttendanceSession
    
    # Use naive datetime since USE_TZ=False
    now = datetime.now()
    
    # Find all sessions that should be timed out
    sessions_to_timeout = AttendanceSession.objects.filter(
        status='IN',
        expected_out__lte=now
    ).select_related('teacher', 'classroom')
    
    count = 0
    channel_layer = get_channel_layer()
    
    for session in sessions_to_timeout:
        session.status = 'AUTO_OUT'
        session.time_out = session.expected_out
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
                print(f"[Celery] Error broadcasting auto-timeout: {e}")
        
        count += 1
        print(f'[Celery] Auto-timed out: {session.teacher} from {session.classroom}')
    
    if count > 0:
        print(f'[Celery] Successfully processed {count} attendance sessions')
    
    return f'Processed {count} sessions'


@shared_task(name='core.tasks.cleanup_old_sessions')
def cleanup_old_sessions(days=30):
    """
    Clean up old attendance sessions (optional maintenance task).
    
    This can be scheduled to run daily/weekly to archive or clean old data.
    """
    from core.models import AttendanceSession
    from datetime import timedelta
    
    cutoff_date = datetime.now() - timedelta(days=days)
    
    # For now, just count old sessions (don't delete - can be modified based on requirements)
    old_sessions = AttendanceSession.objects.filter(date__lt=cutoff_date.date())
    count = old_sessions.count()
    
    print(f'[Celery] Found {count} attendance sessions older than {days} days')
    
    return f'Found {count} old sessions'
