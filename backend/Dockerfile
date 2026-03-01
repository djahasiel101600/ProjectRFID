# Celery worker & beat - Django backend
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Install deps from requirements + Celery stack (commented in requirements.txt)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir celery django-celery-beat redis

COPY . .

# Default command (overridden by docker-compose for worker/beat)
CMD ["celery", "-A", "backend", "worker", "-l", "info"]
