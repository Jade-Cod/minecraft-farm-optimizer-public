FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    TZ=America/Los_Angeles

RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

VOLUME ["/app/backend/data"]

EXPOSE 8000

WORKDIR /app/backend
# --proxy-headers: trust X-Forwarded-For from Caddy so rate limits and
# analytics see the real client IP, not the proxy's. Safe because in the
# deploy compose the app port is only reachable from the docker network.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
