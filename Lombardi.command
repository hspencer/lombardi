#!/bin/bash
# Lombardi — double-click to launch
cd "$(dirname "$0")"

echo "==============================="
echo "  Lombardi"
echo "==============================="
echo ""

# 1. Docker (Apache AGE)
echo "Starting database..."
docker compose up -d 2>/dev/null
until docker exec os_database pg_isready -U os_admin -d lombardi > /dev/null 2>&1; do
    sleep 1
done
echo "Database ready."

# 2. Kill previous API if running
lsof -ti:3000 | xargs kill 2>/dev/null

# 3. Start API server
node backend/api.js &
API_PID=$!
sleep 1

# 4. Open browser
open http://localhost:3000

echo ""
echo "Lombardi running at http://localhost:3000"
echo "Close this window to stop."
echo ""
wait $API_PID
