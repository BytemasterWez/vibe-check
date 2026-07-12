import os

from app.reliability.preflight import (
    CheckStatus,
    check_disk_space,
    check_drive_present,
    preflight_blocks_startup,
    run_preflight,
)


def test_missing_data_dir_fails_and_blocks(tmp_path):
    missing = str(tmp_path / "not_mounted")
    check = check_drive_present(missing)
    assert check.status is CheckStatus.FAIL
    assert preflight_blocks_startup([check]) is True


def test_present_dir_without_marker_warns(tmp_path):
    check = check_drive_present(str(tmp_path))
    assert check.status is CheckStatus.WARN


def test_present_dir_with_marker_ok(tmp_path):
    (tmp_path / ".repoforge_volume").write_text("mounted")
    check = check_drive_present(str(tmp_path))
    assert check.status is CheckStatus.OK


def test_external_drive_disappearance_blocks_startup(tmp_path):
    # Simulate the drive vanishing: dir that existed no longer does.
    data_dir = str(tmp_path / "vol")
    os.makedirs(data_dir)
    (tmp_path / "vol" / ".repoforge_volume").write_text("x")
    assert check_drive_present(data_dir).status is CheckStatus.OK
    os.remove(tmp_path / "vol" / ".repoforge_volume")
    os.rmdir(data_dir)  # drive gone
    checks = run_preflight(data_dir, min_free_gb=1)
    assert preflight_blocks_startup(checks) is True


def test_disk_space_check_fails_when_below_threshold(tmp_path):
    # Absurdly high threshold guarantees FAIL regardless of host.
    check = check_disk_space(str(tmp_path), min_free_gb=10_000_000)
    assert check.status is CheckStatus.FAIL


def test_filesystem_check_skipped_off_macos(tmp_path):
    # On Linux CI the APFS check is skipped, never a false failure.
    checks = run_preflight(str(tmp_path), min_free_gb=1)
    fs = next(c for c in checks if c.name == "postgres_filesystem")
    assert fs.status in (CheckStatus.SKIPPED, CheckStatus.OK, CheckStatus.WARN)
    assert fs.status is not CheckStatus.FAIL
