"""
Background tasks for attendance auto-timeout.
Run with: python manage.py auto_timeout_task
Or set up with Celery Beat for periodic execution.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from core.models import AttendanceSession


class Command(BaseCommand):
    help = 'Auto-timeout attendance sessions that have passed their expected end time'
    
    def handle(self, *args, **options):
        now = timezone.now()
        
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
            
            # Broadcast auto-timeout event
            if channel_layer:
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
            
            count += 1
            self.stdout.write(f'Auto-timed out: {session.teacher} from {session.classroom}')
        
        self.stdout.write(self.style.SUCCESS(f'Successfully processed {count} attendance sessions'))
