import logging
import os

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging() -> None:
    """Makes the app's own loggers (`app.*`) visible when it runs under uvicorn, which configures
    only its own. `LOG_LEVEL` (default INFO) sets how much; an application that already set up
    root logging (pytest, a host process) is left alone."""
    app_logger = logging.getLogger("app")
    app_logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
    if not logging.getLogger().handlers and not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(FORMAT))
        app_logger.addHandler(handler)
