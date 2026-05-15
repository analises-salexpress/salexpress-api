#!/bin/bash
set -e

SYNC_DIR="$(dirname "$0")"
LOG_FILE="$SYNC_DIR/sync.log"
MAX_LOG_LINES=500

cd "$SYNC_DIR"

echo "========================================" >> "$LOG_FILE"
echo "Sync iniciado: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"

# Testa conexão com MySQL antes de rodar
if ! node -e "
const mysql = require('mysql2/promise');
mysql.createConnection({
  host: '192.168.100.19', port: 3306,
  user: 'joaopenha', password: '92yW617&pQyI',
  database: 'bexsal_dw', connectTimeout: 5000
}).then(c => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; then
  echo "AVISO: MySQL não acessível (fora da rede da empresa?) — sync pulado." >> "$LOG_FILE"
  exit 0
fi

npm run sync >> "$LOG_FILE" 2>&1
echo "Sync concluído: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"

# Mantém somente as últimas 500 linhas do log
tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
