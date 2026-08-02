FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run sets $PORT; gunicorn binds to it.
ENV PORT=8080
EXPOSE 8080

CMD exec gunicorn --bind 0.0.0.0:${PORT} --worker-class gthread --workers 2 --threads 4 --timeout 0 app:app
