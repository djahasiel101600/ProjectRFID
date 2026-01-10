from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    LoginView, LogoutView, UserViewSet, ClassroomViewSet,
    ScheduleViewSet, AttendanceSessionViewSet, EnergyLogViewSet,
    EnergyReportView, DashboardView
)

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'classrooms', ClassroomViewSet)
router.register(r'schedules', ScheduleViewSet)
router.register(r'attendance', AttendanceSessionViewSet)
router.register(r'energy-logs', EnergyLogViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login/', LoginView.as_view(), name='login'),
    path('auth/logout/', LogoutView.as_view(), name='logout'),
    path('energy/report/', EnergyReportView.as_view(), name='energy-report'),
    path('dashboard/', DashboardView.as_view(), name='dashboard'),
]
