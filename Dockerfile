FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        curl \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN python -m pip install --upgrade pip \
    && python -m pip install --requirement requirements.txt

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent --show-error \
        "http://127.0.0.1:${X_ZOHO_CATALYST_LISTEN_PORT:-9000}/_stcore/health" \
        || exit 1

CMD ["sh", "-c", "python -m streamlit run dashboard/app.py --server.address=0.0.0.0 --server.port=${X_ZOHO_CATALYST_LISTEN_PORT:-9000} --server.headless=true --server.fileWatcherType=none --browser.gatherUsageStats=false --server.enableWebsocketCompression=false"]
