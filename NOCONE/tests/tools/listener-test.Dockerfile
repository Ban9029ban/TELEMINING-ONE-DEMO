FROM python:3.11-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl gcc \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY listener/requirements-test.txt /tmp/listener-requirements-test.txt
RUN pip install --no-cache-dir -r /tmp/listener-requirements-test.txt
