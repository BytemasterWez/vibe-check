"""Raw artifact storage: bytes land here BEFORE any transformation.

Two backends: local filesystem (dev/tests) and S3-compatible object storage
(MinIO in compose, S3 in cloud). Keys are content-addressed so re-ingesting
identical bytes is a no-op."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from engine.config import Settings, get_settings
from engine.provenance import content_hash


@dataclass
class StoredArtifact:
    key: str
    content_hash: str
    size_bytes: int


class ArtifactStore:
    def put(self, source_id: str, filename: str, data: bytes) -> StoredArtifact:
        raise NotImplementedError

    def get(self, key: str) -> bytes:
        raise NotImplementedError


class LocalArtifactStore(ArtifactStore):
    def __init__(self, root: Path):
        self.root = Path(root)

    def _key(self, source_id: str, filename: str, digest: str) -> str:
        return f"{source_id}/{digest[:12]}/{filename}"

    def put(self, source_id: str, filename: str, data: bytes) -> StoredArtifact:
        digest = content_hash(data)
        key = self._key(source_id, filename, digest)
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():          # immutability: never overwrite
            path.write_bytes(data)
        return StoredArtifact(key=key, content_hash=digest, size_bytes=len(data))

    def get(self, key: str) -> bytes:
        return (self.root / key).read_bytes()


class S3ArtifactStore(ArtifactStore):
    def __init__(self, settings: Settings):
        import boto3  # optional dependency (installed via extras: storage)

        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint or None,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )

    def put(self, source_id: str, filename: str, data: bytes) -> StoredArtifact:
        digest = content_hash(data)
        key = f"{source_id}/{digest[:12]}/{filename}"
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)
        return StoredArtifact(key=key, content_hash=digest, size_bytes=len(data))

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()


def get_store(settings: Settings | None = None) -> ArtifactStore:
    settings = settings or get_settings()
    if settings.object_store == "s3":
        return S3ArtifactStore(settings)
    return LocalArtifactStore(Path(settings.raw_dir))
