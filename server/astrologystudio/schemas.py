"""
AstrologyStudio ·
server/astrologystudio/schemas.py

Shared request-model plumbing.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class Strict(BaseModel):
    """Request bodies reject unknown fields, so typos fail loudly instead of being ignored."""

    model_config = ConfigDict(extra="forbid")


def normalise_email(email: str) -> str:
    return email.strip().lower()
