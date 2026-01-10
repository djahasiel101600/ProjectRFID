from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, Classroom, Schedule, AttendanceSession, EnergyLog, EnergyAggregation


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ['username', 'email', 'first_name', 'last_name', 'role', 'rfid_uid', 'is_active']
    list_filter = ['role', 'is_active', 'is_staff']
    search_fields = ['username', 'email', 'first_name', 'last_name', 'rfid_uid']
    fieldsets = UserAdmin.fieldsets + (
        ('Additional Info', {'fields': ('role', 'rfid_uid')}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('Additional Info', {'fields': ('role', 'rfid_uid')}),
    )


@admin.register(Classroom)
class ClassroomAdmin(admin.ModelAdmin):
    list_display = ['name', 'device_id', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name', 'device_id']
    readonly_fields = ['created_at', 'updated_at']


@admin.register(Schedule)
class ScheduleAdmin(admin.ModelAdmin):
    list_display = ['teacher', 'classroom', 'day_of_week', 'start_time', 'end_time', 'subject']
    list_filter = ['day_of_week', 'classroom']
    search_fields = ['teacher__username', 'teacher__first_name', 'classroom__name', 'subject']


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ['teacher', 'classroom', 'date', 'time_in', 'time_out', 'status']
    list_filter = ['status', 'date', 'classroom']
    search_fields = ['teacher__username', 'teacher__first_name', 'classroom__name']
    date_hierarchy = 'date'
    readonly_fields = ['created_at']


@admin.register(EnergyLog)
class EnergyLogAdmin(admin.ModelAdmin):
    list_display = ['classroom', 'watts', 'timestamp']
    list_filter = ['classroom']
    date_hierarchy = 'timestamp'
    readonly_fields = ['created_at']


@admin.register(EnergyAggregation)
class EnergyAggregationAdmin(admin.ModelAdmin):
    list_display = ['classroom', 'period_type', 'period_start', 'total_kwh', 'avg_watts']
    list_filter = ['period_type', 'classroom']
    date_hierarchy = 'period_start'
