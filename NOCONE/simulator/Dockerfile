FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app
CMD ["python", "simulator.py", "--mode", "http", "--rate", "10", "--entities", "6", "--target", "http://listener:8080"]
