from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Classroom, Schedule, AttendanceSession, EnergyLog, EnergyAggregation

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User model."""
    full_name = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'full_name', 'role', 'rfid_uid', 'is_active']
        read_only_fields = ['id']
    
    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class UserCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating users."""
    password = serializers.CharField(write_only=True, min_length=8)
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'first_name', 'last_name', 'role', 'rfid_uid']
    
    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class ClassroomSerializer(serializers.ModelSerializer):
    """Serializer for Classroom model."""
    current_teacher = serializers.SerializerMethodField()
    current_power = serializers.SerializerMethodField()
    
    class Meta:
        model = Classroom
        fields = ['id', 'name', 'device_id', 'is_active', 'current_teacher', 'current_power', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_current_teacher(self, obj):
        from django.utils import timezone
        today = timezone.now().date()
        active_session = obj.attendance_sessions.filter(
            date=today,
            status='IN'
        ).select_related('teacher').first()
        if active_session:
            return UserSerializer(active_session.teacher).data
        return None
    
    def get_current_power(self, obj):
        latest_log = obj.energy_logs.order_by('-timestamp').first()
        if latest_log:
            return float(latest_log.watts)
        return None


class ClassroomCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating classrooms."""
    class Meta:
        model = Classroom
        fields = ['id', 'name', 'device_id', 'device_token', 'is_active']
        read_only_fields = ['id']


class ScheduleSerializer(serializers.ModelSerializer):
    """Serializer for Schedule model."""
    teacher_name = serializers.CharField(source='teacher.get_full_name', read_only=True)
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)
    day_name = serializers.CharField(source='get_day_of_week_display', read_only=True)
    
    class Meta:
        model = Schedule
        fields = ['id', 'teacher', 'teacher_name', 'classroom', 'classroom_name', 
                  'day_of_week', 'day_name', 'start_time', 'end_time', 'subject']
        read_only_fields = ['id']


class AttendanceSessionSerializer(serializers.ModelSerializer):
    """Serializer for AttendanceSession model."""
    teacher_name = serializers.CharField(source='teacher.get_full_name', read_only=True)
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = AttendanceSession
        fields = ['id', 'teacher', 'teacher_name', 'classroom', 'classroom_name', 
                  'schedule', 'date', 'time_in', 'time_out', 'expected_out', 
                  'status', 'status_display', 'rfid_uid_used', 'created_at']
        read_only_fields = ['id', 'created_at']


class EnergyLogSerializer(serializers.ModelSerializer):
    """Serializer for EnergyLog model."""
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)
    
    class Meta:
        model = EnergyLog
        fields = ['id', 'classroom', 'classroom_name', 'watts', 'timestamp', 'created_at']
        read_only_fields = ['id', 'created_at']


class EnergyAggregationSerializer(serializers.ModelSerializer):
    """Serializer for EnergyAggregation model."""
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)
    period_type_display = serializers.CharField(source='get_period_type_display', read_only=True)
    
    class Meta:
        model = EnergyAggregation
        fields = ['id', 'classroom', 'classroom_name', 'period_type', 'period_type_display',
                  'period_start', 'total_kwh', 'avg_watts', 'max_watts', 'min_watts', 'reading_count']


class LoginSerializer(serializers.Serializer):
    """Serializer for login requests."""
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class AttendanceReportSerializer(serializers.Serializer):
    """Serializer for attendance report data."""
    date = serializers.DateField()
    total_sessions = serializers.IntegerField()
    valid_sessions = serializers.IntegerField()
    invalid_sessions = serializers.IntegerField()
    auto_timeout_sessions = serializers.IntegerField()


class EnergyReportSerializer(serializers.Serializer):
    """Serializer for energy report data."""
    period = serializers.CharField()
    total_kwh = serializers.DecimalField(max_digits=12, decimal_places=4)
    avg_watts = serializers.DecimalField(max_digits=10, decimal_places=2)
    max_watts = serializers.DecimalField(max_digits=10, decimal_places=2)
    min_watts = serializers.DecimalField(max_digits=10, decimal_places=2)
