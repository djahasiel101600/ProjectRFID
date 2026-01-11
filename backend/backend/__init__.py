"""
Backend package initialization.

This module ensures the Celery app is loaded when Django starts,
so that @shared_task decorators work correctly.
"""

# Import Celery app so it's loaded when Django starts
from .celery import app as celery_app

__all__ = ('celery_app',)
