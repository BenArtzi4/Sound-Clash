# Game Management Service

FastAPI microservice handling game lifecycle, team joining, and waiting room management.

## Features

- Game creation with configurable settings
- Team joining with Unicode name support
- Waiting room state management
- Hybrid database architecture (PostgreSQL + DynamoDB + Redis)
- Health checks for ALB integration
- Docker containerization

## Local Development

### Prerequisites

- Python 3.11+
- Docker and Docker Compose
- PostgreSQL and Redis (via Docker)

### Setup

1. **Start local databases:**
```bash
docker-compose up postgres redis -d