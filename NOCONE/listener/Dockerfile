FROM python:3.11-slim

# Evita problemas de stdout con buffers
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copiamos requirements y los instalamos
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos el código del listener
COPY app /app/app

# Variables por defecto (las puedes sobreescribir en docker-compose)
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=8090
ENV TCP_HOST=0.0.0.0
ENV TCP_PORT=7070

EXPOSE 8090 7070

# Arrancar la web del listener; el 7070 se abre desde el startup de la app.
CMD ["sh", "-lc", "uvicorn app.main:app --host 0.0.0.0 --port ${HTTP_PORT:-8090}"]
