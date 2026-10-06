FROM python:3.11-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl gcc libpq-dev git \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY backend/requirements-test.txt /tmp/backend-requirements-test.txt
RUN pip install --no-cache-dir -r /tmp/backend-requirements-test.txt
