from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from django.db.models import Sum, Avg, Max, Min, Count
from django.db.models.functions import TruncDate, TruncHour, TruncDay, TruncMonth
from datetime import datetime, timedelta
from .models import Classroom, Schedule, AttendanceSession, EnergyLog, EnergyAggregation
from .serializers import (
    UserSerializer, UserCreateSerializer, ClassroomSerializer, ClassroomCreateSerializer,
    ScheduleSerializer, AttendanceSessionSerializer, EnergyLogSerializer,
    EnergyAggregationSerializer, LoginSerializer, AttendanceReportSerializer, EnergyReportSerializer
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
            return UserCreateSerializer
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


class AttendanceSessionViewSet(viewsets.ModelViewSet):
    """ViewSet for managing attendance sessions."""
    queryset = AttendanceSession.objects.select_related('teacher', 'classroom', 'schedule').all()
    serializer_class = AttendanceSessionSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        queryset = AttendanceSession.objects.select_related('teacher', 'classroom', 'schedule').all()
        
        date_param = self.request.query_params.get('date')
        if date_param:
            queryset = queryset.filter(date=date_param)
        
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
            valid_sessions=Count('id', filter=models.Q(status='IN') | models.Q(status='AUTO_OUT')),
            invalid_sessions=Count('id', filter=models.Q(status='INVALID')),
            auto_timeout_sessions=Count('id', filter=models.Q(status='AUTO_OUT'))
        ).order_by('-date')
        
        return Response(report_data)


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
        range_type = request.query_params.get('range', 'day')  # hour, day, month
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
            
            # Get expected timeout
            countdown = None
            if current_session and current_session.expected_out:
                remaining = (current_session.expected_out - now).total_seconds()
                countdown = max(0, int(remaining))
            
            classroom_data.append({
                'id': classroom.id,
                'name': classroom.name,
                'current_teacher': UserSerializer(current_session.teacher).data if current_session else None,
                'time_in': current_session.time_in.isoformat() if current_session else None,
                'countdown_seconds': countdown,
                'current_power': float(latest_energy.watts) if latest_energy else None,
                'last_power_update': latest_energy.timestamp.isoformat() if latest_energy else None
            })
        
        return Response({
            'classrooms': classroom_data,
            'today_stats': {
                'total_sessions': today_sessions.count(),
                'active_sessions': active_sessions.count(),
                'completed_sessions': today_sessions.filter(status='AUTO_OUT').count(),
                'invalid_sessions': today_sessions.filter(status='INVALID').count()
            }
        })


# Import models for Q object usage
from django.db import models
