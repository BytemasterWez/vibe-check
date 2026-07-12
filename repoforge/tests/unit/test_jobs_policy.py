from app.scheduler.jobs import (
    BASE_BACKOFF_SECONDS,
    MAX_BACKOFF_SECONDS,
    backoff_delay,
    should_dead_letter,
)


def test_backoff_is_exponential_and_capped():
    assert backoff_delay(1) == BASE_BACKOFF_SECONDS
    assert backoff_delay(2) == BASE_BACKOFF_SECONDS * 2
    assert backoff_delay(3) == BASE_BACKOFF_SECONDS * 4
    assert backoff_delay(100) == MAX_BACKOFF_SECONDS  # capped
    assert backoff_delay(0) == BASE_BACKOFF_SECONDS


def test_dead_letter_threshold():
    assert should_dead_letter(attempts=5, max_attempts=5) is True
    assert should_dead_letter(attempts=6, max_attempts=5) is True
    assert should_dead_letter(attempts=4, max_attempts=5) is False
