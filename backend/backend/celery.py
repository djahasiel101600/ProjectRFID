from __future__ import absolute_import, unicode_literals
import os
from celery import Celery
from django.conf import settings

# Set the default Django settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

app = Celery('backend')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django app configs.
app.autodiscover_tasks()

# Timezone configuration
app.conf.timezone = settings.TIME_ZONE
app.conf.enable_utc = settings.CELERY_ENABLE_UTC

@app.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')