# Backend Services

This directory contains all microservices for the Sound Clash application.

## Services Structure

### Core Services
- `game-management/` - Game lifecycle, team joining, waiting room
- `song-management/` - Song database, search, and selection
- `game-api/` - Real-time gameplay, buzzer logic, scoring
- `websocket-service/` - Real-time communication between participants
- `manager-console/` - Host interface with advanced controls
- `public-display/` - Spectator interface and team displays

### Shared Components
- `shared/` - Common database connections, models, and utilities

## Service Ports
- Game Management: 8000
- Song Management: 8001 (deployed)
- Game API: 8002
- WebSocket Service: 8003
- Manager Console: 8004
- Public Display: 8005

## Development
Each service contains:
- `main.py` - FastAPI application entry point
- `api/` - REST endpoints
- `models/` - Pydantic data models
- `database/` - Database connections and repositories
- `requirements.txt` - Python dependencies
- `Dockerfile` - Container configuration
