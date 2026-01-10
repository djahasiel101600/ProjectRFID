"""
Script to update user role to admin and list all users.
Run with: python update_admin.py
"""
import os
import sys
import django

# Add the backend directory to path
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# Temporarily modify settings to remove daphne if not installed
try:
    import daphne
except ImportError:
    # Daphne not installed, patch settings
    import backend.settings as settings
    if 'daphne' in settings.INSTALLED_APPS:
        settings.INSTALLED_APPS = [app for app in settings.INSTALLED_APPS if app != 'daphne']

django.setup()

from django.contrib.auth import get_user_model
User = get_user_model()

print("=" * 50)
print("Current Users:")
print("=" * 50)

users = User.objects.all()
if not users.exists():
    print("No users found!")
else:
    for user in users:
        print(f"  Username: {user.username}")
        print(f"  Role: {user.role}")
        print(f"  Is Superuser: {user.is_superuser}")
        print(f"  Is Staff: {user.is_staff}")
        print("-" * 30)

print("\n" + "=" * 50)
print("Updating all superusers to have admin role...")
print("=" * 50)

updated = User.objects.filter(is_superuser=True).update(role='admin')
print(f"Updated {updated} users to admin role")

# Also make sure staff can access admin panel
User.objects.filter(is_superuser=True).update(is_staff=True)

print("\n" + "=" * 50)
print("Updated Users:")
print("=" * 50)

for user in User.objects.all():
    print(f"  {user.username}: role={user.role}, superuser={user.is_superuser}, staff={user.is_staff}")

print("\nDone!")
