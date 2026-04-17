import csv
import io
import zipfile

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate, get_user_model
from django.http import HttpResponse
from django.utils import timezone
from django.db.models import Sum, Avg, Max, Min, Count
from django.db.models.functions import TruncDate, TruncHour, TruncDay, TruncWeek, TruncMonth
from datetime import datetime, timedelta
from .models import Classroom, Schedule, AttendanceSession, EnergyLog, EnergyAggregation, TeacherEnergyUsage, OverrideRFID, MaintenanceRFID, SystemConfig, ClassroomCalibration
from .serializers import (
    UserSerializer, UserCreateSerializer, TeacherCreateSerializer,
    ClassroomSerializer, ClassroomCreateSerializer,
    ScheduleSerializer, AttendanceSessionSerializer, EnergyLogSerializer,
    EnergyAggregationSerializer, LoginSerializer, RegisterSerializer,
    AttendanceReportSerializer, EnergyReportSerializer,
    TeacherEnergyUsageSerializer, TeacherEnergySummarySerializer,
    OverrideRFIDSerializer,
    MaintenanceRFIDSerializer,
    SystemConfigSerializer,
    ClassroomCalibrationSerializer
)

User = get_user_model()


class IsAdminUser(permissions.BasePermission):
    """Permission class for admin users."""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == 'admin'


class LoginView(APIView):
    """Handle user login and JWT token generation."""
    permission_classes = [permissions.AllowAny]
    
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        user = authenticate(
            username=serializer.validated_data['username'],
            password=serializer.validated_data['password']
        )
        
        if user is None:
            return Response(
                {'error': 'Invalid credentials'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        
        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data
        })


class SetupStatusView(APIView):
    """Check if first-time admin setup is needed (no admin exists)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        needs_setup = not User.objects.filter(role='admin').exists()
        return Response({'needs_setup': needs_setup})


class RegisterView(APIView):
    """First-time admin registration. Only available when no admin exists."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        if User.objects.filter(role='admin').exists():
            return Response(
                {'error': 'Admin already exists. Use login instead.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data
        })


class LogoutView(APIView):
    """Handle user logout by blacklisting refresh token."""
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request):
        try:
            refresh_token = request.data.get('refresh')
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
            return Response({'message': 'Successfully logged out'})
        except Exception:
            return Response({'message': 'Logged out'})


class UserViewSet(viewsets.ModelViewSet):
    """ViewSet for managing users (teachers)."""
    queryset = User.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]
    
    def get_serializer_class(self):
        if self.action == 'create':
            # Teachers: first_name, last_name, email only (no username/password)
            return TeacherCreateSerializer
        return UserSerializer
    
    def get_queryset(self):
        queryset = User.objects.all()
        role = self.request.query_params.get('role')
        if role:
            queryset = queryset.filter(role=role)
        return queryset

    @action(detail=False, methods=['get'])
    def teachers(self, request):
        """Get all teachers."""
        teachers = User.objects.filter(role='teacher', is_active=True)
        return Response(UserSerializer(teachers, many=True).data)
    
    @action(detail=True, methods=['post'])
    def assign_rfid(self, request, pk=None):
        """Assign RFID to a teacher."""
        user = self.get_object()
        rfid_uid = request.data.get('rfid_uid')
        if not rfid_uid:
            return Response({'error': 'rfid_uid is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if RFID is already assigned
        if User.objects.filter(rfid_uid=rfid_uid).exclude(pk=user.pk).exists():
            return Response({'error': 'RFID already assigned to another user'}, status=status.HTTP_400_BAD_REQUEST)
        
        user.rfid_uid = rfid_uid
        user.save()
        return Response(UserSerializer(user).data)


class ClassroomViewSet(viewsets.ModelViewSet):
    """ViewSet for managing classrooms."""
    queryset = Classroom.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    
    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return ClassroomCreateSerializer
        return ClassroomSerializer
    
    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsAdminUser()]
        return [permissions.IsAuthenticated()]
    
    @action(detail=True, methods=['get'])
    def current_status(self, request, pk=None):
        """Get current status of a classroom."""
        classroom = self.get_object()
        serializer = ClassroomSerializer(classroom)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def schedules(self, request, pk=None):
        """Get schedules for a classroom."""
        classroom = self.get_object()
        schedules = classroom.schedules.all()
        return Response(ScheduleSerializer(schedules, many=True).data)

    @action(detail=True, methods=['get', 'patch'], url_path='calibration',
            permission_classes=[permissions.IsAuthenticated, IsAdminUser])
    def calibration(self, request, pk=None):
        """Get or update sensor calibration for a classroom."""
        classroom = self.get_object()
        cal, _ = ClassroomCalibration.objects.get_or_create(
            classroom=classroom,
            defaults={'voltage_sensitivity': 483.5, 'current_sensitivity': 0.04,
                      'nominal_voltage': 230.0, 'add_ampere': 0.0}
        )
        if request.method == 'GET':
            return Response(ClassroomCalibrationSerializer(cal).data)
        serializer = ClassroomCalibrationSerializer(cal, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Push updated calibration to ESP32
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f'iot_classroom_{classroom.id}',
                {
                    'type': 'calibration_config',
                    'calibration': cal.to_esp32_payload()
                }
            )
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='calibrate-now',
            permission_classes=[permissions.IsAuthenticated, IsAdminUser])
    def calibrate_now(self, request, pk=None):
        """Trigger zero-point calibration on the ESP32 (ensure no load)."""
        classroom = self.get_object()
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f'iot_classroom_{classroom.id}',
                {'type': 'calibrate_command'}
            )
        return Response({'message': 'Calibrate command sent to device. Ensure no load, then check device.'})


