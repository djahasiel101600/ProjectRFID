import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from core.models import AttendanceSession
ids = [13,14,16,17,18,19]
for i in ids:
    s = AttendanceSession.objects.filter(id=i).first()
    if s:
        print(f'ID:{s.id} status:{s.status} time_in:{s.time_in} expected_out:{s.expected_out} time_out:{s.time_out}')
    else:
        print(f'ID:{i} missing')
