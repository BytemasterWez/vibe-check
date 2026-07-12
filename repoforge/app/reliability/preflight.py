"""Startup preflight checks.

The most important guard: PostgreSQL's data directory must live on an APFS
volume. If the external drive is exFAT/FAT32/NTFS we refuse to start the
database. On non-macOS hosts (CI, Linux dev) the APFS check is reported as
``skipped`` rather than failing, so the portable core still runs.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from enum import Enum

UNSUITABLE_FILESYSTEMS = {"exfat", "msdos", "fat", "fat32", "ntfs", "vfat"}


class CheckStatus(str, Enum):
    OK = "ok"
    WARN = "warn"
    FAIL = "fail"
    SKIPPED = "skipped"


@dataclass
class Check:
    name: str
    status: CheckStatus
    detail: str


def _macos() -> bool:
    return platform.system() == "Darwin"


def detect_filesystem(path: str) -> str | None:
    """Return the lowercased filesystem type for ``path`` on macOS, else None."""
    if not _macos():
        return None
    try:
        out = subprocess.run(
            ["diskutil", "info", path],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    for line in out.stdout.splitlines():
        if "Type (Bundle):" in line or "File System Personality:" in line:
            return line.split(":", 1)[1].strip().lower()
    return None


def check_filesystem(data_dir: str) -> Check:
    if not _macos():
        return Check(
            "postgres_filesystem",
            CheckStatus.SKIPPED,
            f"non-macOS host ({platform.system()}); APFS check skipped",
        )
    fs = detect_filesystem(data_dir)
    if fs is None:
        return Check(
            "postgres_filesystem",
            CheckStatus.WARN,
            f"could not determine filesystem for {data_dir}",
        )
    if "apfs" in fs:
        return Check("postgres_filesystem", CheckStatus.OK, f"{data_dir} is APFS")
    if any(bad in fs for bad in UNSUITABLE_FILESYSTEMS):
        return Check(
            "postgres_filesystem",
            CheckStatus.FAIL,
            f"{data_dir} is '{fs}' — unsuitable for PostgreSQL; reformat as APFS",
        )
    return Check("postgres_filesystem", CheckStatus.WARN, f"{data_dir} is '{fs}' (non-APFS)")


def check_drive_present(data_dir: str) -> Check:
    """Guard against a vanished external drive presenting an empty mount-point."""
    if not os.path.isdir(data_dir):
        return Check(
            "external_drive",
            CheckStatus.FAIL,
            f"data dir {data_dir} does not exist — external drive missing?",
        )
    # A drive that disappeared often leaves an empty mount-point on the internal
    # disk. Treat a marker file as proof the real volume is mounted.
    marker = os.path.join(data_dir, ".repoforge_volume")
    if os.path.exists(marker):
        return Check("external_drive", CheckStatus.OK, f"{data_dir} present with volume marker")
    return Check(
        "external_drive",
        CheckStatus.WARN,
        f"{data_dir} present but no .repoforge_volume marker (create it after mount)",
    )


def check_disk_space(data_dir: str, min_free_gb: int) -> Check:
    try:
        usage = shutil.disk_usage(data_dir if os.path.isdir(data_dir) else "/")
    except OSError as exc:
        return Check("disk_space", CheckStatus.WARN, f"cannot stat disk: {exc}")
    free_gb = usage.free / (1024**3)
    if free_gb < min_free_gb:
        return Check(
            "disk_space",
            CheckStatus.FAIL,
            f"only {free_gb:.1f}GB free, need {min_free_gb}GB",
        )
    return Check("disk_space", CheckStatus.OK, f"{free_gb:.1f}GB free")


def run_preflight(data_dir: str, min_free_gb: int) -> list[Check]:
    return [
        check_drive_present(data_dir),
        check_filesystem(data_dir),
        check_disk_space(data_dir, min_free_gb),
    ]


def preflight_blocks_startup(checks: list[Check]) -> bool:
    """A FAIL on the filesystem or drive check must block DB startup."""
    return any(
        c.status is CheckStatus.FAIL
        for c in checks
        if c.name in ("postgres_filesystem", "external_drive")
    )
