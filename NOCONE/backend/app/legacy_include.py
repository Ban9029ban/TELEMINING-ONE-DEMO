# Glue layer to include legacy Telemining routers
from fastapi import APIRouter
# Import legacy urls router
try:
    from app.legacy.telemining.urls import router as legacy_router
except Exception as e:
    legacy_router = APIRouter()
    @legacy_router.get("/_legacy_import_error")
    def legacy_error():
        return {"error": str(e)}
router = legacy_router