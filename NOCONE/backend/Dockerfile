FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg iputils-ping && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

# Normaliza CRLF->LF para evitar fallas al clonar en Windows y ejecuta el script con /bin/sh.
# Esto evita depender de bash dentro de la imagen base slim.
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh
CMD ["/bin/sh", "/app/start.sh"]
