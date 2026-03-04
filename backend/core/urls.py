from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    LoginView, LogoutView, SetupStatusView, RegisterView,
    UserViewSet, ClassroomViewSet,
    ScheduleViewSet, AttendanceSessionViewSet, EnergyLogViewSet,
    EnergyReportView, DashboardView, TeacherEnergyViewSet, OverrideRFIDViewSet
)

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'classrooms', ClassroomViewSet)
router.register(r'schedules', ScheduleViewSet)
router.register(r'attendance', AttendanceSessionViewSet)
router.register(r'energy-logs', EnergyLogViewSet)
router.register(r'teacher-energy', TeacherEnergyViewSet, basename='teacher-energy')
router.register(r'override-rfids', OverrideRFIDViewSet, basename='override-rfid')

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login/', LoginView.as_view(), name='login'),
    path('auth/logout/', LogoutView.as_view(), name='logout'),
    path('auth/setup-status/', SetupStatusView.as_view(), name='setup-status'),
    path('auth/register/', RegisterView.as_view(), name='register'),
    path('energy/report/', EnergyReportView.as_view(), name='energy-report'),
    path('dashboard/', DashboardView.as_view(), name='dashboard'),
]
