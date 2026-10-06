from fastapi import APIRouter
from .endpoints.graphics import router as graphics_router
from .endpoints.climate import router as climate_router
from .endpoints.common import router as common_router
from .endpoints.data_api import router as data_api_router
from .endpoints.maps import router as maps_router
from .endpoints.reports import router as reports_router
from .endpoints.transfers import router as transfers_router
from .endpoints.visualization import router as visualizations_router

router = APIRouter()

router.include_router(graphics_router, prefix="/graphics", tags=["Graphics"])
router.include_router(climate_router, prefix="/climate", tags=["Climate"])
router.include_router(common_router, prefix="/common", tags=["Common"])
router.include_router(data_api_router, prefix="/data-api", tags=["Data API"])
router.include_router(maps_router, prefix="/maps", tags=["Maps"])
router.include_router(reports_router, prefix="/reports", tags=["Reports"])
router.include_router(transfers_router, prefix="/transfers", tags=["Transfers"])
router.include_router(visualizations_router, prefix="/visual", tags=["Visualizations"])
