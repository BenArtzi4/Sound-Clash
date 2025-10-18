# Sound Clash - AWS-Native Multi-Room Pop Culture Buzzer Game

A scalable, real-time multiplayer music trivia game built with AWS microservices architecture.

## 🎵 Architecture

- **Frontend**: React + TypeScript with Vite
- **Backend**: 5 FastAPI microservices
- **Infrastructure**: AWS CDK (ECS, RDS, DynamoDB, ElastiCache)
- **Real-time**: WebSocket communication
- **Database**: Hybrid approach (PostgreSQL + DynamoDB)

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- Python 3.9+
- AWS CLI (for deployment)

### Development Setup

1. **Clone and setup**:
   ```bash
   git clone <repo-url>
   cd Sound-Clash
   npm install
   ```

2. **Environment setup**:
   ```bash
   cp .env.template .env/local.env
   # Edit .env/local.env with your local settings
   ```

3. **Start development environment**:
   ```bash
   npm run dev
   ```

4. **Access the application**:
   - Frontend: http://localhost:3000
   - Game Management API: http://localhost:8000
   - Song Management API: http://localhost:8001

## 📁 Project Structure

```
Sound-Clash/
├── .env/                      # Environment configurations
│   ├── local.env             # Local development
│   ├── production.env        # Production settings
│   ├── game-management.env   # Service-specific config
│   └── song-management.env   # Service-specific config
├── backend/                   # FastAPI microservices
│   ├── shared/               # Shared utilities and models
│   ├── game-management/      # Game lifecycle service (Port 8000)
│   ├── song-management/      # Song and genre management (Port 8001)
│   └── websocket-service/    # Real-time communication (Port 8003)
├── frontend/                 # React TypeScript app
├── infrastructure/          # AWS CDK stacks
├── data/                   # Sample data and imports
│   └── sample/            # CSV files for testing
├── scripts/                # Development and deployment scripts
├── docs/                  # Documentation
└── docker-compose.yml     # Development environment
```

## 🔧 Backend Services

| Service | Port | Description |
|---------|------|-------------|
| Game Management | 8000 | Game lifecycle, team management |
| Song Management | 8001 | Song database, genres, selection |
| WebSocket Service | 8003 | Real-time communication for all clients |

**Note**: Manager and display interfaces are served by the React frontend, not separate backend services.

## 🎯 Features

- **Real-time Multiplayer**: Teams compete simultaneously
- **Smart Song Selection**: AI-driven difficulty-based timestamps
- **Multi-phase Scoring**: Separate points for song, artist, movie/TV
- **Cross-game Analytics**: Track team performance over time
- **Responsive Design**: Works on desktop, tablet, and mobile
- **High Availability**: Auto-scaling AWS infrastructure

## 🛠️ Development

### Frontend Development
```bash
npm run dev:frontend
```

### Backend Services
Each service can be run individually:
```bash
cd backend/song-management
python -m venv venv
source venv/bin/activate  # or venv\\Scripts\\activate on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### Database Setup
```bash
# Import sample songs
python scripts/database/import_songs_csv.py
```

## 🚀 Deployment

### Infrastructure
```bash
cd infrastructure
npm run deploy:infra
```

### Services
```bash
npm run deploy:services
```

## 📚 Documentation

### Architecture & Planning
- [Architecture Overview](docs/architecture.md)
- [Simplified Architecture](docs/SIMPLIFIED_ARCHITECTURE.md)
- [Project Structure](docs/SIMPLIFIED_PROJECT_STRUCTURE.md)
- [Domain & HTTPS Setup](docs/DOMAIN_AND_HTTPS_SETUP.md)

### Development
- [Recent Changes](docs/development/CHANGES_SUMMARY.md)
- [Task Breakdown](docs/SIMPLIFIED_TASK_BREAKDOWN.md)
- [Phase 3 Implementation](docs/PHASE_3_IMPLEMENTATION.md)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
