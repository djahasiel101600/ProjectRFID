from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone
from datetime import time


class User(AbstractUser):
    """Extended User model for teachers and admins."""
    ROLE_CHOICES = [
        ('admin', 'Admin'),
        ('teacher', 'Teacher'),
    ]
    
    rfid_uid = models.CharField(max_length=50, unique=True, null=True, blank=True)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='teacher')
    
    class Meta:
        db_table = 'users'
    
    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.role})"


class Classroom(models.Model):
    """Represents a classroom with an associated ESP32 device."""
    name = models.CharField(max_length=100)
    device_id = models.CharField(max_length=50, unique=True)
    device_token = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'classrooms'
        ordering = ['name']
    
    def __str__(self):
        return self.name


class ClassroomCalibration(models.Model):
    """Per-classroom voltage/current sensor calibration. ESP32 uses these when config is pushed."""
    classroom = models.OneToOneField(
        Classroom, on_delete=models.CASCADE, related_name='calibration'
    )
    voltage_sensitivity = models.FloatField(
        default=483.5,
        help_text="ZMPT101B sensitivity (adjust with multimeter)"
    )
    current_sensitivity = models.FloatField(
        default=0.04,
        help_text="ACS724: mV per A (e.g. 0.04 = 40mV/A)"
    )
    quiescent_voltage = models.FloatField(
        default=2.5,
        null=True,
        blank=True,
        help_text="Zero-current voltage (set by calibrate_now or leave null for startup auto-cal)"
    )
    nominal_voltage = models.FloatField(
        default=230.0,
        help_text="Expected AC voltage for capping (110/220/230)"
    )
    add_ampere = models.FloatField(
        default=0.0,
        help_text="Offset to add to current reading (A)"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'classroom_calibration'

    def __str__(self):
        return f"Calibration for {self.classroom.name}"

    def to_esp32_payload(self):
        """Format for WebSocket calibration_config message."""
        payload = {
            'voltage_sensitivity': self.voltage_sensitivity,
            'current_sensitivity': self.current_sensitivity,
            'nominal_voltage': self.nominal_voltage,
            'add_ampere': self.add_ampere,
        }
        if self.quiescent_voltage is not None:
            payload['quiescent_voltage'] = self.quiescent_voltage
        return payload


class Schedule(models.Model):
    """Teacher schedule for a specific classroom."""
    DAY_CHOICES = [
        (0, 'Monday'),
        (1, 'Tuesday'),
        (2, 'Wednesday'),
        (3, 'Thursday'),
        (4, 'Friday'),
        (5, 'Saturday'),
        (6, 'Sunday'),
    ]
    
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='schedules')
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='schedules')
    day_of_week = models.IntegerField(choices=DAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()
    subject = models.CharField(max_length=100, blank=True)
    
    class Meta:
        db_table = 'schedules'
        ordering = ['day_of_week', 'start_time']
        unique_together = ['teacher', 'classroom', 'day_of_week', 'start_time']
    
    def __str__(self):
        return f"{self.teacher} - {self.classroom} ({self.get_day_of_week_display()} {self.start_time}-{self.end_time})"


class MaintenanceRFID(models.Model):
    """RFID cards for staff - control lights only, no attendance. Blocked when teacher is IN."""
    rfid_uid = models.CharField(max_length=50, unique=True)
    label = models.CharField(max_length=100, blank=True)  # e.g. "Janitor", "Facilities"
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'maintenance_rfids'
        ordering = ['label', 'rfid_uid']
    
    def __str__(self):
        return f"Maintenance card {self.rfid_uid}" + (f" ({self.label})" if self.label else "")


class SystemConfig(models.Model):
    """Singleton configuration for system-wide settings. One row (id=1)."""
    id = models.IntegerField(primary_key=True, default=1, editable=False)
    auto_timeout_enabled = models.BooleanField(
        default=False,
        help_text="When enabled, teachers who forgot to tap out are auto-timed out at the configured time."
    )
    auto_timeout_time = models.TimeField(
        default=time(22, 0),
        help_text="Time of day (e.g., 22:00 = 10 PM) when active sessions are auto-timed out."
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'system_config'
        verbose_name = 'System Configuration'
        verbose_name_plural = 'System Configuration'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1, defaults={
            'auto_timeout_enabled': False,
            'auto_timeout_time': time(22, 0),
        })
        return obj


class RoomAvailability(models.Model):
    """
    Open room time windows: periods when a classroom can be used without a specific teacher schedule.
    Teachers with an override card can tap in during these windows (e.g. morning when no one is scheduled).
    """
    DAY_CHOICES = [
        (0, 'Monday'),
        (1, 'Tuesday'),
        (2, 'Wednesday'),
        (3, 'Thursday'),
        (4, 'Friday'),
        (5, 'Saturday'),
        (6, 'Sunday'),
    ]
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='room_availabilities')
    day_of_week = models.IntegerField(choices=DAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()
    label = models.CharField(max_length=100, blank=True, help_text='Optional label e.g. "Morning open"')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'room_availabilities'
        ordering = ['classroom', 'day_of_week', 'start_time']
        verbose_name = 'Open room window'
        verbose_name_plural = 'Open room windows'

    def __str__(self):
        return f"{self.classroom.name} {self.get_day_of_week_display()} {self.start_time}-{self.end_time}" + (f" ({self.label})" if self.label else "")


class OverrideRFID(models.Model):
    """RFID cards that enable substitute/override mode - teacher can take vacant slots or open room windows."""
    rfid_uid = models.CharField(max_length=50, unique=True)
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='override_rfid_cards')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'override_rfids'
        ordering = ['teacher__first_name', 'teacher__last_name']
    
    def __str__(self):
        return f"Override card {self.rfid_uid} → {self.teacher.get_full_name()}"


