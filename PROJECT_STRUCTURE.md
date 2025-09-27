# Sound Clash - Complete Project Structure Guide (Updated)

## 📁 Current Project Structure (Implemented & Organized)

```
Sound-Clash/
├── .env/                                    → Environment configurations
│   ├── local.env                           → Local development settings
│   ├── production.env                      → Production AWS settings  
│   ├── game-management.env                 → Game management service config
│   └── song-management.env                 → Song management service config
├── .env.template                           → Environment variables template
├── .gitignore                              → Git ignore rules (updated)
├── README.md                               → Project documentation
├── package.json                            → Root workspace configuration
├── package-lock.json                       → Dependency lock file
├── docker-compose.yml                      → Development environment
├── docker-compose.dev.yml                  → Development override
│
├── backend/                                → FastAPI microservices
│   ├── shared/                             → Shared utilities and models
│   │   ├── __init__.py
│   │   ├── requirements.txt
│   │   ├── models/                         → Shared data models (reorganized)
│   │   │   ├── __init__.py
│   │   │   ├── base.py                     → Base model classes
│   │   │   └── enhanced_song.py            → Enhanced song models
│   │   ├── utils/                          → Utility functions
│   │   │   ├── __init__.py
│   │   │   └── helpers.py                  → Common helper functions
│   │   └── database/                       → Database utilities (reorganized)
│   │       ├── __init__.py
│   │       └── connections.py              → Database connection managers
│   │
│   ├── game-management/                    → ✅ Game lifecycle service [PORT: 8000]
│   │   ├── __init__.py
│   │   ├── main.py                         → FastAPI app entry point
│   │   ├── Dockerfile                      → Container configuration
│   │   ├── .dockerignore                   → Docker ignore rules
│   │   ├── requirements.txt                → Python dependencies
│   │   ├── README.md                       → Service documentation
│   │   ├── api/                            → REST API endpoints
│   │   ├── models/                         → Service-specific models
│   │   ├── services/                       → Business logic
│   │   ├── database/                       → Database operations
│   │   └── venv/                           → Virtual environment
│   │
│   ├── song-management/                    → ✅ Song and genre service [PORT: 8001]
│   │   ├── __init__.py
│   │   ├── main.py                         → FastAPI app entry point
│   │   ├── Dockerfile                      → Container configuration
│   │   ├── requirements.txt                → Python dependencies
│   │   ├── api/                            → REST API endpoints
│   │   │   ├── __init__.py
│   │   │   ├── songs.py                    → Song CRUD operations
│   │   │   └── health.py                   → Health check endpoints
│   │   ├── models/                         → Pydantic models
│   │   │   ├── __init__.py
│   │   │   └── song_models.py              → Song-related models
│   │   └── database/                       → Database operations
│   │       ├── __init__.py
│   │       └── postgres.py                 → PostgreSQL operations
│   │
│   ├── game-api/                          → 🚧 Buzzer and scoring service [PORT: 8002]
│   │   └── README.md                       → Service placeholder documentation
│   │
│   ├── websocket-service/                 → 🚧 Real-time communication [PORT: 8003]
│   │   └── README.md                       → Service placeholder documentation
│   │
│   ├── manager-console/                   → 🚧 Host interface [PORT: 8004] - NO AUTH
│   │   └── README.md                       → Service placeholder documentation
│   │
│   └── public-display/                    → 🚧 Spectator interface [PORT: 8005] - NO AUTH
│       └── README.md                       → Service placeholder documentation
│
├── frontend/                               → React TypeScript application (reorganized)
│   ├── package.json                        → Frontend dependencies
│   ├── package-lock.json                   → Dependency lock file
│   ├── tsconfig.json                       → TypeScript configuration
│   ├── vite.config.ts                      → Vite build configuration
│   ├── eslint.config.js                    → ESLint configuration
│   ├── index.html                          → HTML template
│   ├── Dockerfile                          → Container configuration
│   ├── .env                                → Frontend environment variables
│   ├── .env.production                     → Production environment
│   ├── README.md                           → Frontend documentation
│   ├── public/                             → Static assets
│   └── src/                                → Source code (better organized)
│       ├── main.tsx                        → Application entry point
│       ├── App.tsx                         → Main App component
│       ├── vite-env.d.ts                   → Vite type definitions
│       ├── components/                     → Reusable components (reorganized)
│       │   ├── common/                     → Common UI components (cleaned up)
│       │   │   └── ConnectionStatus.tsx   → ✅ Connection status component (moved)
│       │   ├── game/                       → Game-specific components
│       │   ├── manager/                    → 🆕 Manager console components
│       │   └── display/                    → 🆕 Public display components
│       ├── pages/                          → Page components (reorganized)
│       │   ├── LandingPage.tsx             → Home/landing page
│       │   ├── NotFoundPage.tsx            → 404 error page
│       │   ├── game/                       → 🆕 Game pages (reorganized)
│       │   │   ├── CreateGamePage.tsx      → ✅ Game creation (moved)
│       │   │   ├── JoinGamePage.tsx        → ✅ Team joining (moved)
│       │   │   └── WaitingRoomPage.tsx     → ✅ Waiting room (moved)
│       │   ├── manager/                    → 🆕 Manager pages
│       │   ├── display/                    → 🆕 Public display pages
│       │   └── admin/                      → Admin pages (existing)
│       ├── context/                        → React contexts
│       ├── hooks/                          → Custom React hooks
│       ├── services/                       → API service calls (organized)
│       │   ├── api/                        → 🆕 API service clients
│       │   ├── websocket/                  → 🆕 WebSocket services
│       │   └── utils/                      → 🆕 Utility services
│       ├── types/                          → TypeScript type definitions
│       └── styles/                         → CSS and styling
│           ├── index.css                   → Main stylesheet
│           ├── base/                       → Base styles
│           │   ├── global.css              → Global styles
│           │   └── variables.css           → CSS variables
│           ├── components/                 → Component-specific styles
│           │   ├── components.css          → General component styles
│           │   └── loading-styles.css      → Loading component styles
│           └── pages/                      → Page-specific styles
│
├── infrastructure/                         → AWS CDK Infrastructure as Code (expanded)
│   ├── app.py                             → CDK app entry point
│   ├── cdk.json                           → CDK configuration
│   ├── requirements.txt                   → CDK dependencies
│   ├── .venv/                             → CDK virtual environment
│   ├── cdk.out/                           → Generated CloudFormation
│   ├── config/                            → CDK configuration files
│   └── stacks/                            → CDK stack definitions (expanded)
│       ├── __init__.py
│       ├── vpc_stack.py                   → ✅ VPC and networking
│       ├── database_stack.py              → ✅ RDS, DynamoDB, ElastiCache
│       ├── ecs_stack.py                   → ✅ ECS cluster configuration
│       ├── alb_stack.py                   → ✅ Application Load Balancer
│       ├── ecr_stack.py                   → ✅ Container registries
│       ├── iam_stack.py                   → ✅ IAM roles and policies
│       ├── logging_stack.py               → ✅ CloudWatch logging
│       ├── frontend_stack.py              → ✅ S3 and CloudFront
│       ├── song_service_stack.py          → ✅ Song service ECS deployment
│       ├── game_api_stack.py              → 🆕 Game API service stack (placeholder)
│       ├── websocket_stack.py             → 🆕 WebSocket service stack (placeholder)
│       ├── manager_console_stack.py       → 🆕 Manager console stack (placeholder)
│       └── public_display_stack.py        → 🆕 Public display stack (placeholder)
│
├── data/                                   → Data files and samples (organized)
│   └── sample/                            → Sample data for testing
│       ├── songs_sample.csv               → Sample songs data
│       ├── songs_converted.csv            → Converted songs data
│       └── songs_simple.csv               → Simple songs dataset
│
├── scripts/                               → Development and deployment scripts
│   ├── database/                          → Database management scripts
│   │   ├── import_songs_csv.py           → CSV import utility
│   │   └── migrate.py                     → Database migrations
│   ├── deployment/                        → Deployment automation
│   │   ├── deploy-services.sh            → Linux/Mac deployment
│   │   └── deploy-services.bat           → Windows deployment
│   └── development/                       → Development utilities
│
├── docs/                                  → Project documentation
└── .vscode/                               → VS Code workspace settings
```

