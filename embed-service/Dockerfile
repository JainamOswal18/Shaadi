FROM python:3.11-slim

# System libs InsightFace/opencv need at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV INSIGHTFACE_HOME=/root/.insightface
# Warm the model into the image layer so the first request isn't a cold download.
RUN python -c "import app; app._get_app(); print('model ready')"

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
