#!/bin/bash
# Lombardi — Start all services
cd "$(dirname "$0")"

echo "🔧 Starting Docker (Apache AGE)..."
docker compose up -d

echo "⏳ Waiting for database..."
until docker exec os_database pg_isready -U os_admin -d lombardi > /dev/null 2>&1; do
    sleep 1
done
echo "✅ Database ready"

echo "🚀 Starting API server..."
pkill -f "node backend/api" 2>/dev/null
node backend/api.js &
API_PID=$!
echo "✅ API running (PID: $API_PID) → http://localhost:3000"

echo ""
echo "Lombardi is ready. Open http://localhost:3000"
echo "Press Ctrl+C to stop."
wait $API_PID
