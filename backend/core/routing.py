from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/iot/classroom/(?P<classroom_id>\d+)/$', consumers.IoTConsumer.as_asgi()),
    re_path(r'ws/dashboard/classroom/(?P<classroom_id>\d+)/$', consumers.DashboardConsumer.as_asgi()),
    re_path(r'ws/dashboard/$', consumers.DashboardConsumer.as_asgi()),
]
