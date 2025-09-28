# Sound Clash - Simplified Task Breakdown

## Current Status: Task 2.1 - Basic Song Management (Simplified)

**Completed**: Infrastructure, database connectivity, basic service deployment
**Current Goal**: Implement basic song CRUD operations without AI or complexity

## Task 2.1: Basic Song Management System (Days 1-3)

**Goal**: Simple song database with basic selection and genre management

### Day 1: Database Schema & Models
**Morning: Simple Database Design**
1. Create Basic PostgreSQL Schema
   - Songs table: id, title, artist, youtube_id, created_at, is_active
   - Genres table: id, name, slug, category, is_active
   - Song_genres junction table for many-to-many relationship
   - No difficulty, timestamps, or complexity tables

2. Implement SQLAlchemy Models
   - Simple Song model matching current Pydantic models
   - Basic Genre model with categories
   - Many-to-many relationship between songs and genres
   - Basic validation and constraints

**Afternoon: Sample Data Setup**
3. Create Database Seeding Script
   - Load sample songs from existing CSV
   - Create basic genre categories (Israeli, Styles, Decades, Media)
   - Establish song-genre relationships
   - Verify data integrity

### Day 2: Basic API Implementation
**Morning: Song CRUD Operations**
4. Implement Song Endpoints
   - GET /api/songs - List songs with pagination
   - GET /api/songs/{id} - Get single song details
   - POST /api/songs - Create new song (admin)
   - PUT /api/songs/{id} - Update song (admin)
   - DELETE /api/songs/{id} - Remove song (admin)

5. Add Genre Management
   - GET /api/genres - List all genres by category
   - GET /api/genres/categories - Get organized genre structure
   - Basic genre filtering and organization

**Afternoon: Song Selection Logic**
6. Create Simple Selection Service
   - Random selection from genre filters
   - Exclude recently played songs (per game)
   - Basic availability checking
   - Return songs with fixed 5-second start time

### Day 3: Integration & Testing
**Morning: Service Integration**
7. Update Main Application
   - Add new routes to main FastAPI app
   - Connect to existing database connection
   - Update health checks to include song database
   - Error handling and validation

**Afternoon: Testing & Verification**
8. Test All Operations
   - Verify CRUD operations work correctly
   - Test song selection returns random results
   - Validate genre filtering functions
   - Check database connectivity and performance

9. Load Sample Data
   - Import songs from sample CSV
   - Verify genre assignments
   - Test selection algorithm with real data

## Simplified API Endpoints

**Song Management:**
- GET /api/songs?genre={genre}&page={page}
- GET /api/songs/{id}
- POST /api/songs (admin)
- PUT /api/songs/{id} (admin)

**Genre Management:**
- GET /api/genres
- GET /api/genres/categories

**Song Selection:**
- POST /api/songs/select (genres, exclude_ids, count)

## Database Models (Simplified)

**Songs Table:**
- id (primary key)
- title (string, required)
- artist (string, required)  
- youtube_id (string, unique)
- created_at (timestamp)
- is_active (boolean, default true)

**Genres Table:**
- id (primary key)
- name (string, required)
- slug (string, unique)
- category (string: israeli, styles, decades, media)
- is_active (boolean, default true)

**Song_Genres Table:**
- song_id (foreign key)
- genre_id (foreign key)
- Primary key: (song_id, genre_id)

## Key Simplifications Applied

1. **No Difficulty System**: Removed all difficulty-related fields and logic
2. **Fixed Start Time**: All songs start at 5 seconds, no timestamp calculations
3. **Random Selection**: Simple random choice from filtered results
4. **Basic Genre System**: Four main categories without hierarchies
5. **Standard Scoring**: Fixed 20-point system (10+5+5)
6. **No AI**: Removed all machine learning and intelligent selection
7. **No Heatmaps**: Removed YouTube analysis and processing

## File Structure Changes

**Backend Changes:**
- Remove timestamp-related models and fields
- Simplify song selection service (no AI)
- Basic genre categorization (no hierarchies)
- Fixed scoring system (no difficulty multipliers)

**Database Changes:**
- Remove timestamps table
- Remove difficulty ratings
- Simplify song metadata
- Basic genre relationships

**API Changes:**
- Remove difficulty parameters
- Remove heatmap endpoints
- Simplify selection criteria
- Fixed point values

## Next Tasks After 2.1

**Task 2.2**: Team Management with Reconnection (Days 4-6)
**Task 2.3**: Waiting Room WebSocket Integration (Days 7-9) 
**Task 2.4**: Game State Transitions (Days 10-12)
**Task 2.5**: Public Display Interface (Days 13-14)

All subsequent tasks will follow the simplified approach with fixed scoring, no difficulty levels, and basic song selection.
