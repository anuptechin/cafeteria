#!/bin/sh
set -e

echo "[entrypoint] waiting for database..."
until node -e "const{Pool}=require('pg');new Pool({connectionString:process.env.DATABASE_URL}).query('select 1').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; do
  sleep 1
done

echo "[entrypoint] applying schema..."
npm -w server run db:setup

# Seed demo data (employees, devices, 60 days of punches, avatars) only when empty.
EMP=$(node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('select count(*)::int n from employees').then(r=>{console.log(r.rows[0].n);return p.end()}).catch(()=>{console.log('-1')})")
if [ "$EMP" = "0" ]; then
  echo "[entrypoint] empty database -> seeding demo data..."
  npm -w server run seed
else
  echo "[entrypoint] employees present ($EMP) -> skipping seed"
fi

echo "[entrypoint] starting API on :${PORT:-4000}"
exec npm -w server run start
