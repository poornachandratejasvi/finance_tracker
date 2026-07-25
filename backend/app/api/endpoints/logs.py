from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
import subprocess
import logging

from app.core.database import get_db
from app.api.endpoints.auth import get_current_admin_user
from app.models.models import User

router = APIRouter()
logger = logging.getLogger(__name__)

CONTAINER_NAMES = [
    "finance_tracker_backend",
    "finance_tracker_frontend",
    "finance_tracker_db",
    "finance_tracker_redis",
]


def _get_docker_logs(container: str, lines: int = 100) -> dict:
    """Try to get logs from a Docker container via docker CLI."""
    try:
        result = subprocess.run(
            ["docker", "logs", "--tail", str(lines), container],
            capture_output=True,
            text=True,
            timeout=10,
        )
        combined = (result.stdout or "") + (result.stderr or "")
        return {"container": container, "logs": combined, "status": "success"}
    except FileNotFoundError:
        return {"container": container, "logs": "", "status": "docker_not_found",
                "message": "docker CLI not available inside container"}
    except subprocess.TimeoutExpired:
        return {"container": container, "logs": "", "status": "timeout"}
    except Exception as exc:
        return {"container": container, "logs": "", "status": "error", "message": str(exc)}


@router.get("/backend")
def get_backend_logs(
    lines: int = 100,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get backend application logs (admin only)"""
    try:
        # Try reading from log file if it exists
        import os
        log_file = '/app/logs/app.log'
        if os.path.exists(log_file):
            with open(log_file, 'r') as f:
                all_lines = f.readlines()
                recent_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
                return {
                    "logs": ''.join(recent_lines),
                    "lines": len(recent_lines),
                    "status": "success",
                    "source": "log_file"
                }

        # Fall back to memory logger
        root_logger = logging.getLogger()
        log_entries = []
        for handler in root_logger.handlers:
            if hasattr(handler, 'buffer'):
                log_entries.extend(handler.buffer[-lines:])

        if log_entries:
            return {
                "logs": '\n'.join([str(record.getMessage()) for record in log_entries]),
                "lines": len(log_entries),
                "status": "success",
                "source": "memory"
            }

        # Try docker logs for the backend container
        docker_result = _get_docker_logs("finance_tracker_backend", lines)
        if docker_result["status"] == "success" and docker_result["logs"]:
            return {
                "logs": docker_result["logs"],
                "status": "success",
                "source": "docker"
            }

        return {
            "logs": "No application logs available yet.",
            "status": "not_configured"
        }
    except Exception as e:
        return {"error": str(e), "status": "error"}


@router.get("/containers")
def get_all_container_logs(
    lines: int = 100,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get logs from all Docker containers (admin only)"""
    results = {}
    for container in CONTAINER_NAMES:
        results[container] = _get_docker_logs(container, lines)
    return {"containers": results, "requested_lines": lines}


@router.get("/system")
def get_system_info(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get system information (admin only)"""
    try:
        import psutil
        return {
            "cpu_percent": psutil.cpu_percent(interval=1),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_percent": psutil.disk_usage('/').percent,
        }
    except ImportError:
        return {
            "message": "System monitoring not available",
            "info": "Install psutil for system metrics"
        }
