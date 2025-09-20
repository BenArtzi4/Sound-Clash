# Architecture Overview

## Microservices Design
1. **Game Management Service** - Game lifecycle, team joining
2. **Game API Service** - Buzzer logic, scoring
3. **WebSocket Service** - Real-time communication
4. **Manager Console Service** - Host interface
5. **Public Display Service** - Spectator interface

## Database Strategy
- **DynamoDB**: Ephemeral game data with TTL
- **RDS PostgreSQL**: Persistent user data, analytics
- **ElastiCache Redis**: Caching and session management

## AWS Services
- **ECS**: Container orchestration
- **ALB**: Load balancing with path routing
- **VPC**: Network isolation
- **CloudFront + S3**: Frontend hosting
