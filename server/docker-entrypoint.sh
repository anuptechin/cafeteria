#!/bin/sh
set -e

echo "[entrypoint] waiting for database..."
until node -e "const{Pool}=require('pg');new Pool({connectionString:process.env.DATABASE_URL}).query('select 1').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; do
  sleep 1
done

echo "[entrypoint] applying schema..."
npm -w server run db:setup

# Punch rows are inserted by the external Hikvision ingestion — no demo seed.
echo "[entrypoint] starting API on :${PORT:-4000}"
exec npm -w server run start