## 📝 Changes Made

### **Structure Cleanup:**
1. ✅ **Removed empty legacy directories**: config/, docker/, local_database/
2. ✅ **Consolidated frontend components**: Moved ConnectionStatus.tsx from ui/ to common/
3. ✅ **Organized frontend pages**: Created game/, manager/, display/ subdirectories
4. ✅ **Moved existing pages**: CreateGamePage, JoinGamePage, WaitingRoomPage → pages/game/
5. ✅ **Created service directories**: api/, websocket/, utils/ under frontend/src/services/
6. ✅ **Added README files**: Placeholder documentation for future services
7. ✅ **Created infrastructure placeholders**: Stack files for future services

### **New Directory Structure:**
- ✅ `frontend/src/components/manager/` → Manager console components
- ✅ `frontend/src/components/display/` → Public display components  
- ✅ `frontend/src/pages/game/` → Game-related pages
- ✅ `frontend/src/pages/manager/` → Manager-specific pages
- ✅ `frontend/src/pages/display/` → Public display pages
- ✅ `frontend/src/services/api/` → API client services
- ✅ `frontend/src/services/websocket/` → WebSocket services
- ✅ `frontend/src/services/utils/` → Utility services
- ✅ `infrastructure/stacks/game_api_stack.py` → Game API service infrastructure
- ✅ `infrastructure/stacks/websocket_stack.py` → WebSocket service infrastructure
- ✅ `infrastructure/stacks/manager_console_stack.py` → Manager console infrastructure
- ✅ `infrastructure/stacks/public_display_stack.py` → Public display infrastructure

### **Service Status:**
- ✅ **Implemented**: game-management (PORT 8000), song-management (PORT 8001)
- 🚧 **Planned**: game-api (PORT 8002), websocket-service (PORT 8003), manager-console (PORT 8004), public-display (PORT 8005)

### **Updated .gitignore:**
- Maintains exclusions for reorganized legacy directories
- Preserves environment variable security rules
- Includes frontend build directory exclusions

The project structure is now better organized with clear separation of concerns and proper directory hierarchy for scalable development.