class ScheduleViewSet(viewsets.ModelViewSet):
    """ViewSet for managing schedules."""
    queryset = Schedule.objects.select_related('teacher', 'classroom').all()
    serializer_class = ScheduleSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), IsAdminUser()]
        return [permissions.IsAuthenticated()]
    
    def get_queryset(self):
        queryset = Schedule.objects.select_related('teacher', 'classroom').all()
        
        teacher_id = self.request.query_params.get('teacher')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        
        classroom_id = self.request.query_params.get('classroom')
        if classroom_id:
            queryset = queryset.filter(classroom_id=classroom_id)
        
        day = self.request.query_params.get('day')
        if day is not None:
            queryset = queryset.filter(day_of_week=day)
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def today(self, request):
        """Get today's schedules."""
        today = timezone.now().weekday()
        schedules = self.get_queryset().filter(day_of_week=today)
        return Response(ScheduleSerializer(schedules, many=True).data)

    @action(detail=False, methods=['get'])
    def weekly(self, request):
        """Return all schedules for a given week enriched with actual attendance & energy data.

        Query param:
            week_start (YYYY-MM-DD) — must be a Monday. Defaults to the current week's Monday.
        """
        from datetime import date, timedelta

        week_start_param = request.query_params.get('week_start')
        if week_start_param:
            try:
                week_start = date.fromisoformat(week_start_param)
            except ValueError:
                return Response(
                    {'error': 'week_start must be a valid ISO date (YYYY-MM-DD).'},
                    status=400
                )
            if week_start.weekday() != 0:
                return Response({'error': 'week_start must be a Monday.'}, status=400)
        else:
            today = timezone.now().date()
            week_start = today - timedelta(days=today.weekday())

        # Map day_of_week (0-6) to actual date in the selected week
        week_dates = {i: week_start + timedelta(days=i) for i in range(7)}
        all_week_dates = list(week_dates.values())

        # All schedules (all teachers, full week)
        schedules = (
            Schedule.objects
            .select_related('teacher', 'classroom')
            .order_by('day_of_week', 'start_time')
        )

        # Batch-fetch all matching attendance sessions for the week
        sessions_qs = (
            AttendanceSession.objects
            .filter(date__in=all_week_dates)
            .select_related('teacher', 'classroom')
            .prefetch_related('energy_usage')
        )

        # Build lookup: (teacher_id, classroom_id, date) -> best session
        # Prefer non-INVALID, then latest time_in
        STATUS_PRIORITY = {'IN': 0, 'MANUAL_OUT': 1, 'AUTO_OUT': 2, 'CASCADE_OUT': 3, 'INVALID': 4}
        session_map = {}
        for s in sessions_qs:
            key = (s.teacher_id, s.classroom_id, s.date)
            existing = session_map.get(key)
            if existing is None:
                session_map[key] = s
            else:
                s_priority = STATUS_PRIORITY.get(s.status, 9)
                e_priority = STATUS_PRIORITY.get(existing.status, 9)
                if s_priority < e_priority or (
                    s_priority == e_priority and s.time_in > existing.time_in
                ):
                    session_map[key] = s

        now = timezone.now()
        result = []
        for sched in schedules:
            actual_date = week_dates[sched.day_of_week]
            session = session_map.get((sched.teacher_id, sched.classroom_id, actual_date))

            session_data = None
            if session is not None:
                # Duration & kWh from TeacherEnergyUsage (populated after session ends)
                duration_minutes = None
                total_kwh = None
                try:
                    eu = session.energy_usage
                    duration_minutes = eu.duration_minutes
                    total_kwh = float(eu.total_kwh)
                except Exception:
                    pass

                # Excess minutes beyond expected_out
                excess_minutes = None
                if session.expected_out:
                    end_time = now if session.status == 'IN' else (session.time_out or now)
                    diff = int((end_time - session.expected_out).total_seconds() / 60)
                    excess_minutes = diff if diff > 0 else None

                session_data = {
                    'id': session.id,
                    'status': session.status,
                    'time_in': session.time_in.isoformat() if session.time_in else None,
                    'time_out': session.time_out.isoformat() if session.time_out else None,
                    'duration_minutes': duration_minutes,
                    'excess_minutes': excess_minutes,
                    'total_kwh': total_kwh,
                }

            result.append({
                'schedule_id': sched.id,
                'teacher_id': sched.teacher_id,
                'teacher_name': sched.teacher.get_full_name() or sched.teacher.username,
                'classroom_id': sched.classroom_id,
                'classroom_name': sched.classroom.name,
                'day_of_week': sched.day_of_week,
                'day_name': sched.get_day_of_week_display(),
                'date': actual_date.isoformat(),
                'start_time': sched.start_time.strftime('%H:%M'),
                'end_time': sched.end_time.strftime('%H:%M'),
                'subject': sched.subject,
                'session': session_data,
            })

        return Response(result)


