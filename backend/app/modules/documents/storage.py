"""Object storage (local filesystem for development, S3-compatible for production) and the upload scanner."""

from __future__ import annotations

import os
import socket
import struct
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

# Magic-byte allow-list. Office formats are ZIP containers; we accept them only with the matching extension.
SIGNATURES = [
    (b"%PDF-", "application/pdf", {".pdf"}),
    (b"\x89PNG\r\n\x1a\n", "image/png", {".png"}),
    (b"\xff\xd8\xff", "image/jpeg", {".jpg", ".jpeg"}),
    (b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", {".docx"}),
    (b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", {".xlsx"}),
]
TEXT_TYPES = {".txt": "text/plain", ".csv": "text/csv"}


def sniff_type(head: bytes, filename: str) -> str | None:
    ext = Path(filename).suffix.lower()
    for magic, mime, exts in SIGNATURES:
        if head.startswith(magic) and ext in exts:
            return mime
    if ext in TEXT_TYPES:
        try:
            head.decode("utf-8")
        except UnicodeDecodeError:
            return None
        if b"\x00" in head:
            return None
        return TEXT_TYPES[ext]
    return None


@dataclass
class ScanResult:
    status: str  # CLEAN | REJECTED | QUARANTINED (scanner unavailable)
    detail: str


def scan(data: bytes) -> ScanResult:
    settings = get_settings()
    if settings.scanner == "clamav":
        return _clamd_scan(data, settings.clamav_host, settings.clamav_port)
    if EICAR in data:
        return ScanResult("REJECTED", "Malware test signature (EICAR) detected")
    return ScanResult("CLEAN", "Built-in development scanner (EICAR signature only) — use ClamAV in production")


def _clamd_scan(data: bytes, host: str, port: int) -> ScanResult:
    try:
        with socket.create_connection((host, port), timeout=10) as s:
            s.sendall(b"zINSTREAM\0")
            for i in range(0, len(data), 64 * 1024):
                chunk = data[i : i + 64 * 1024]
                s.sendall(struct.pack(">I", len(chunk)) + chunk)
            s.sendall(struct.pack(">I", 0))
            reply = s.recv(4096).decode(errors="replace").strip("\0\n ")
    except OSError as exc:
        return ScanResult("QUARANTINED", f"Scanner unavailable: {exc.__class__.__name__}")
    if reply.endswith("OK"):
        return ScanResult("CLEAN", "ClamAV: no threats found")
    return ScanResult("REJECTED", f"ClamAV: {reply.split(':', 1)[-1].strip()}")


class LocalStore:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root) + os.sep):
            raise ValueError("invalid object key")
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(p)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def move(self, src: str, dst: str) -> None:
        target = self._path(dst)
        target.parent.mkdir(parents=True, exist_ok=True)
        self._path(src).replace(target)

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3Store:
    def __init__(self) -> None:
        import boto3  # optional dependency

        s = get_settings()
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint_url,
            aws_access_key_id=s.s3_access_key.get_secret_value() if s.s3_access_key else None,
            aws_secret_access_key=s.s3_secret_key.get_secret_value() if s.s3_secret_key else None,
        )

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ServerSideEncryption="AES256")

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def move(self, src: str, dst: str) -> None:
        self.client.copy_object(
            Bucket=self.bucket, Key=dst, CopySource={"Bucket": self.bucket, "Key": src}, ServerSideEncryption="AES256"
        )
        self.client.delete_object(Bucket=self.bucket, Key=src)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


_store = None


def store():
    global _store
    if _store is None:
        s = get_settings()
        _store = S3Store() if s.storage_backend == "s3" else LocalStore(s.storage_path)
    return _store


def new_key(prefix: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()[:8]
    return f"{prefix}/{uuid.uuid4().hex}{ext}"
