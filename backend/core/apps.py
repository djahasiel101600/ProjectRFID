from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'
    verbose_name = 'Core Application'
    
    def ready(self):
        """
        Configure SQLite for better concurrency when the app starts.
        """
        from django.db import connection
        from django.db.backends.signals import connection_created
        
        def configure_sqlite(sender, connection, **kwargs):
            """Set SQLite pragmas for better concurrency handling."""
            if connection.vendor == 'sqlite':
                cursor = connection.cursor()
                # Enable WAL mode for better concurrent read/write
                cursor.execute('PRAGMA journal_mode=WAL;')
                # Set busy timeout to 30 seconds
                cursor.execute('PRAGMA busy_timeout=30000;')
                # Synchronous mode for balance between safety and speed
                cursor.execute('PRAGMA synchronous=NORMAL;')
                # Increase cache size (negative = KB, so -64000 = 64MB)
                cursor.execute('PRAGMA cache_size=-64000;')
        
        connection_created.connect(configure_sqlite)
    
