#!/bin/bash
# Espera a que termine Europeana --all y lanza completar Andalucía
cd /c/Users/usuario/Desktop/node2

echo "[$(date +'%Y-%m-%d %H:%M')] Watcher iniciado. Esperando fin de Europeana --all..." >> /tmp/europeana_andalucia_watcher.log

# Polling cada 60s hasta detectar el final real del apply (mensaje "✓ N imágenes insertadas")
while true; do
  if grep -qE "^✓ [0-9]+ imágenes insertadas" /tmp/europeana_all.log 2>/dev/null; then
    echo "[$(date +'%Y-%m-%d %H:%M')] Europeana --all terminado (INSERT incluido). Lanzando Andalucía..." >> /tmp/europeana_andalucia_watcher.log
    break
  fi
  sleep 60
done

# Lanzar Andalucía completar (items sin imagen, sin heritage_world ni periodo)
node _enriquecer_europeana.cjs --completar --ccaa='Andalucía' --apply > /tmp/europeana_andalucia.log 2>&1

echo "[$(date +'%Y-%m-%d %H:%M')] Andalucía terminado." >> /tmp/europeana_andalucia_watcher.log