class AttendanceSessionViewSet(viewsets.ModelViewSet):
    """ViewSet for managing attendance sessions."""
    queryset = AttendanceSession.objects.select_related('teacher', 'classroom', 'schedule', 'energy_usage').all()
    serializer_class = AttendanceSessionSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        queryset = AttendanceSession.objects.select_related('teacher', 'classroom', 'schedule', 'energy_usage').all()
        
        date_param = self.request.query_params.get('date')
        if date_param:
            queryset = queryset.filter(date=date_param)

        start_date = self.request.query_params.get('start_date')
        if start_date:
            queryset = queryset.filter(date__gte=start_date)

        end_date = self.request.query_params.get('end_date')
        if end_date:
            queryset = queryset.filter(date__lte=end_date)
        
        classroom_id = self.request.query_params.get('classroom')
        if classroom_id:
            queryset = queryset.filter(classroom_id=classroom_id)
        
        teacher_id = self.request.query_params.get('teacher')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        
        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)
        
        return queryset

    def paginate_queryset(self, queryset):
        if self.request.query_params.get('no_page'):
            return None
        return super().paginate_queryset(queryset)
    
    @action(detail=False, methods=['get'])
    def today(self, request):
        """Get today's attendance sessions."""
        today = timezone.now().date()
        sessions = self.get_queryset().filter(date=today)
        return Response(AttendanceSessionSerializer(sessions, many=True).data)
    
    @action(detail=False, methods=['get'])
    def active(self, request):
        """Get all active (IN) attendance sessions."""
        sessions = self.get_queryset().filter(status='IN')
        return Response(AttendanceSessionSerializer(sessions, many=True).data)
    
    @action(detail=False, methods=['get'])
    def report(self, request):
        """Generate attendance report."""
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        
        queryset = self.get_queryset()
        
        if start_date:
            queryset = queryset.filter(date__gte=start_date)
        if end_date:
            queryset = queryset.filter(date__lte=end_date)
        
        # Group by date
        report_data = queryset.values('date').annotate(
            total_sessions=Count('id'),
            valid_sessions=Count('id', filter=models.Q(status='IN') | models.Q(status='AUTO_OUT') | models.Q(status='MANUAL_OUT') | models.Q(status='CASCADE_OUT')),
            invalid_sessions=Count('id', filter=models.Q(status='INVALID')),
            auto_timeout_sessions=Count('id', filter=models.Q(status='AUTO_OUT') | models.Q(status='MANUAL_OUT') | models.Q(status='CASCADE_OUT'))
        ).order_by('-date')
        
        return Response(report_data)


