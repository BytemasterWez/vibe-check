from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from . import config
from .models import Base

_engine = None
_SessionLocal = None


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        config.ensure_dirs()
        _engine = create_engine(config.DATABASE_URL, future=True)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
        Base.metadata.create_all(_engine)
    return _engine


@contextmanager
def session() -> Session:
    get_engine()
    s = _SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def reset_for_tests(url: str) -> None:
    """Point the app at a throwaway database (used by the test suite)."""
    global _engine, _SessionLocal
    config.DATABASE_URL = url
    _engine = None
    _SessionLocal = None
    get_engine()
