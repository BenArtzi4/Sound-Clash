"""Genre response model."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class GenreOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    name: str
    slug: str