class MaintenanceRFIDViewSet(viewsets.ModelViewSet):
    """ViewSet for managing maintenance/staff RFID cards (lights control only)."""
    queryset = MaintenanceRFID.objects.filter(is_active=True)
    serializer_class = MaintenanceRFIDSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]
    
    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


class OverrideRFIDViewSet(viewsets.ModelViewSet):
    """ViewSet for managing override/substitute RFID cards."""
    queryset = OverrideRFID.objects.select_related('teacher').filter(is_active=True)
    serializer_class = OverrideRFIDSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]
    
    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()  # Soft delete


class SystemConfigView(APIView):
    """Get or update system configuration (auto-timeout settings). Admin only."""
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]

    def get(self, request):
        config = SystemConfig.load()
        serializer = SystemConfigSerializer(config)
        return Response(serializer.data)

    def patch(self, request):
        config = SystemConfig.load()
        serializer = SystemConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class EnergyLogViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for viewing energy logs."""
    queryset = EnergyLog.objects.select_related('classroom').all()
    serializer_class = EnergyLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        queryset = EnergyLog.objects.select_related('classroom').all()
        
        classroom_id = self.request.query_params.get('classroom')
        if classroom_id:
            queryset = queryset.filter(classroom_id=classroom_id)
        
        start_time = self.request.query_params.get('start')
        if start_time:
            queryset = queryset.filter(timestamp__gte=start_time)
        
        end_time = self.request.query_params.get('end')
        if end_time:
            queryset = queryset.filter(timestamp__lte=end_time)
        
        return queryset[:1000]  # Limit results
    
    @action(detail=False, methods=['get'])
    def latest(self, request):
        """Get latest energy readings for all classrooms."""
        classrooms = Classroom.objects.filter(is_active=True)
        data = []
        for classroom in classrooms:
            latest = classroom.energy_logs.order_by('-timestamp').first()
            if latest:
                data.append({
                    'classroom_id': classroom.id,
                    'classroom_name': classroom.name,
                    'watts': float(latest.watts),
                    'timestamp': latest.timestamp.isoformat()
                })
        return Response(data)


class EnergyReportView(APIView):
    """API view for energy consumption reports."""
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        classroom_id = request.query_params.get('classroom')
        range_type = request.query_params.get('range', 'day')  # hour, day, week, month
        start_date = request.query_params.get('start')
        end_date = request.query_params.get('end')
        
        queryset = EnergyLog.objects.all()
        
        if classroom_id:
            queryset = queryset.filter(classroom_id=classroom_id)
        
        now = timezone.now()
        if not start_date:
            if range_type == 'hour':
                start_date = now - timedelta(hours=24)
            elif range_type == 'day':
                start_date = now - timedelta(days=30)
            elif range_type == 'week':
                start_date = now - timedelta(weeks=12)
            else:
                start_date = now - timedelta(days=365)
        
        if start_date:
            if isinstance(start_date, str):
                start_date = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            queryset = queryset.filter(timestamp__gte=start_date)
        
        if end_date:
            if isinstance(end_date, str):
                end_date = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            queryset = queryset.filter(timestamp__lte=end_date)
        
        # Aggregate based on range type
        if range_type == 'hour':
            trunc_func = TruncHour
        elif range_type == 'week':
            trunc_func = TruncWeek
        elif range_type == 'month':
            trunc_func = TruncMonth
        else:
            trunc_func = TruncDay
        
        data = queryset.annotate(
            period=trunc_func('timestamp')
        ).values('period').annotate(
            avg_watts=Avg('watts'),
            max_watts=Max('watts'),
            min_watts=Min('watts'),
            reading_count=Count('id')
        ).order_by('period')
        
        # Calculate kWh (assuming readings are every minute)
        result = []
        for item in data:
            # Estimate kWh based on average watts and reading frequency
            hours = item['reading_count'] / 60  # Assuming readings per minute
            kwh = (float(item['avg_watts']) * hours) / 1000
            result.append({
                'period': item['period'].isoformat() if item['period'] else None,
                'total_kwh': round(kwh, 4),
                'avg_watts': round(float(item['avg_watts']), 2),
                'max_watts': round(float(item['max_watts']), 2),
                'min_watts': round(float(item['min_watts']), 2),
                'reading_count': item['reading_count']
            })
        
        return Response(result)


class TeacherEnergyBreakdownView(APIView):
    """Per-teacher kWh grouped into the same time buckets as EnergyReportView."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        range_type   = request.query_params.get('range', 'day')
        classroom_id = request.query_params.get('classroom')
        start_date   = request.query_params.get('start')
        end_date     = request.query_params.get('end')

        qs = TeacherEnergyUsage.objects.select_related('teacher')

        if classroom_id:
            qs = qs.filter(classroom_id=classroom_id)

        now = timezone.now()
        if not start_date:
            if range_type == 'hour':
                start_date = now - timedelta(hours=24)
            elif range_type == 'day':
                start_date = now - timedelta(days=30)
            elif range_type == 'week':
                start_date = now - timedelta(weeks=12)
            else:
                start_date = now - timedelta(days=365)

        if isinstance(start_date, str):
            start_date = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        qs = qs.filter(start_time__gte=start_date)

        if end_date:
            if isinstance(end_date, str):
                end_date = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            qs = qs.filter(end_time__lte=end_date)

        trunc_map = {
            'hour':  TruncHour,
            'week':  TruncWeek,
            'month': TruncMonth,
        }
        trunc_func = trunc_map.get(range_type, TruncDay)

        rows = (
            qs
            .annotate(period=trunc_func('start_time'))
            .values(
                'period', 'teacher',
                'teacher__first_name', 'teacher__last_name', 'teacher__username',
            )
            .annotate(
                total_kwh=Sum('total_kwh'),
                avg_watts=Avg('avg_watts'),
                session_count=Count('id'),
            )
            .order_by('period', 'teacher')
        )

        result = []
        for row in rows:
            name = f"{row['teacher__first_name']} {row['teacher__last_name']}".strip()
            if not name:
                name = row['teacher__username']
            result.append({
                'period':        row['period'].isoformat() if row['period'] else None,
                'teacher_id':    row['teacher'],
                'teacher_name':  name,
                'total_kwh':     round(float(row['total_kwh']  or 0), 4),
                'avg_watts':     round(float(row['avg_watts']   or 0), 2),
                'session_count': row['session_count'],
            })

        return Response(result)


