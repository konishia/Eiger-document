"""サンプル関連のPydanticスキーマ"""

from pydantic import BaseModel


class SampleCreate(BaseModel):
    name: str


class SampleResponse(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}
