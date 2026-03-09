"""
Background tasks for attendance auto-timeout.
Run with: python manage.py auto_timeout_task
Uses SystemConfig: when enabled, times out sessions at the configured cutoff time (e.g., 10 PM).
Can also be run periodically via Celery Beat (core.tasks.auto_timeout_sessions).
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from core.models import AttendanceSession, SystemConfig
from core.services.energy_calculation import calculate_teacher_energy_for_session


class Command(BaseCommand):
    help = 'Auto-timeout attendance sessions at configured cutoff time (e.g., 10 PM)'
    
    def handle(self, *args, **options):
        config = SystemConfig.load()
        if not config.auto_timeout_enabled:
            self.stdout.write(self.style.WARNING('Auto-timeout is disabled in System Settings. Enable it in Admin → System Settings.'))
            return

        now_local = timezone.localtime(timezone.now())
        current_time = now_local.time()
        if current_time < config.auto_timeout_time:
            self.stdout.write(
                self.style.WARNING(f'Current time {current_time} is before cutoff {config.auto_timeout_time}. No sessions timed out.')
            )
            return

        # Find all sessions that should be timed out
        sessions_to_timeout = AttendanceSession.objects.filter(
            status='IN'
        ).select_related('teacher', 'classroom')
        
        count = 0
        energy_count = 0
        channel_layer = get_channel_layer()
        
        for session in sessions_to_timeout:
            session.status = 'AUTO_OUT'
            session.time_out = now_local
            session.save()
            
            # Calculate energy usage for this completed session
            energy_usage = calculate_teacher_energy_for_session(session)
            if energy_usage:
                energy_count += 1
                self.stdout.write(f'Calculated energy for {session.teacher}: {energy_usage.total_kwh} kWh')
            
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
                            'time_out': session.time_out.strftime('%H:%M'),
                            'energy_kwh': float(energy_usage.total_kwh) if energy_usage else None
                        }
                    }
                )
            
            count += 1
            self.stdout.write(f'Auto-timed out: {session.teacher} from {session.classroom}')
        
        self.stdout.write(self.style.SUCCESS(
            f'Successfully processed {count} attendance sessions, calculated energy for {energy_count}'
        ))