class DashboardView(APIView):
    """API view for dashboard data."""
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        today = timezone.now().date()
        now = timezone.now()
        
        # Get active attendance sessions
        active_sessions = AttendanceSession.objects.filter(
            status='IN'
        ).select_related('teacher', 'classroom')
        
        # Get today's statistics
        today_sessions = AttendanceSession.objects.filter(date=today)
        
        # Get classroom data with current power
        classrooms = Classroom.objects.filter(is_active=True)
        classroom_data = []
        
        for classroom in classrooms:
            # Get current teacher
            current_session = active_sessions.filter(classroom=classroom).first()
            
            # Get current power
            latest_energy = classroom.energy_logs.order_by('-timestamp').first()
            
            # Get expected timeout and excess time
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
                'current_teacher': UserSerializer(current_session.teacher).data if current_session else None,
                'time_in': current_session.time_in.isoformat() if current_session else None,
                'countdown_seconds': countdown,
                'current_voltage': float(latest_energy.voltage) if latest_energy and latest_energy.voltage else None,
                'current_current': float(latest_energy.current) if latest_energy and latest_energy.current else None,
                'current_power': float(latest_energy.watts) if latest_energy else None,
                'last_power_update': latest_energy.timestamp.isoformat() if latest_energy else None
            })
        
        return Response({
            'classrooms': classroom_data,
            'stats': {
                'total_today': today_sessions.count(),
                'active': active_sessions.count(),
                'completed': today_sessions.filter(status__in=['AUTO_OUT', 'MANUAL_OUT', 'CASCADE_OUT']).count(),
                'invalid': today_sessions.filter(status='INVALID').count()
            }
        })


