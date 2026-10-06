FROM python:3.11-alpine

RUN apk add --no-cache curl bash dos2unix

WORKDIR /app

COPY poll_sismico.sh .
COPY run_poll_loop.sh .
COPY capture_legacy_sources.sh .
COPY run_capture_loop.sh .
COPY capture_legacy_sources.py .

RUN dos2unix /app/*.sh && chmod +x /app/*.sh && mkdir -p /logs
RUN pip install --no-cache-dir requests

CMD ["/bin/bash", "/app/run_poll_loop.sh"]
