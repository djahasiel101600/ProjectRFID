import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from datetime import datetime, timedelta


class IoTConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for ESP32 devices."""
    
    async def connect(self):
        self.classroom_id = self.scope['url_route']['kwargs']['classroom_id']
        self.room_group_name = f'iot_classroom_{self.classroom_id}'
        
        print(f"[IoT] Connection attempt for classroom {self.classroom_id}")
        
        # Validate device token from query string
        query_string = self.scope.get('query_string', b'').decode()
        print(f"[IoT] Query string: {query_string}")
        
        params = {}
        if query_string:
            for param in query_string.split('&'):
                if '=' in param:
                    key, value = param.split('=', 1)
                    params[key] = value
        
        device_token = params.get('token', '')
        print(f"[IoT] Token received: {device_token}")
        
        # Verify classroom and device token
        is_valid, error_msg = await self.verify_device(device_token)
        print(f"[IoT] Verification result: valid={is_valid}, error={error_msg}")
        
        if not is_valid:
            print(f"[IoT] Rejecting connection: {error_msg}")
            await self.close(code=4003)
            return
        
        # Accept connection first, then join group
        await self.accept()
        print(f"[IoT] Connection accepted for classroom {self.classroom_id}")
        
        # Join room group
        if self.channel_layer:
            await self.channel_layer.group_add(
                self.room_group_name,
                self.channel_name
            )
        
        print(f"[IoT] ESP32 device connected for classroom {self.classroom_id}")
    
    async def disconnect(self, close_code):
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        print(f"ESP32 device disconnected from classroom {self.classroom_id}")
    
    async def receive(self, text_data):
        """Handle incoming data from ESP32 devices."""
        try:
            data = json.loads(text_data)
            device_id = data.get('device_id')
            rfid_uid = data.get('rfid_uid')
            power = data.get('power')
            timestamp_str = data.get('timestamp')
            
            # Parse timestamp from ESP32 or use server time
            # ESP32 sends ISO format with timezone offset (e.g., 2026-01-11T01:30:00+08:00)
            # or empty string if NTP sync failed
            if timestamp_str and timestamp_str.strip():
                try:
                    # Handle both Z suffix (UTC) and offset format (+08:00)
                    if timestamp_str.endswith('Z'):
                        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    else:
                        timestamp = datetime.fromisoformat(timestamp_str)
                except ValueError:
                    print(f"[IoT] Invalid timestamp format: {timestamp_str}, using server time")
                    timestamp = timezone.now()
            else:
                # Use server time if no timestamp provided
                timestamp = timezone.now()
            
            # Process RFID if present
            if rfid_uid:
                result = await self.process_rfid(rfid_uid, timestamp)
                
                # Broadcast attendance event to dashboard
                await self.channel_layer.group_send(
                    f'dashboard_classroom_{self.classroom_id}',
                    {
                        'type': 'attendance_event',
                        'event': result['event'],
                        'data': result['data']
                    }
                )
            
            # Process power reading if present
            if power is not None:
                await self.save_energy_log(power, timestamp)
                
                # Broadcast power update to dashboard
                await self.channel_layer.group_send(
                    f'dashboard_classroom_{self.classroom_id}',
                    {
                        'type': 'power_update',
                        'watts': power,
                        'timestamp': timestamp.isoformat()
                    }
                )
            
            # Send acknowledgment
            await self.send(text_data=json.dumps({
                'status': 'ok',
                'timestamp': timezone.now().isoformat()
            }))
            
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'status': 'error',
                'message': 'Invalid JSON'
            }))
        except Exception as e:
            await self.send(text_data=json.dumps({
                'status': 'error',
                'message': str(e)
            }))
    
    @database_sync_to_async
    def verify_device(self, token):
        """Verify device token for the classroom."""
        from core.models import Classroom
        try:
            classroom = Classroom.objects.get(id=self.classroom_id)
            print(f"[IoT] Found classroom: {classroom.name}, is_active={classroom.is_active}")
            print(f"[IoT] Expected token: '{classroom.device_token}', Received: '{token}'")
            
            if not classroom.is_active:
                return False, "Classroom is not active"
            
            if classroom.device_token != token:
                return False, f"Token mismatch"
            
            return True, None
        except Classroom.DoesNotExist:
            return False, f"Classroom {self.classroom_id} does not exist"
    
    @database_sync_to_async
    def process_rfid(self, rfid_uid, timestamp):
        """Process RFID scan and create attendance record."""
        from core.models import User, Classroom, Schedule, AttendanceSession
        from django.db.models import Q
        
        try:
            # Find teacher by RFID
            teacher = User.objects.get(rfid_uid=rfid_uid, role='teacher', is_active=True)
            classroom = Classroom.objects.get(id=self.classroom_id)
            
            today = timestamp.date()
            current_time = timestamp.time()
            day_of_week = timestamp.weekday()
            
            # Check if there's already an active session for this teacher today
            existing_session = AttendanceSession.objects.filter(
                teacher=teacher,
                classroom=classroom,
                date=today,
                status='IN'
            ).first()
            
            if existing_session:
                return {
                    'event': 'attendance_duplicate',
                    'data': {
                        'teacher': teacher.get_full_name(),
                        'classroom': classroom.name,
                        'message': 'Already timed in'
                    }
                }
            
            # Find matching schedule
            schedule = Schedule.objects.filter(
                teacher=teacher,
                classroom=classroom,
                day_of_week=day_of_week,
                start_time__lte=current_time,
                end_time__gte=current_time
            ).first()
            
            # Also check for schedule starting within 15 minutes
            if not schedule:
                time_threshold = (datetime.combine(today, current_time) + timedelta(minutes=15)).time()
                schedule = Schedule.objects.filter(
                    teacher=teacher,
                    classroom=classroom,
                    day_of_week=day_of_week,
                    start_time__gte=current_time,
                    start_time__lte=time_threshold
                ).first()
            
            # Create attendance session
            if schedule:
                expected_out = datetime.combine(today, schedule.end_time)
                expected_out = timezone.make_aware(expected_out)
                status = 'IN'
            else:
                expected_out = None
                status = 'INVALID'
            
            session = AttendanceSession.objects.create(
                teacher=teacher,
                classroom=classroom,
                schedule=schedule,
                date=today,
                time_in=timestamp,
                expected_out=expected_out,
                status=status,
                rfid_uid_used=rfid_uid
            )
            
            event_type = 'attendance_in' if status == 'IN' else 'attendance_invalid'
            
            return {
                'event': event_type,
                'data': {
                    'session_id': session.id,
                    'teacher': teacher.get_full_name(),
                    'teacher_id': teacher.id,
                    'classroom': classroom.name,
                    'classroom_id': classroom.id,
                    'time': timestamp.strftime('%H:%M'),
                    'expected_out': expected_out.strftime('%H:%M') if expected_out else None,
                    'status': status,
                    'schedule_subject': schedule.subject if schedule else None
                }
            }
            
        except User.DoesNotExist:
            return {
                'event': 'attendance_error',
                'data': {
                    'message': 'Unknown RFID tag',
                    'rfid_uid': rfid_uid
                }
            }
        except Exception as e:
            return {
                'event': 'attendance_error',
                'data': {
                    'message': str(e)
                }
            }
    
    @database_sync_to_async
    def save_energy_log(self, watts, timestamp):
        """Save energy reading to database."""
        from core.models import Classroom, EnergyLog
        
        classroom = Classroom.objects.get(id=self.classroom_id)
        EnergyLog.objects.create(
            classroom=classroom,
            watts=watts,
            timestamp=timestamp
        )


class DashboardConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for frontend dashboard."""
    
    async def connect(self):
        self.classroom_id = self.scope['url_route']['kwargs'].get('classroom_id')
        
        if self.classroom_id:
            self.room_group_name = f'dashboard_classroom_{self.classroom_id}'
        else:
            self.room_group_name = 'dashboard_all'
        
        # Join room group (only if channel layer is available)
        if self.channel_layer is not None:
            await self.channel_layer.group_add(
                self.room_group_name,
                self.channel_name
            )
            
            # If subscribing to all, also join individual classroom groups
            if not self.classroom_id:
                classrooms = await self.get_active_classrooms()
                for classroom_id in classrooms:
                    await self.channel_layer.group_add(
                        f'dashboard_classroom_{classroom_id}',
                        self.channel_name
                    )
        
        await self.accept()
        
        # Send initial data
        try:
            initial_data = await self.get_dashboard_data()
            await self.send(text_data=json.dumps({
                'type': 'initial_data',
                'data': initial_data
            }))
        except Exception as e:
            print(f"Error sending initial data: {e}")
            await self.send(text_data=json.dumps({
                'type': 'initial_data',
                'data': {'classrooms': [], 'stats': {'total_today': 0, 'active': 0, 'completed': 0, 'invalid': 0}}
            }))
    
    async def disconnect(self, close_code):
        if self.channel_layer is not None:
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
    
    async def receive(self, text_data):
        """Handle incoming messages from frontend."""
        try:
            data = json.loads(text_data)
            action = data.get('action')
            
            if action == 'refresh':
                dashboard_data = await self.get_dashboard_data()
                await self.send(text_data=json.dumps({
                    'type': 'initial_data',
                    'data': dashboard_data
                }))
        except json.JSONDecodeError:
            pass
    
    async def attendance_event(self, event):
        """Handle attendance event broadcasts."""
        await self.send(text_data=json.dumps({
            'type': 'attendance',
            'event': event['event'],
            'data': event['data']
        }))
    
    async def power_update(self, event):
        """Handle power update broadcasts."""
        await self.send(text_data=json.dumps({
            'type': 'power',
            'classroom_id': self.classroom_id,
            'watts': event['watts'],
            'timestamp': event['timestamp']
        }))
    
    async def auto_timeout_event(self, event):
        """Handle auto-timeout event broadcasts."""
        await self.send(text_data=json.dumps({
            'type': 'auto_timeout',
            'data': event['data']
        }))
    
    @database_sync_to_async
    def get_active_classrooms(self):
        """Get list of active classroom IDs."""
        from core.models import Classroom
        return list(Classroom.objects.filter(is_active=True).values_list('id', flat=True))
    
    @database_sync_to_async
    def get_dashboard_data(self):
        """Get current dashboard data."""
        from core.models import Classroom, AttendanceSession, EnergyLog
        from core.serializers import UserSerializer
        
        today = timezone.now().date()
        now = timezone.now()
        
        classrooms = Classroom.objects.filter(is_active=True)
        if self.classroom_id:
            classrooms = classrooms.filter(id=self.classroom_id)
        
        classroom_data = []
        for classroom in classrooms:
            # Get current teacher
            current_session = AttendanceSession.objects.filter(
                classroom=classroom,
                status='IN'
            ).select_related('teacher').first()
            
            # Get current power
            latest_energy = EnergyLog.objects.filter(
                classroom=classroom
            ).order_by('-timestamp').first()
            
            # Calculate countdown
            countdown = None
            if current_session and current_session.expected_out:
                remaining = (current_session.expected_out - now).total_seconds()
                countdown = max(0, int(remaining))
            
            classroom_data.append({
                'id': classroom.id,
                'name': classroom.name,
                'current_teacher': {
                    'id': current_session.teacher.id,
                    'name': current_session.teacher.get_full_name()
                } if current_session else None,
                'time_in': current_session.time_in.isoformat() if current_session else None,
                'countdown_seconds': countdown,
                'current_power': float(latest_energy.watts) if latest_energy else None,
                'last_power_update': latest_energy.timestamp.isoformat() if latest_energy else None
            })
        
        # Get today's stats
        today_sessions = AttendanceSession.objects.filter(date=today)
        active_count = AttendanceSession.objects.filter(status='IN').count()
        
        return {
            'classrooms': classroom_data,
            'stats': {
                'total_today': today_sessions.count(),
                'active': active_count,
                'completed': today_sessions.filter(status='AUTO_OUT').count(),
                'invalid': today_sessions.filter(status='INVALID').count()
            }
        }
