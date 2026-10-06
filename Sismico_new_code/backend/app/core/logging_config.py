import logging


def configure_logging():
    from app.core.config import settings

    configured_level = getattr(settings, "LOG_LEVEL", None)
    if configured_level is None:
        configured_level = getattr(settings, "log_level", "INFO")

    level = getattr(logging, str(configured_level).upper(), logging.INFO)

    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    logging.getLogger("uvicorn").setLevel(level)
    logging.getLogger("uvicorn.error").setLevel(level)
    logging.getLogger("uvicorn.access").setLevel(level)