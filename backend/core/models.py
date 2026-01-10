from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone


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


class AttendanceSession(models.Model):
    """Records teacher attendance sessions."""
    STATUS_CHOICES = [
        ('IN', 'Timed In'),
        ('AUTO_OUT', 'Auto Timed Out'),
        ('INVALID', 'Invalid'),
    ]
    
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='attendance_sessions')
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='attendance_sessions')
    schedule = models.ForeignKey(Schedule, on_delete=models.SET_NULL, null=True, blank=True, related_name='attendance_sessions')
    date = models.DateField()
    time_in = models.DateTimeField()
    time_out = models.DateTimeField(null=True, blank=True)
    expected_out = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='IN')
    rfid_uid_used = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'attendance_sessions'
        ordering = ['-date', '-time_in']
    
    def __str__(self):
        return f"{self.teacher} - {self.classroom} ({self.date} {self.status})"


class EnergyLog(models.Model):
    """Records power consumption readings from ESP32 devices."""
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE, related_name='energy_logs')
    watts = models.DecimalField(max_digits=10, decimal_places=2)
    timestamp = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'energy_logs'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['classroom', 'timestamp']),
            models.Index(fields=['timestamp']),
        ]
    
    def __str__(self):
        return f"{self.classroom} - {self.watts}W @ {self.timestamp}"


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
