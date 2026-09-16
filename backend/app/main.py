"""サンプル CRUD API"""

import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import get_db
from models import SampleModel
from schemas import SampleCreate, SampleResponse

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app = FastAPI(title="Sample API", version="1.0.0")

# CORS設定（フロントエンドからのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {"status": "healthy"}


# ---------- Samples CRUD （サンプル） ----------


@app.get("/samples", response_model=list[SampleResponse])
def get_samples(db: Session = Depends(get_db)):
    """サンプル一覧を取得する"""
    return db.query(SampleModel).all()


@app.post("/samples", response_model=SampleResponse, status_code=201)
def create_sample(sample: SampleCreate, db: Session = Depends(get_db)):
    """サンプルを追加する"""
    db_sample = SampleModel(name=sample.name)
    db.add(db_sample)
    db.commit()
    db.refresh(db_sample)
    return db_sample


@app.delete("/samples/{sample_id}", status_code=204)
def delete_sample(sample_id: int, db: Session = Depends(get_db)):
    """サンプルを削除する"""
    sample = db.query(SampleModel).filter(SampleModel.id == sample_id).first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    db.delete(sample)
    db.commit()
