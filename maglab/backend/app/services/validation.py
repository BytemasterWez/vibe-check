"""Upload validation (Phase 7).

Responsibilities when built:
- reject uploads whose share_setting is private_local_only (must never
  arrive; defence in depth if a buggy client sends one),
- verify consent_version is present and current,
- verify sample timestamps are sane (every sample must have one),
- verify UUID referential integrity (samples -> run -> survey),
- drop or flag samples with impossible values (negative accuracy, etc.).
"""
