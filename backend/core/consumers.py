import json
from asgiref.sync import async_to_sync
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from datetime import datetime, timedelta


class IoTConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for ESP32 devices."""
    
    async def connect(self):
        # Convert classroom_id to int for consistent handling
        self.classroom_id = int(self.scope['url_route']['kwargs']['classroom_id'])
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
        
        # Send calibration config on connect (if exists)
        cal_payload = await self.get_calibration_payload()
        if cal_payload:
            await self.send(text_data=json.dumps({
                'type': 'calibration_config',
                'calibration': cal_payload
            }))
        
        print(f"[IoT] ESP32 device connected for classroom {self.classroom_id}")
    
    async def disconnect(self, close_code):
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        print(f"ESP32 device disconnected from classroom {self.classroom_id}")
    
    async def start_scan_command(self, event):
        """Send scan command to ESP32 device."""
        print(f"[IoT] Sending start_scan command to ESP32 classroom {self.classroom_id}")
        await self.send(text_data=json.dumps({
            'type': 'start_scan',
            'classroom_id': event.get('classroom_id')
        }))
    
    async def timeout_warning(self, event):
        """Send 5-minute warning to ESP32 device."""
        print(f"[IoT] Sending timeout warning to ESP32 classroom {self.classroom_id}")
        await self.send(text_data=json.dumps({
            'type': 'timeout_warning',
            'session_id': event.get('session_id'),
            'teacher': event.get('teacher'),
            'minutes_remaining': event.get('minutes_remaining', 5)
        }))
    
    async def timeout_notification(self, event):
        """Send final timeout notification to ESP32 device."""
        print(f"[IoT] Sending timeout notification to ESP32 classroom {self.classroom_id}")
        await self.send(text_data=json.dumps({
            'type': 'timeout_final',
            'session_id': event.get('session_id'),
            'teacher': event.get('teacher')
        }))

    async def calibration_config(self, event):
        """Push calibration config to ESP32."""
        cal = event.get('calibration', {})
        if cal:
            print(f"[IoT] Sending calibration_config to classroom {self.classroom_id}")
            await self.send(text_data=json.dumps({
                'type': 'calibration_config',
                'calibration': cal
            }))

    async def calibrate_command(self, event):
        """Send calibrate_now command to ESP32."""
        print(f"[IoT] Sending calibrate_now to classroom {self.classroom_id}")
        await self.send(text_data=json.dumps({'type': 'calibrate_now'}))
    
    async def receive(self, text_data):
        """Handle incoming data from ESP32 devices."""
        # Keepalive: accept raw "ping" or {"type":"ping"} so connection is not closed on invalid JSON
        text_stripped = text_data.strip() if text_data else ""
        if text_stripped == "ping":
            await self.send(text_data=json.dumps({'status': 'ok', 'message': 'pong'}))
            return

        try:
            data = json.loads(text_data)
            msg_type = data.get('type')
            if msg_type != 'ping':
                print(f"[IoT] Raw data received: {data}")  # DEBUG

            if msg_type == 'ping':
                await self.send(text_data=json.dumps({'status': 'ok', 'message': 'pong'}))
                return

            # Handle scan mode messages
            if msg_type == 'scan_result':
                rfid_uid = data.get('rfid_uid')
                print(f"[IoT] Scan result received: {rfid_uid}")
                
                # Broadcast to admin channel
                await self.channel_layer.group_send(
                    'admin_rfid_scan',
                    {
                        'type': 'rfid_scan_result',
                        'rfid_uid': rfid_uid,
                        'classroom_id': self.classroom_id
                    }
                )
                
                await self.send(text_data=json.dumps({
                    'status': 'ok',
                    'message': 'Scan result received'
                }))
                return
                
            elif msg_type == 'scan_timeout':
                print(f"[IoT] Scan timeout for classroom {self.classroom_id}")
                
                # Broadcast timeout to admin channel
                await self.channel_layer.group_send(
                    'admin_rfid_scan',
                    {
                        'type': 'rfid_scan_timeout',
                        'classroom_id': self.classroom_id
                    }
                )
                
                await self.send(text_data=json.dumps({
                    'status': 'ok',
                    'message': 'Scan timeout acknowledged'
                }))
                return

            elif msg_type == 'calibration_result':
                quiescent = data.get('quiescent_voltage')
                if quiescent is not None:
                    await self.save_calibration_quiescent(quiescent)
                    await self.send(text_data=json.dumps({'status': 'ok', 'message': 'Calibration saved'}))
                else:
                    await self.send(text_data=json.dumps({'status': 'ok', 'message': 'No quiescent_voltage in result, nothing to save'}))
                return
            
            # Normal processing for attendance/power data
            device_id = data.get('device_id')
            rfid_uid = data.get('rfid_uid')
            power = data.get('power')
            voltage = data.get('voltage')
            current = data.get('current')
            print(f"[IoT] Extracted - power: {power}, voltage: {voltage}, current: {current}")  # DEBUG
            timestamp_str = data.get('timestamp')
            
            # Parse timestamp from ESP32 or use server time
            # ESP32 sends ISO format with timezone offset (e.g., 2026-01-11T01:30:00+08:00)
            # or empty string if NTP sync failed
            # Since USE_TZ=False, we need naive datetimes (no timezone info)
            if timestamp_str and timestamp_str.strip():
                try:
                    # Handle both Z suffix (UTC) and offset format (+08:00)
                    if timestamp_str.endswith('Z'):
                        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    else:
                        timestamp = datetime.fromisoformat(timestamp_str)
                    # Convert to naive datetime by removing timezone info
                    # The timestamp is already in local time (Asia/Manila), just strip tzinfo
                    if timestamp.tzinfo is not None:
                        timestamp = timestamp.replace(tzinfo=None)
                except ValueError:
                    print(f"[IoT] Invalid timestamp format: {timestamp_str}, using server time")
                    timestamp = timezone.now()
            else:
                # Use server time if no timestamp provided
                timestamp = timezone.now()
            
            # Process RFID if present (server time is used internally)
            if rfid_uid:
                result = await self.process_rfid(rfid_uid)
                # Send response back to ESP32
                await self.send(text_data=json.dumps({
                    'event': result['event'],
                    'data': result['data']
                }))
                print(f"[IoT] Sent response to ESP32: {result['event']}")
                # Broadcast attendance event to dashboard (skip for maintenance - no attendance impact)
                if result['event'] not in ('maintenance_toggle', 'maintenance_blocked'):
                    await self.channel_layer.group_send(
                        f'dashboard_classroom_{self.classroom_id}',
                        {
                            'type': 'attendance_event',
                            'classroom_id': self.classroom_id,
                            'event': result['event'],
                            'data': result['data']
                        }
                    )
            
            # Process power reading if present
            if power is not None:
                # 1. Always broadcast to dashboard (real-time)
                await self.channel_layer.group_send(
                    f'dashboard_classroom_{self.classroom_id}',
                    {
                        'type': 'power_update',
                        'classroom_id': self.classroom_id,
                        'voltage': voltage,
                        'current': current,
                        'watts': power,
                        'timestamp': timezone.now().isoformat()
                    }
                )
                # 2. Add to buffer; save aggregated row when window completes
                from core.services.energy_buffer import add_reading, flush_and_aggregate
                should_flush = add_reading(self.classroom_id, voltage, current, power, timestamp)
                if should_flush:
                    agg = flush_and_aggregate(self.classroom_id)
                    if agg and agg.get('avg_watts') is not None:
                        await self.save_energy_log_aggregated(agg)
            
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
    def save_calibration_quiescent(self, quiescent_voltage):
        """Save quiescent_voltage from ESP32 calibrate_now result."""
        from core.models import ClassroomCalibration
        cal, _ = ClassroomCalibration.objects.get_or_create(
            classroom_id=self.classroom_id,
            defaults={'voltage_sensitivity': 483.5, 'current_sensitivity': 0.04,
                      'nominal_voltage': 230.0, 'add_ampere': 0.0}
        )
        cal.quiescent_voltage = float(quiescent_voltage)
        cal.save()
        print(f"[IoT] Saved quiescent_voltage={quiescent_voltage} for classroom {self.classroom_id}")

    @database_sync_to_async
    def get_calibration_payload(self):
        """Load calibration for this classroom, return dict or None."""
        from core.models import ClassroomCalibration
        try:
            cal = ClassroomCalibration.objects.get(classroom_id=self.classroom_id)
            return cal.to_esp32_payload()
        except ClassroomCalibration.DoesNotExist:
            return None

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
    def process_rfid(self, rfid_uid):
        """Process RFID scan and create attendance record.
        
        Uses server time for all timestamps - server is the single source of truth.
        Card types (checked in order):
        1. Maintenance RFID - control lights only, no attendance. Blocked when teacher IN.
        2. Normal/Override RFID - teacher attendance.
        """
        from core.models import User, Classroom, Schedule, AttendanceSession, OverrideRFID, MaintenanceRFID
        
        try:
            # 1. Check maintenance card first (staff - lights only, no attendance)
            maintenance_card = MaintenanceRFID.objects.filter(
                rfid_uid=rfid_uid, is_active=True
            ).first()
            if maintenance_card:
                classroom = Classroom.objects.get(id=self.classroom_id)
                today = datetime.now().date()
                active_session = AttendanceSession.objects.filter(
                    classroom=classroom,
                    date=today,
                    status='IN'
                ).exists()
                if active_session:
                    return {
                        'event': 'maintenance_blocked',
                        'data': {'message': 'Teacher present'}
                    }
                return {
                    'event': 'maintenance_toggle',
                    'data': {'message': 'Toggle relay'}
                }
            
            # 2. Find teacher: first by normal RFID, then by override RFID card
            teacher = None
            is_override_mode = False
            try:
                teacher = User.objects.get(rfid_uid=rfid_uid, role='teacher', is_active=True)
            except User.DoesNotExist:
                override_card = OverrideRFID.objects.filter(
                    rfid_uid=rfid_uid, is_active=True
                ).select_related('teacher').first()
                if override_card:
                    teacher = override_card.teacher
                    is_override_mode = True
            
            if not teacher:
                return {
                    'event': 'attendance_error',
                    'data': {
                        'message': 'Unknown RFID tag',
                        'rfid_uid': rfid_uid
                    }
                }
            
            classroom = Classroom.objects.get(id=self.classroom_id)
            
            # Use server time - single source of truth
            now = datetime.now()
            today = now.date()
            current_time = now.time()
            day_of_week = now.weekday()
            
            # DEBUG: Print current context
            print(f"\n{'='*60}")
            print(f"[RFID DEBUG] Processing RFID scan")
            print(f"[RFID DEBUG] Teacher: {teacher.get_full_name()} (ID: {teacher.id})")
            print(f"[RFID DEBUG] Classroom: {classroom.name} (ID: {classroom.id})")
            print(f"[RFID DEBUG] Server Time: {now.strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"[RFID DEBUG] Day of Week: {day_of_week} (0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun)")
            print(f"[RFID DEBUG] Current Time: {current_time}")
            print(f"{'='*60}")
            
            # DEBUG: List all schedules for this teacher
            all_teacher_schedules = Schedule.objects.filter(teacher=teacher)
            print(f"[RFID DEBUG] All schedules for {teacher.get_full_name()}:")
            for s in all_teacher_schedules:
                print(f"  - Classroom: {s.classroom.name} (ID: {s.classroom.id}), Day: {s.day_of_week}, Time: {s.start_time} - {s.end_time}")
            
            # Check if there's already an active session for this teacher today
            existing_session = AttendanceSession.objects.filter(
                teacher=teacher,
                classroom=classroom,
                date=today,
                status='IN'
            ).first()
            
            if existing_session:
                # Teacher is checking out manually
                print(f"[RFID DEBUG] MANUAL CHECK-OUT: Teacher checking out from session (ID: {existing_session.id})")
                existing_session.time_out = now
                existing_session.status = 'MANUAL_OUT'
                existing_session.save()
                
                # Calculate energy for completed session
                try:
                    from core.services.energy_calculation import calculate_teacher_energy_for_session
                    calculate_teacher_energy_for_session(existing_session)
                except Exception as e:
                    print(f"[RFID] Warning: Could not calculate energy for session: {e}")
                
                print(f"[RFID DEBUG] Session updated - time_out: {existing_session.time_out}, status: MANUAL_OUT")
                print(f"{'='*60}\n")
                
                return {
                    'event': 'attendance_out',
                    'data': {
                        'session_id': existing_session.id,
                        'teacher': teacher.get_full_name(),
                        'teacher_id': teacher.id,
                        'classroom': classroom.name,
                        'classroom_id': classroom.id,
                        'time_in': existing_session.time_in.strftime('%H:%M'),
                        'time_out': existing_session.time_out.strftime('%H:%M'),
                        'status': 'MANUAL_OUT',
                        'message': 'Checked out successfully'
                    }
                }
            
            # Find matching schedule - currently during class time
            print(f"\n[RFID DEBUG] Checking for schedule during class time:")
            print(f"[RFID DEBUG] Query: teacher={teacher.id}, classroom={classroom.id}, day={day_of_week}")
            print(f"[RFID DEBUG] Query: start_time <= {current_time} AND end_time >= {current_time}")
            
            schedule = Schedule.objects.filter(
                teacher=teacher,
                classroom=classroom,
                day_of_week=day_of_week,
                start_time__lte=current_time,
                end_time__gte=current_time
            ).first()
            
            if schedule:
                print(f"[RFID DEBUG] FOUND schedule (during class): {schedule.start_time} - {schedule.end_time}")
            else:
                print(f"[RFID DEBUG] No schedule found during class time")
            
            # Also check for schedule starting within 15 minutes
            if not schedule:
                time_threshold = (datetime.combine(today, current_time) + timedelta(minutes=15)).time()
                print(f"\n[RFID DEBUG] Checking for schedule starting within 15 minutes:")
                print(f"[RFID DEBUG] Query: start_time >= {current_time} AND start_time <= {time_threshold}")
                
                schedule = Schedule.objects.filter(
                    teacher=teacher,
                    classroom=classroom,
                    day_of_week=day_of_week,
                    start_time__gte=current_time,
                    start_time__lte=time_threshold
                ).first()
                
                if schedule:
                    print(f"[RFID DEBUG] FOUND schedule (within 15 min): {schedule.start_time} - {schedule.end_time}")
                else:
                    print(f"[RFID DEBUG] No schedule found within 15 minutes")
                    
                    # DEBUG: Check what schedules exist for this classroom today
                    today_schedules = Schedule.objects.filter(
                        teacher=teacher,
                        classroom=classroom,
                        day_of_week=day_of_week
                    )
                    print(f"\n[RFID DEBUG] All schedules for this teacher in this classroom TODAY (day={day_of_week}):")
                    if today_schedules.exists():
                        for s in today_schedules:
                            match_start = s.start_time <= current_time
                            match_end = s.end_time >= current_time
                            within_15 = current_time <= s.start_time <= time_threshold
                            print(f"  - {s.start_time} - {s.end_time}")
                            print(f"    start_time({s.start_time}) <= current({current_time}): {match_start}")
                            print(f"    end_time({s.end_time}) >= current({current_time}): {match_end}")
                            print(f"    Within 15 min window ({current_time} to {time_threshold}): {within_15}")
                    else:
                        print(f"  (No schedules found for today)")
            
            # Override mode: if no matching schedule, look for vacant slot (another teacher's slot with no one timed in)
            if not schedule and is_override_mode:
                print(f"\n[RFID DEBUG] Override mode: checking for vacant slots in classroom {classroom.name}")
                time_threshold = (datetime.combine(today, current_time) + timedelta(minutes=15)).time()
                # Vacant = schedule in this classroom today, current time during slot or within 15 min of start,
                # and no active session for that schedule today
                candidate_schedules = Schedule.objects.filter(
                    classroom=classroom,
                    day_of_week=day_of_week,
                    start_time__lte=time_threshold,
                    end_time__gte=current_time
                ).order_by('start_time')
                for cand in candidate_schedules:
                    # Check if slot is vacant: no one has timed in for this schedule today
                    occupied = AttendanceSession.objects.filter(
                        schedule=cand,
                        date=today,
                        status='IN'
                    ).exists()
                    if not occupied:
                        schedule = cand
                        print(f"[RFID DEBUG] FOUND vacant slot: {schedule.start_time} - {schedule.end_time} (was: {schedule.teacher.get_full_name()})")
                        break
                if not schedule:
                    print(f"[RFID DEBUG] No vacant slot found")
                
                # Override early takeover: another teacher is IN, tap in early for own next schedule
                if not schedule and is_override_mode:
                    other_in = AttendanceSession.objects.filter(
                        classroom=classroom,
                        date=today,
                        status='IN'
                    ).exclude(teacher=teacher).exists()
                    if other_in:
                        next_schedule = Schedule.objects.filter(
                            teacher=teacher,
                            classroom=classroom,
                            day_of_week=day_of_week,
                            start_time__gt=current_time
                        ).order_by('start_time').first()
                        if next_schedule:
                            schedule = next_schedule
                            print(f"[RFID DEBUG] Early takeover: using next schedule {schedule.start_time} - {schedule.end_time}")
            
            # Cascade: before creating session, check out any other teacher IN in this classroom
            if schedule:
                other_sessions = list(AttendanceSession.objects.filter(
                    classroom=classroom,
                    date=today,
                    status='IN'
                ).exclude(teacher=teacher).select_related('teacher'))
                for sess in other_sessions:
                    sess.time_out = now
                    sess.status = 'CASCADE_OUT'
                    sess.save()
                    print(f"[RFID DEBUG] CASCADE_OUT: {sess.teacher.get_full_name()} (session {sess.id})")
                    try:
                        from core.services.energy_calculation import calculate_teacher_energy_for_session
                        calculate_teacher_energy_for_session(sess)
                    except Exception as e:
                        print(f"[RFID] Warning: Could not calculate energy for cascaded session: {e}")
                    # Broadcast cascade to dashboard (not to ESP32 - lights stay on, next teacher gets attendance_in)
                    channel_layer = getattr(self, 'channel_layer', None)
                    if channel_layer:
                        try:
                            async_to_sync(channel_layer.group_send)(
                                f'dashboard_classroom_{self.classroom_id}',
                                {
                                    'type': 'attendance_event',
                                    'classroom_id': self.classroom_id,
                                    'event': 'attendance_out',
                                    'data': {
                                        'session_id': sess.id,
                                        'teacher': sess.teacher.get_full_name(),
                                        'teacher_id': sess.teacher_id,
                                        'classroom': classroom.name,
                                        'classroom_id': classroom.id,
                                        'time_in': sess.time_in.strftime('%H:%M'),
                                        'time_out': sess.time_out.strftime('%H:%M'),
                                        'status': 'CASCADE_OUT',
                                        'message': 'Checked out (next teacher arrived)'
                                    }
                                }
                            )
                        except Exception as e:
                            print(f"[RFID] Warning: Could not broadcast cascade: {e}")
            
            # Create attendance session
            if schedule:
                # Use naive datetime since USE_TZ=False
                expected_out = datetime.combine(today, schedule.end_time)
                status = 'IN'
                session_is_override = is_override_mode
                print(f"\n[RFID DEBUG] RESULT: VALID - Creating session with status IN (override={session_is_override})")
            else:
                expected_out = None
                status = 'INVALID'
                session_is_override = False
                print(f"\n[RFID DEBUG] RESULT: INVALID - No matching schedule found")
            
            print(f"{'='*60}\n")
            
            session = AttendanceSession.objects.create(
                teacher=teacher,
                classroom=classroom,
                schedule=schedule,
                date=today,
                expected_out=expected_out,
                status=status,
                rfid_uid_used=rfid_uid,
                is_override=session_is_override
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
                    'time': session.time_in.strftime('%H:%M'),  # Use session's auto-set time
                    'expected_out': expected_out.strftime('%H:%M') if expected_out else None,
                    'status': status,
                    'schedule_subject': schedule.subject if schedule else None
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
    def save_energy_log_aggregated(self, agg: dict):
        """Save aggregated energy reading from buffer flush. Timestamp = window midpoint."""
        from core.models import Classroom, EnergyLog
        
        classroom = Classroom.objects.get(id=self.classroom_id)
        EnergyLog.objects.create(
            classroom=classroom,
            voltage=agg.get('avg_voltage'),
            current=agg.get('avg_current'),
            watts=agg['avg_watts'],
            timestamp=agg['timestamp']
        )


class DashboardConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for frontend dashboard."""
    
    async def connect(self):
        # Convert classroom_id to int for consistent handling (or None if not provided)
        classroom_id_str = self.scope['url_route']['kwargs'].get('classroom_id')
        self.classroom_id = int(classroom_id_str) if classroom_id_str else None
        
        if self.classroom_id:
            self.room_group_name = f'dashboard_classroom_{self.classroom_id}'
        else:
            self.room_group_name = 'dashboard_all'
        
        print(f"[Dashboard] Connecting to group: {self.room_group_name}")
        
        # Join room group (only if channel layer is available)
        if self.channel_layer is not None:
            await self.channel_layer.group_add(
                self.room_group_name,
                self.channel_name
            )
            
            # If subscribing to all, also join individual classroom groups
            if not self.classroom_id:
                classrooms = await self.get_active_classrooms()
                print(f"[Dashboard] Joining classroom groups: {classrooms}")
                for classroom_id in classrooms:
                    await self.channel_layer.group_add(
                        f'dashboard_classroom_{classroom_id}',
                        self.channel_name
                    )
        
        await self.accept()
        print(f"[Dashboard] Connection accepted")
        
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
        print(f"[Dashboard] Received attendance event: {event}")
        await self.send(text_data=json.dumps({
            'type': 'attendance',
            'classroom_id': event.get('classroom_id'),
            'event': event['event'],
            'data': event['data']
        }))
    
    async def power_update(self, event):
        """Handle power update broadcasts."""
        print(f"[Dashboard] Received power update: {event}")
        await self.send(text_data=json.dumps({
            'type': 'power',
            'classroom_id': event.get('classroom_id'),
            'voltage': event.get('voltage'),
            'current': event.get('current'),
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
            
            # Calculate countdown and excess time
            countdown = None
            excess_minutes = None
            if current_session and current_session.expected_out:
                remaining = (current_session.expected_out - now).total_seconds()
                countdown = max(0, int(remaining))
                if remaining < 0:
                    excess_minutes = int(-remaining / 60)
            
            classroom_data.append({
                'id': classroom.id,
                'name': classroom.name,
                'excess_minutes': excess_minutes,
                'expected_out': current_session.expected_out.isoformat() if current_session and current_session.expected_out else None,
                'current_teacher': {
                    'id': current_session.teacher.id,
                    'username': current_session.teacher.username,
                    'email': current_session.teacher.email,
                    'first_name': current_session.teacher.first_name,
                    'last_name': current_session.teacher.last_name,
                    'full_name': current_session.teacher.get_full_name(),
                    'role': current_session.teacher.role,
                    'rfid_uid': current_session.teacher.rfid_uid,
                    'is_active': current_session.teacher.is_active
                } if current_session else None,
                'time_in': current_session.time_in.isoformat() if current_session else None,
                'countdown_seconds': countdown,
                'current_voltage': float(latest_energy.voltage) if latest_energy and latest_energy.voltage else None,
                'current_current': float(latest_energy.current) if latest_energy and latest_energy.current else None,
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
                'completed': today_sessions.filter(status__in=['AUTO_OUT', 'MANUAL_OUT', 'CASCADE_OUT']).count(),
                'invalid': today_sessions.filter(status='INVALID').count()
            }
        }


class AdminConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for admin RFID scanning."""
    
    async def connect(self):
        self.room_group_name = 'admin_rfid_scan'
        
        print(f"[Admin] Connecting to admin RFID scan group")
        
        # Join admin scan group
        if self.channel_layer is not None:
            await self.channel_layer.group_add(
                self.room_group_name,
                self.channel_name
            )
        
        await self.accept()
        print("[Admin] Admin RFID scan connection accepted")
    
    async def disconnect(self, close_code):
        if self.channel_layer is not None:
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
        print(f"[Admin] Admin disconnected from RFID scan group")
    
    async def receive(self, text_data):
        """Handle incoming messages from admin frontend."""
        try:
            data = json.loads(text_data)
            action = data.get('action')
            
            if action == 'start_scan':
                classroom_id = data.get('classroom_id')
                print(f"[Admin] Start scan request for classroom {classroom_id}")
                
                # Send start_scan command to ESP32 device
                if classroom_id and self.channel_layer:
                    await self.channel_layer.group_send(
                        f'iot_classroom_{classroom_id}',
                        {
                            'type': 'start_scan_command',
                            'classroom_id': classroom_id
                        }
                    )
                    
                    await self.send(text_data=json.dumps({
                        'status': 'ok',
                        'message': 'Scan command sent to device'
                    }))
                else:
                    await self.send(text_data=json.dumps({
                        'status': 'error',
                        'message': 'Invalid classroom_id'
                    }))
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'status': 'error',
                'message': 'Invalid JSON'
            }))
    
    async def rfid_scan_result(self, event):
        """Handle RFID scan result from ESP32."""
        print(f"[Admin] Received scan result: {event.get('rfid_uid')}")
        await self.send(text_data=json.dumps({
            'type': 'scan_result',
            'rfid_uid': event['rfid_uid'],
            'classroom_id': event.get('classroom_id')
        }))
    
    async def rfid_scan_timeout(self, event):
        """Handle RFID scan timeout from ESP32."""
        print(f"[Admin] Scan timeout for classroom {event.get('classroom_id')}")
        await self.send(text_data=json.dumps({
            'type': 'scan_timeout',
            'classroom_id': event.get('classroom_id')
        }))
