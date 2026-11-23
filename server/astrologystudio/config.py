"""
AstrologyStudio ·
server/astrologystudio/config.py

Runtime configuration.

Every setting has a working default so `docker run` needs no environment
variables. Override with ASTROLOGYSTUDIO_* variables where needed.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# In a source checkout the built web app sits at web/dist; the Docker image copies it to /app/web.
_REPO_WEB = Path(__file__).resolve().parents[2] / "web" / "dist"


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    """Holds the database, the secret key and backups. Mounted as a volume in Docker."""

    base_url: str = "http://localhost:8080"
    """Public address of this install. Set by the installer."""

    web_dir: Path = field(default=_REPO_WEB)
    """The built web app (`web/dist`)."""

    ephemeral_url: str = ""
    """Default ephemeralREST address, used until the owner sets one in Settings."""

    hosted: bool = False
    """A hosted service: people who sign up never see ephemeralREST (its address, keys or name).
    Their account and key are made when they register, so there's nothing for them to set up."""

    @property
    def secure_cookies(self) -> bool:
        return self.base_url.startswith("https://")

    @property
    def database_path(self) -> Path:
        return self.data_dir / "astrologystudio.db"

    @property
    def secret_path(self) -> Path:
        return self.data_dir / "secret.key"

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backups"

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            data_dir=Path(os.environ.get("ASTROLOGYSTUDIO_DATA_DIR", "./data")).resolve(),
            base_url=os.environ.get("ASTROLOGYSTUDIO_BASE_URL", "http://localhost:8080").rstrip("/"),
            web_dir=Path(os.environ.get("ASTROLOGYSTUDIO_WEB_DIR", str(_REPO_WEB))).resolve(),
            ephemeral_url=os.environ.get("ASTROLOGYSTUDIO_EPHEMERAL_URL", "").strip().rstrip("/"),
            hosted=os.environ.get("ASTROLOGYSTUDIO_HOSTED", "").strip().lower() in ("1", "true", "yes", "on"),
        )
