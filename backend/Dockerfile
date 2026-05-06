# Sound Clash backend — multi-stage Dockerfile.
# Builder installs into a venv, runtime image copies it and runs as non-root.
# Render sets $PORT at runtime; uvicorn picks it up.
# See docs/tech-stack.md and docs/local-development.md for context.

# ---- builder ----
FROM python:3.11-slim AS builder

WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir -e .

# ---- runtime ----
FROM python:3.11-slim AS runtime

# Non-root user
RUN useradd --create-home --shell /bin/bash app
USER app
WORKDIR /home/app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

# Render sets PORT; uvicorn picks it up.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
