from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.services.productivity_service import ProductivityService

router = APIRouter()


@router.get("/filters")
def filters(db: Session = Depends(get_db)):
    return ProductivityService(db).get_filters()


@router.get("/dashboard")
def dashboard(
    site_code: Optional[str] = None,
    map_code: Optional[str] = None,
    range_key: str = "7d",
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    interval: str = "auto",
    top_n: int = 8,
    db: Session = Depends(get_db),
):
    return ProductivityService(db).get_dashboard(
        site_code=site_code,
        map_code=map_code,
        range_key=range_key,
        date_from=date_from,
        date_to=date_to,
        interval=interval,
        top_n=top_n,
    )


@router.get("/summary")
def summary(
    site_code: Optional[str] = None,
    map_code: Optional[str] = None,
    range_key: str = "7d",
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    interval: str = "auto",
    top_n: int = 8,
    db: Session = Depends(get_db),
):
    return ProductivityService(db).get_summary_legacy(
        site_code=site_code,
        map_code=map_code,
        range_key=range_key,
        date_from=date_from,
        date_to=date_to,
        interval=interval,
        top_n=top_n,
    )


@router.get("/chart")
@router.get("/seismic-chart")
def seismic_chart(
    site_code: Optional[str] = None,
    map_code: Optional[str] = None,
    range_key: str = "7d",
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    interval: str = "auto",
    top_n: int = 8,
    db: Session = Depends(get_db),
):
    return ProductivityService(db).get_chart_legacy(
        site_code=site_code,
        map_code=map_code,
        range_key=range_key,
        date_from=date_from,
        date_to=date_to,
        interval=interval,
        top_n=top_n,
    )
