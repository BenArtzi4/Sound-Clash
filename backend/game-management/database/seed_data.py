"""
Database seed data for basic genres
"""

import asyncio
from sqlalchemy import create_engine, text
import os

async def run_seed():
    """Seed database with basic genre data"""
    # This function is called by migrate.py
    # The actual seeding logic is now in migrate.py to avoid circular imports
    pass