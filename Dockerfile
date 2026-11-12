FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Train the models while building the image, so the pickles always match the
# scikit-learn version installed above.
RUN python train_model.py

# Run as a non-root user; /data holds the SQLite database (mount a volume here).
RUN useradd --create-home appuser && mkdir -p /data /app/instance && chown -R appuser /data /app/instance
USER appuser

ENV DATABASE_PATH=/data/app.db \
    COOKIE_SECURE=0 \
    PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 2 --timeout 60 'app:create_app()'"]
