#!/bin/bash
# Lanza Wikipedia ES full scope para los ~29k bienes restantes (sin heritage_world ni periodo).
# Resume automático: si ya hay bienes en BD_ES los salta.
# Duración estimada: ~5 horas. Mejor lanzar de noche.

cd /c/Users/usuario/Desktop/node2

LOG_FILE=/tmp/wikipedia_es_full.log

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Lanzando Wikipedia ES full scope..." > "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Esperados ~29k items, ETA ~5h" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

node _enriquecer_descripciones_wikipedia.cjs --apply >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] PROCESO TERMINADO" >> "$LOG_FILE"
