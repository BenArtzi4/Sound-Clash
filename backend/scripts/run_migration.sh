#!/bin/bash

# Database migration script
echo "Starting database migration..."

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Run migration
python scripts/migrate.py

echo "Migration completed!"