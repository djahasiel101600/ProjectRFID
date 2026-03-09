from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Classroom, Schedule, AttendanceSession, EnergyLog, EnergyAggregation, TeacherEnergyUsage, OverrideRFID, MaintenanceRFID, SystemConfig, ClassroomCalibration

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
    """Serializer for creating admin users (with username/password)."""
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


class TeacherCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating teachers: first_name, last_name, email only. No username/password."""
    
    class Meta:
        model = User
        fields = ['id', 'first_name', 'last_name', 'email', 'rfid_uid']
    
    def create(self, validated_data):
        import uuid
        email = validated_data.get('email', '')
        # Auto-generate username (Django requires it); teachers never log in
        base = (email.split('@')[0] if email and '@' in email else 'teacher').replace('.', '_')[:100]
        username = f"{base}_{uuid.uuid4().hex[:6]}"
        while User.objects.filter(username=username).exists():
            username = f"{base}_{uuid.uuid4().hex[:6]}"
        user = User(
            username=username,
            email=validated_data.get('email', ''),
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            rfid_uid=validated_data.get('rfid_uid') or None,
            role='teacher',
        )
        user.set_unusable_password()
        user.save()
        return user


class RegisterSerializer(serializers.Serializer):
    """Serializer for first-time admin registration."""
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    first_name = serializers.CharField(required=False, default='')
    last_name = serializers.CharField(required=False, default='')

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(
            username=validated_data['username'],
            email=validated_data['email'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            role='admin',
            is_staff=True,
            is_superuser=True,
        )
        user.set_password(password)
        user.save()
        return user


class ClassroomSerializer(serializers.ModelSerializer):
    """Serializer for Classroom model."""
    current_teacher = serializers.SerializerMethodField()
    current_power = serializers.SerializerMethodField()
    
    class Meta:
        model = Classroom
        fields = ['id', 'name', 'device_id', 'device_token', 'is_active', 'current_teacher', 'current_power', 'created_at', 'updated_at']
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


class ClassroomCalibrationSerializer(serializers.ModelSerializer):
    """Serializer for classroom sensor calibration."""
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)

    class Meta:
        model = ClassroomCalibration
        fields = [
            'id', 'classroom', 'classroom_name',
            'voltage_sensitivity', 'current_sensitivity',
            'quiescent_voltage', 'nominal_voltage', 'add_ampere',
            'updated_at'
        ]
        read_only_fields = ['id', 'updated_at']


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
        fields = ['id', 'classroom', 'classroom_name', 'voltage', 'current', 'watts', 'timestamp', 'created_at']
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


class TeacherEnergyUsageSerializer(serializers.ModelSerializer):
    """Serializer for TeacherEnergyUsage model."""
    teacher_name = serializers.SerializerMethodField()
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)
    
    class Meta:
        model = TeacherEnergyUsage
        fields = [
            'id', 'teacher', 'teacher_name', 'classroom', 'classroom_name',
            'attendance_session', 'start_time', 'end_time', 'duration_minutes',
            'avg_watts', 'max_watts', 'min_watts', 'total_kwh', 'reading_count',
            'created_at'
        ]
    
    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username


class MaintenanceRFIDSerializer(serializers.ModelSerializer):
    """Serializer for maintenance/staff RFID cards (lights control only)."""
    
    class Meta:
        model = MaintenanceRFID
        fields = ['id', 'rfid_uid', 'label', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']


class OverrideRFIDSerializer(serializers.ModelSerializer):
    """Serializer for override/substitute RFID cards."""
    teacher_name = serializers.CharField(source='teacher.get_full_name', read_only=True)
    
    class Meta:
        model = OverrideRFID
        fields = ['id', 'rfid_uid', 'teacher', 'teacher_name', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']


class SystemConfigSerializer(serializers.ModelSerializer):
    """Serializer for system configuration (auto-timeout settings)."""
    auto_timeout_time_display = serializers.SerializerMethodField()

    class Meta:
        model = SystemConfig
        fields = ['id', 'auto_timeout_enabled', 'auto_timeout_time', 'auto_timeout_time_display', 'updated_at']
        read_only_fields = ['id', 'updated_at']

    def get_auto_timeout_time_display(self, obj):
        """Return time as HH:mm for display (e.g., '22:00')."""
        if obj.auto_timeout_time:
            return obj.auto_timeout_time.strftime('%H:%M')
        return '22:00'

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Frontend expects auto_timeout_time as "HH:mm" string
        if instance.auto_timeout_time:
            data['auto_timeout_time'] = instance.auto_timeout_time.strftime('%H:%M')
        return data

    def to_internal_value(self, data):
        # Accept "HH:mm" or "HH:mm:ss" from frontend
        if 'auto_timeout_time' in data and isinstance(data['auto_timeout_time'], str):
            t = data['auto_timeout_time'].strip()
            parts = t.split(':')
            if len(parts) >= 2:
                try:
                    h, m = int(parts[0]), int(parts[1])
                    s = int(parts[2]) if len(parts) > 2 else 0
                    from datetime import time
                    data = data.copy()
                    data['auto_timeout_time'] = time(h, m, s)
                except (ValueError, IndexError):
                    pass
        return super().to_internal_value(data)


class TeacherEnergySummarySerializer(serializers.Serializer):
    """Serializer for teacher energy summary."""
    teacher_id = serializers.IntegerField()
    teacher_name = serializers.CharField()
    total_kwh = serializers.DecimalField(max_digits=12, decimal_places=4)
    total_hours = serializers.DecimalField(max_digits=10, decimal_places=2)
    avg_watts = serializers.DecimalField(max_digits=10, decimal_places=2)
    session_count = serializers.IntegerField()
