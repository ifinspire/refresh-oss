FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY web ./web
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log", "--no-proxy-headers"]
FROM runtime AS tests
COPY tests ./tests
ENV DATA_DIR=/tmp/refresh-tests
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]
FROM runtime AS production