# Import models for Q object usage
from django.db import models


class TeacherEnergyViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for viewing teacher energy usage."""
    queryset = TeacherEnergyUsage.objects.select_related('teacher', 'classroom', 'attendance_session').all()
    serializer_class = TeacherEnergyUsageSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        queryset = TeacherEnergyUsage.objects.select_related(
            'teacher', 'classroom', 'attendance_session'
        ).all()
        
        teacher_id = self.request.query_params.get('teacher')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        
        classroom_id = self.request.query_params.get('classroom')
        if classroom_id:
            queryset = queryset.filter(classroom_id=classroom_id)
        
        start_date = self.request.query_params.get('start')
        if start_date:
            queryset = queryset.filter(start_time__gte=start_date)
        
        end_date = self.request.query_params.get('end')
        if end_date:
            queryset = queryset.filter(end_time__lte=end_date)
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get energy summary grouped by teacher."""
        queryset = self.get_queryset()
        
        summary = queryset.values(
            'teacher', 'teacher__first_name', 'teacher__last_name', 'teacher__username'
        ).annotate(
            total_kwh=Sum('total_kwh'),
            total_minutes=Sum('duration_minutes'),
            avg_watts=Avg('avg_watts'),
            session_count=Count('id')
        ).order_by('-total_kwh')
        
        result = []
        for item in summary:
            teacher_name = f"{item['teacher__first_name']} {item['teacher__last_name']}".strip()
            if not teacher_name:
                teacher_name = item['teacher__username']
            
            result.append({
                'teacher_id': item['teacher'],
                'teacher_name': teacher_name,
                'total_kwh': round(float(item['total_kwh'] or 0), 4),
                'total_hours': round((item['total_minutes'] or 0) / 60, 2),
                'avg_watts': round(float(item['avg_watts'] or 0), 2),
                'session_count': item['session_count']
            })
        
        return Response(result)
    
    @action(detail=False, methods=['get'])
    def by_classroom(self, request):
        """Get teacher energy usage grouped by classroom."""
        teacher_id = request.query_params.get('teacher')
        
        if not teacher_id:
            return Response({'error': 'teacher parameter required'}, status=status.HTTP_400_BAD_REQUEST)
        
        queryset = self.get_queryset().filter(teacher_id=teacher_id)
        
        breakdown = queryset.values(
            'classroom', 'classroom__name'
        ).annotate(
            total_kwh=Sum('total_kwh'),
            total_minutes=Sum('duration_minutes'),
            avg_watts=Avg('avg_watts'),
            session_count=Count('id')
        ).order_by('-total_kwh')
        
        result = []
        for item in breakdown:
            result.append({
                'classroom_id': item['classroom'],
                'classroom_name': item['classroom__name'],
                'total_kwh': round(float(item['total_kwh'] or 0), 4),
                'total_hours': round((item['total_minutes'] or 0) / 60, 2),
                'avg_watts': round(float(item['avg_watts'] or 0), 2),
                'session_count': item['session_count']
            })
        
        return Response(result)
    
    @action(detail=False, methods=['get'])
    def by_date(self, request):
        """Get teacher energy usage grouped by date."""
        queryset = self.get_queryset()
        
        teacher_id = request.query_params.get('teacher')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        
        breakdown = queryset.annotate(
            date=TruncDate('start_time')
        ).values('date').annotate(
            total_kwh=Sum('total_kwh'),
            total_minutes=Sum('duration_minutes'),
            avg_watts=Avg('avg_watts'),
            session_count=Count('id')
        ).order_by('-date')
        
        result = []
        for item in breakdown:
            result.append({
                'date': item['date'].isoformat() if item['date'] else None,
                'total_kwh': round(float(item['total_kwh'] or 0), 4),
                'total_hours': round((item['total_minutes'] or 0) / 60, 2),
                'avg_watts': round(float(item['avg_watts'] or 0), 2),
                'session_count': item['session_count']
            })
        
        return Response(result)
    
    @action(detail=False, methods=['post'])
    def recalculate(self, request):
        """
        Recalculate energy usage for all completed sessions (admin only).
        Processes in batches to avoid database locking issues.
        """
        if not request.user.role == 'admin':
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        
        # Get optional batch parameters from request
        batch_size = int(request.data.get('batch_size', 10))
        delay = float(request.data.get('delay', 0.5))
        
        # Limit batch size for safety
        batch_size = min(max(batch_size, 1), 50)
        delay = min(max(delay, 0.1), 5.0)
        
        from core.services.energy_calculation import recalculate_all_teacher_energy
        
        try:
            result = recalculate_all_teacher_energy(
                batch_size=batch_size,
                delay_between_batches=delay
            )
            
            return Response({
                'message': f"Processed {result['total']} sessions: {result['success']} success, {result['skipped']} skipped, {result['errors']} errors",
                'details': result
            })
        except Exception as e:
            return Response({
                'error': f'Recalculation failed: {str(e)}',
                'hint': 'Try again with smaller batch_size or larger delay'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ExportDataView(APIView):
    """Export all system data as CSV files bundled in a ZIP archive. Admin only."""
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]

    def get(self, request):
        start_date = request.query_params.get('start_date')  # optional ISO date e.g. 2026-01-01
        end_date = request.query_params.get('end_date')      # optional ISO date e.g. 2026-12-31

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('attendance_sessions.csv', self._attendance_csv(start_date, end_date))
            zf.writestr('energy_logs.csv',          self._energy_logs_csv(start_date, end_date))
            zf.writestr('energy_aggregations.csv',  self._energy_agg_csv(start_date, end_date))
            zf.writestr('teacher_energy_usage.csv', self._teacher_energy_csv(start_date, end_date))
            zf.writestr('schedules.csv',             self._schedules_csv())
            zf.writestr('classrooms.csv',            self._classrooms_csv())
            zf.writestr('users.csv',                 self._users_csv())

        zip_buffer.seek(0)
        stamp = timezone.now().strftime('%Y%m%d_%H%M%S')
        response = HttpResponse(zip_buffer.read(), content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="export_{stamp}.zip"'
        return response

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _make_csv(headers, rows):
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(headers)
        writer.writerows(rows)
        # UTF-8 BOM so Excel opens correctly
        return '\ufeff' + buf.getvalue()

    def _attendance_csv(self, start_date, end_date):
        qs = AttendanceSession.objects.select_related('teacher', 'classroom').order_by('-date', '-time_in')
        if start_date:
            qs = qs.filter(date__gte=start_date)
        if end_date:
            qs = qs.filter(date__lte=end_date)
        headers = ['id', 'teacher_name', 'classroom_name', 'date', 'time_in', 'time_out',
                   'expected_out', 'status', 'rfid_uid_used', 'is_override']
        rows = [
            [
                s.id,
                s.teacher.get_full_name() or s.teacher.username,
                s.classroom.name,
                s.date,
                s.time_in.isoformat() if s.time_in else '',
                s.time_out.isoformat() if s.time_out else '',
                s.expected_out.isoformat() if s.expected_out else '',
                s.status,
                s.rfid_uid_used,
                s.is_override,
            ]
            for s in qs.iterator()
        ]
        return self._make_csv(headers, rows)

    def _energy_logs_csv(self, start_date, end_date):
        qs = EnergyLog.objects.select_related('classroom').order_by('-timestamp')
        if start_date:
            qs = qs.filter(timestamp__date__gte=start_date)
        if end_date:
            qs = qs.filter(timestamp__date__lte=end_date)
        headers = ['id', 'classroom_name', 'voltage', 'current', 'watts', 'timestamp']
        rows = [
            [
                e.id,
                e.classroom.name,
                float(e.voltage) if e.voltage is not None else '',
                float(e.current) if e.current is not None else '',
                float(e.watts),
                e.timestamp.isoformat(),
            ]
            for e in qs.iterator()
        ]
        return self._make_csv(headers, rows)

    def _energy_agg_csv(self, start_date, end_date):
        qs = EnergyAggregation.objects.select_related('classroom').order_by('-period_start')
        if start_date:
            qs = qs.filter(period_start__date__gte=start_date)
        if end_date:
            qs = qs.filter(period_start__date__lte=end_date)
        headers = ['id', 'classroom_name', 'period_type', 'period_start',
                   'total_kwh', 'avg_watts', 'max_watts', 'min_watts', 'reading_count']
        rows = [
            [
                a.id,
                a.classroom.name,
                a.period_type,
                a.period_start.isoformat(),
                float(a.total_kwh),
                float(a.avg_watts),
                float(a.max_watts),
                float(a.min_watts),
                a.reading_count,
            ]
            for a in qs.iterator()
        ]
        return self._make_csv(headers, rows)

    def _teacher_energy_csv(self, start_date, end_date):
        qs = TeacherEnergyUsage.objects.select_related('teacher', 'classroom').order_by('-start_time')
        if start_date:
            qs = qs.filter(start_time__date__gte=start_date)
        if end_date:
            qs = qs.filter(end_time__date__lte=end_date)
        headers = ['id', 'teacher_name', 'classroom_name', 'attendance_session_id',
                   'start_time', 'end_time', 'duration_minutes',
                   'avg_watts', 'max_watts', 'min_watts', 'total_kwh', 'reading_count']
        rows = [
            [
                t.id,
                t.teacher.get_full_name() or t.teacher.username,
                t.classroom.name,
                t.attendance_session_id,
                t.start_time.isoformat(),
                t.end_time.isoformat(),
                t.duration_minutes,
                float(t.avg_watts),
                float(t.max_watts),
                float(t.min_watts),
                float(t.total_kwh),
                t.reading_count,
            ]
            for t in qs.iterator()
        ]
        return self._make_csv(headers, rows)

    def _schedules_csv(self):
        qs = Schedule.objects.select_related('teacher', 'classroom').order_by('day_of_week', 'start_time')
        headers = ['id', 'teacher_name', 'classroom_name', 'day_of_week', 'day_name',
                   'start_time', 'end_time', 'subject']
        rows = [
            [
                s.id,
                s.teacher.get_full_name() or s.teacher.username,
                s.classroom.name,
                s.day_of_week,
                s.get_day_of_week_display(),
                s.start_time,
                s.end_time,
                s.subject,
            ]
            for s in qs.iterator()
        ]
        return self._make_csv(headers, rows)

    def _classrooms_csv(self):
        qs = Classroom.objects.order_by('name')
        headers = ['id', 'name', 'device_id', 'is_active', 'created_at', 'updated_at']
        rows = [
            [
                c.id,
                c.name,
                c.device_id,
                c.is_active,
                c.created_at.isoformat(),
                c.updated_at.isoformat(),
            ]
            for c in qs.iterator()
        ]
        return self._make_csv(headers, rows)

    def _users_csv(self):
        qs = User.objects.order_by('role', 'last_name', 'first_name')
        headers = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'rfid_uid', 'is_active']
        rows = [
            [
                u.id,
                u.username,
                u.email,
                u.first_name,
                u.last_name,
                u.role,
                u.rfid_uid or '',
                u.is_active,
            ]
            for u in qs.iterator()
        ]
        return self._make_csv(headers, rows)
