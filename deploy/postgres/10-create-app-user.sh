#!/bin/sh
set -eu

# install.sh generates hexadecimal secrets, safe to pass as a SQL variable.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE xmesh_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE xmesh TO xmesh_app;
GRANT USAGE, CREATE ON SCHEMA public TO xmesh_app;
SQL
