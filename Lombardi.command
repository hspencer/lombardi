#!/bin/bash
# Lombardi — double-click to launch
cd "$(dirname "$0")"

# Ensure PATH includes homebrew and common locations
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "==============================="
echo "  Lombardi"
echo "==============================="
echo ""

# 1. Docker (Apache AGE)
echo "Starting database..."
docker compose up -d 2>/dev/null
if [ $? -ne 0 ]; then
    echo "ERROR: Docker not running. Open Docker Desktop first."
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

until docker exec os_database pg_isready -U os_admin -d lombardi > /dev/null 2>&1; do
    sleep 1
done
echo "Database ready."

# 2. Kill previous API if running
lsof -ti:3000 | xargs kill 2>/dev/null

# 3. Start API server
node backend/api.js &
API_PID=$!
sleep 2

# 4. Check if server started
if ! kill -0 $API_PID 2>/dev/null; then
    echo "ERROR: API server failed to start."
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

# 5. Open browser
open http://localhost:3000

echo ""
echo "Lombardi running at http://localhost:3000"
echo "Close this window to stop."
echo ""
wait $API_PID
