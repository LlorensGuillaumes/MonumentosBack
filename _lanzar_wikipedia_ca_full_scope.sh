#!/bin/bash
# Lanza Wikipedia CA full scope para los ~10k bienes catalanes restantes
# (sin heritage_world ni periodo). Resume automático: salta los ya en BD_CA.
# Duración estimada: ~2 horas. Mejor lanzar de noche.

cd /c/Users/usuario/Desktop/node2

LOG_FILE=/tmp/wikipedia_ca_full.log

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Lanzando Wikipedia CA full scope..." > "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Resuelve títulos CA via Wikidata sitelinks (batches 50)" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Esperados ~10k items con artículo CA, ETA ~2h" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

node _enriquecer_descripciones_wikipedia.cjs --target-lang=ca --apply >> "$LOG_FILE" 2>&1

echo "" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] PROCESO CA TERMINADO" >> "$LOG_FILE"
