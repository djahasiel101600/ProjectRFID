"""
Run frontend (Vite), Celery worker, and Daphne from one script.

Usage (from project root):
  py -3 scripts\run_services.py

Options:
  --no-frontend    don't start frontend
  --no-celery      don't start celery
  --no-daphne      don't start daphne

The script starts each service in its directory and streams logs prefixed by service name.
"""
import sys
import os
import shutil
import subprocess
import threading
import signal
import time
from argparse import ArgumentParser

def resolve_project_dirs():
    """Resolve project root, frontend and backend directories robustly.

    Tries a few likely candidate locations relative to this script so the
    script can be run from either the project root or the `scripts/` folder.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        script_dir,
        os.path.dirname(script_dir),
        os.path.dirname(os.path.dirname(script_dir)),
    ]

    project_root = None
    frontend = None
    backend = None

    for cand in candidates:
        cand_backend = os.path.join(cand, 'backend')
        cand_frontend = os.path.join(cand, 'aem')
        if os.path.isdir(cand_backend) or os.path.isdir(cand_frontend):
            project_root = cand
            if os.path.isdir(cand_frontend):
                frontend = cand_frontend
            if os.path.isdir(cand_backend):
                backend = cand_backend
            # prefer a candidate that has both
            if frontend and backend:
                break

    # Fallback: assume project root is parent of script
    if project_root is None:
        project_root = os.path.dirname(script_dir)
        cand_backend = os.path.join(project_root, 'backend')
        cand_frontend = os.path.join(project_root, 'aem')
        if os.path.isdir(cand_backend):
            backend = cand_backend
        if os.path.isdir(cand_frontend):
            frontend = cand_frontend

    return project_root, frontend, backend


PROJECT_ROOT, FRONTEND_DIR, BACKEND_DIR = resolve_project_dirs()

processes = []
stop_event = False


def stream_proc(proc, name):
    try:
        for line in proc.stdout:
            print(f"[{name}] {line.rstrip()}")
    except Exception:
        pass


def start_process(cmd, cwd, name, shell=False):
    # Use the same Python interpreter for Celery/Daphne (sys.executable)
    env = os.environ.copy()
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
            shell=shell,
        )
    except FileNotFoundError as e:
        print(f'[{name}] Failed to start process. File not found: {e}')
        return None
    except OSError as e:
        print(f'[{name}] Failed to start process: {e}')
        return None

    t = threading.Thread(target=stream_proc, args=(proc, name), daemon=True)
    t.start()
    processes.append((proc, name))
    return proc


def find_node_cmd():
    # prefer npm, pnpm, or yarn
    for cmd in ('npm', 'pnpm', 'yarn'):
        if shutil.which(cmd):
            return cmd
    return None


def start_frontend():
    node_cmd = find_node_cmd()
    if not node_cmd:
        print('[frontend] No npm/pnpm/yarn found in PATH; skipping frontend')
        return None

    # Prefer 'npm run dev' as common Vite script
    if node_cmd in ('npm', 'pnpm'):
        list_cmd = [node_cmd, 'run', 'dev']
        str_cmd = f"{node_cmd} run dev"
    else:
        # yarn
        list_cmd = [node_cmd, 'dev']
        str_cmd = f"{node_cmd} dev"

    if not FRONTEND_DIR or not os.path.isdir(FRONTEND_DIR):
        print(f'[frontend] Frontend directory not found ({FRONTEND_DIR}); skipping frontend')
        return None

    # On Windows, prefer running the command through the shell so that
    # npm/pnpm/yarn shims (npm.cmd) are resolved correctly.
    use_shell = os.name == 'nt'
    if use_shell:
        print(f'[frontend] Starting: {str_cmd} in {FRONTEND_DIR} (shell)')
        return start_process(str_cmd, FRONTEND_DIR, 'frontend', shell=True)
    else:
        print(f'[frontend] Starting: {" ".join(list_cmd)} in {FRONTEND_DIR}')
        return start_process(list_cmd, FRONTEND_DIR, 'frontend')


def start_celery():
    py = sys.executable or 'py'
    # module path: backend.celery:app
    cmd = [py, '-m', 'celery', '-A', 'backend.celery:app', 'worker', '--loglevel=info', '--pool=solo']
    if not BACKEND_DIR or not os.path.isdir(BACKEND_DIR):
        print(f'[celery] Backend directory not found ({BACKEND_DIR}); skipping celery')
        return None
    print(f'[celery] Starting: {" ".join(cmd)} in {BACKEND_DIR}')
    return start_process(cmd, BACKEND_DIR, 'celery')


def start_daphne():
    py = sys.executable or 'py'
    cmd = [py, '-m', 'daphne', '-b', '0.0.0.0', '-p', '8000', 'backend.asgi:application']
    if not BACKEND_DIR or not os.path.isdir(BACKEND_DIR):
        print(f'[daphne] Backend directory not found ({BACKEND_DIR}); skipping daphne')
        return None
    print(f'[daphne] Starting: {" ".join(cmd)} in {BACKEND_DIR}')
    return start_process(cmd, BACKEND_DIR, 'daphne')


def shutdown():
    print('\n[manager] Shutting down services...')
    for proc, name in processes:
        try:
            print(f'[manager] Terminating {name} (pid={proc.pid})')
            proc.terminate()
        except Exception:
            pass
    # wait a short time, then kill if still alive
    for proc, name in processes:
        try:
            proc.wait(timeout=5)
        except Exception:
            try:
                print(f'[manager] Killing {name} (pid={proc.pid})')
                proc.kill()
            except Exception:
                pass
    print('[manager] All processes stopped')


def main():
    parser = ArgumentParser()
    parser.add_argument('--no-frontend', action='store_true')
    parser.add_argument('--no-celery', action='store_true')
    parser.add_argument('--no-daphne', action='store_true')
    args = parser.parse_args()

    # ensure working directories exist; if missing, services will be skipped
    if not BACKEND_DIR or not os.path.isdir(BACKEND_DIR):
        print(f'[warning] backend dir not found: {BACKEND_DIR}; backend services will be skipped')
    if not FRONTEND_DIR or not os.path.isdir(FRONTEND_DIR):
        print(f'[warning] frontend dir not found: {FRONTEND_DIR}; frontend service will be skipped')

    try:
        if not args.no_frontend:
            start_frontend()
        if not args.no_celery:
            start_celery()
        if not args.no_daphne:
            start_daphne()

        # handle signals
        def _signal_handler(sig, frame):
            shutdown()
            sys.exit(0)

        signal.signal(signal.SIGINT, _signal_handler)
        try:
            signal.signal(signal.SIGTERM, _signal_handler)
        except Exception:
            pass

        # wait until processes exit
        while True:
            alive = False
            for proc, name in processes:
                if proc.poll() is None:
                    alive = True
            if not alive:
                print('[manager] All processes exited')
                break
            if hasattr(signal, 'pause'):
                signal.pause()
            else:
                time.sleep(1)

    except KeyboardInterrupt:
        shutdown()


if __name__ == '__main__':
    main()