class AttendanceSession(models.Model):
    """Records teacher attendance sessions."""
    STATUS_CHOICES = [
        ('IN', 'Timed In'),
        ('MANUAL_OUT', 'Manual Time Out'),
        ('AUTO_OUT', 'Auto Timed Out'),
        ('CASCADE_OUT', 'Cascade Checked Out'),
        ('INVALID', 'Invalid'),
    ]
    
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='attendance_sessions')
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='attendance_sessions')
    schedule = models.ForeignKey(Schedule, on_delete=models.SET_NULL, null=True, blank=True, related_name='attendance_sessions')
    date = models.DateField()
    time_in = models.DateTimeField(auto_now_add=True) #Adjusted to remove timezone conflicts
    time_out = models.DateTimeField(null=True, blank=True)
    expected_out = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='IN')
    rfid_uid_used = models.CharField(max_length=50)
    is_override = models.BooleanField(default=False)  # True if used override card to take a vacant slot
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'attendance_sessions'
        ordering = ['-date', '-time_in']
    
    def __str__(self):
        return f"{self.teacher} - {self.classroom} ({self.date} {self.status})"


class EnergyLog(models.Model):
    """Records power consumption readings from ESP32 devices."""
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='energy_logs')
    voltage = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)  # Volts (e.g., 220.50)
    current = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)  # Amps (e.g., 1.2500)
    watts = models.DecimalField(max_digits=10, decimal_places=2)
    timestamp = models.DateTimeField()  # Set explicitly (midpoint of aggregation window)
    # Remove created_at since timestamp now serves the same purpose
    
    class Meta:
        db_table = 'energy_logs'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['classroom', 'timestamp']),
            models.Index(fields=['timestamp']),
        ]
    
    def __str__(self):
        return f"{self.classroom} - {self.watts}W ({self.voltage}V, {self.current}A) @ {self.timestamp}"


class EnergyAggregation(models.Model):
    """Pre-aggregated energy data for reporting."""
    PERIOD_CHOICES = [
        ('hour', 'Hourly'),
        ('day', 'Daily'),
        ('month', 'Monthly'),
    ]
    
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='energy_aggregations')
    period_type = models.CharField(max_length=10, choices=PERIOD_CHOICES)
    period_start = models.DateTimeField()
    total_kwh = models.DecimalField(max_digits=12, decimal_places=4)
    avg_watts = models.DecimalField(max_digits=10, decimal_places=2)
    max_watts = models.DecimalField(max_digits=10, decimal_places=2)
    min_watts = models.DecimalField(max_digits=10, decimal_places=2)
    reading_count = models.IntegerField()
    
    class Meta:
        db_table = 'energy_aggregations'
        unique_together = ['classroom', 'period_type', 'period_start']
        ordering = ['-period_start']
    
    def __str__(self):
        return f"{self.classroom} - {self.period_type} - {self.period_start}"


class TeacherEnergyUsage(models.Model):
    """Tracks energy consumption attributed to each teacher's attendance sessions."""
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='energy_usage')
    attendance_session = models.OneToOneField(AttendanceSession, on_delete=models.CASCADE, related_name='energy_usage')
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='teacher_energy_usage')
    
    # Time period
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    duration_minutes = models.IntegerField()
    
    # Energy statistics
    avg_watts = models.DecimalField(max_digits=10, decimal_places=2)
    max_watts = models.DecimalField(max_digits=10, decimal_places=2)
    min_watts = models.DecimalField(max_digits=10, decimal_places=2)
    total_kwh = models.DecimalField(max_digits=12, decimal_places=4)
    reading_count = models.IntegerField()
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'teacher_energy_usage'
        ordering = ['-start_time']
        indexes = [
            models.Index(fields=['teacher', 'start_time']),
            models.Index(fields=['classroom', 'start_time']),
        ]
    
    def __str__(self):
        return f"{self.teacher} - {self.classroom} - {self.total_kwh} kWh"
