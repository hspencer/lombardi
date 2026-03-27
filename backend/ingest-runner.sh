#!/bin/bash
# Runner resiliente: reinicia ingest.js cuando muere
cd "$(dirname "$0")/.."
LOG=/tmp/os_ingest.log

while true; do
    PENDING=$(ls data/raw_news/*.json 2>/dev/null | wc -l | tr -d ' ')
    if [ "$PENDING" = "0" ]; then
        echo "$(date): Todas las noticias procesadas." >> $LOG
        break
    fi
    echo "$(date): Iniciando ingesta ($PENDING pendientes)..." >> $LOG
    timeout 300 node backend/ingest.js >> $LOG 2>&1
    EXIT=$?
    echo "$(date): Proceso terminó con código $EXIT. Reiniciando en 5s..." >> $LOG
    sleep 5
done
