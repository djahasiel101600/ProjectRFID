# Running the project with Docker

Run the full stack (frontend, backend, Redis, Celery worker, Celery beat) on any machine with Docker installed.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

## Quick start

From the project root:

```bash
docker compose up --build -d
```

- **App (frontend + API):** http://localhost  
- **Django admin:** http://localhost/admin  

To create an admin user:

```bash
docker compose exec backend python manage.py createsuperuser
```

## Commands

| Command | Description |
|--------|-------------|
| `docker compose up -d` | Start all services in the background |
| `docker compose up --build -d` | Rebuild images and start |
| `docker compose down` | Stop and remove containers |
| `docker compose logs -f backend` | Follow backend logs |
| `docker compose exec backend python manage.py migrate` | Run migrations |

## Services

| Service | Role |
|---------|-----|
| **frontend** | React app (Vite build) served by nginx; proxies `/api` and `/ws` to backend. Port 80. |
| **backend** | Django + Daphne (ASGI). Runs migrations and collectstatic on startup. |
| **redis** | Redis for Celery broker and Channels. Port 6379. |
| **celery_worker** | Celery worker for async tasks. |
| **celery_beat** | Celery Beat (scheduler) using django-celery-beat. |

## Data

- **Database:** SQLite in Docker volume `backend_data` at `/app/data/db.sqlite3`.
- **Redis:** Data in volume `redis_data`.
- **Static files:** Collected into volume `backend_static`.

To reset the database (delete all data):

```bash
docker compose down -v
docker compose up -d
```

Then run migrations and create a superuser again.
