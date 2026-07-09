FROM python:3.11-slim

WORKDIR /srv/tenderpulse
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY tests ./tests

ENV TP_DATA_DIR=/srv/tenderpulse/data
VOLUME /srv/tenderpulse/data

EXPOSE 8000
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
