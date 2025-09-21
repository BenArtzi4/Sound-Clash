"""
Genre management endpoints with full database integration
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from typing import List, Dict, Any, Optional
from database.postgres import get_db
from database.models import Genre, Song, song_genres
from models.game import GenreResponse, GenreListResponse
import logging

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/genres", tags=["genres"])

@router.get("/", response_model=GenreListResponse)
async def get_available_genres(
    category: Optional[str] = Query(None, description="Filter by category (decades, styles, israeli, media)"),
    active_only: bool = Query(True, description="Return only active genres"),
    include_song_count: bool = Query(True, description="Include song count for each genre"),
    db: Session = Depends(get_db)
):
    """
    Get all available genres in flat list with optional filtering
    
    - **category**: Filter by specific category
    - **active_only**: Include only active genres (default: True)
    - **include_song_count**: Include song count in response (default: True)
    """
    try:
        # Base query
        query = db.query(Genre)
        
        # Apply filters
        if active_only:
            query = query.filter(Genre.is_active == True)
        
        if category:
            query = query.filter(Genre.category == category)
        
        # Get genres with song counts if requested
        if include_song_count:
            genres_with_counts = db.query(
                Genre.id,
                Genre.name,
                Genre.slug,
                Genre.description,
                Genre.category,
                Genre.is_active,
                Genre.sort_order,
                func.count(Song.id).label('song_count')
            ).outerjoin(song_genres).outerjoin(Song).filter(
                and_(
                    Genre.is_active == True if active_only else True,
                    Genre.category == category if category else True
                )
            ).group_by(Genre.id).order_by(Genre.category, Genre.sort_order).all()
            
            genre_responses = [
                GenreResponse(
                    id=genre.slug,
                    label=genre.name,
                    description=genre.description,
                    song_count=genre.song_count or 0,
                    is_active=genre.is_active
                )
                for genre in genres_with_counts
            ]
        else:
            genres = query.order_by(Genre.category, Genre.sort_order).all()
            genre_responses = [
                GenreResponse(
                    id=genre.slug,
                    label=genre.name,
                    description=genre.description,
                    song_count=0,  # Not calculated
                    is_active=genre.is_active
                )
                for genre in genres
            ]
        
        logger.info(f"Retrieved {len(genre_responses)} genres with category filter: {category}")
        
        return GenreListResponse(
            genres=genre_responses,
            total_count=len(genre_responses)
        )
        
    except Exception as e:
        logger.error(f"Error fetching genres: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch genres: {str(e)}"
        )

@router.get("/categories", response_model=Dict[str, Any])
async def get_genres_by_categories(
    active_only: bool = Query(True, description="Return only active genres"),
    include_song_count: bool = Query(True, description="Include song count for each genre"),
    db: Session = Depends(get_db)
):
    """
    Get genres organized by categories for visual selection interface
    
    Returns a dictionary with category keys and genre lists as values.
    Perfect for building category-based selection components.
    """
    try:
        # Query all genres with optional song counts
        if include_song_count:
            genres = db.query(
                Genre.id,
                Genre.name,
                Genre.slug,
                Genre.description,
                Genre.category,
                Genre.is_active,
                Genre.sort_order,
                func.count(Song.id).label('song_count')
            ).outerjoin(song_genres).outerjoin(Song).filter(
                Genre.is_active == True if active_only else True
            ).group_by(Genre.id).order_by(Genre.category, Genre.sort_order).all()
        else:
            genres = db.query(Genre).filter(
                Genre.is_active == True if active_only else True
            ).order_by(Genre.category, Genre.sort_order).all()
        
        # Category metadata
        category_info = {
            "decades": {
                "name": "Decades", 
                "description": "Music by time period",
                "icon": "🎵"
            },
            "styles": {
                "name": "Musical Styles", 
                "description": "Spotify-inspired genre categories",
                "icon": "🎸"
            }, 
            "israeli": {
                "name": "Israeli Music", 
                "description": "Israeli songs across all styles",
                "icon": "🇮🇱"
            },
            "media": {
                "name": "Media & Culture", 
                "description": "Songs from movies, TV, games, and internet",
                "icon": "🎬"
            }
        }
        
        # Group genres by category
        categories = {}
        
        for genre in genres:
            category = genre.category
            
            # Initialize category if not exists
            if category not in categories:
                info = category_info.get(category, {
                    "name": category.title(),
                    "description": f"{category.title()} music",
                    "icon": "🎵"
                })
                categories[category] = {
                    "name": info["name"],
                    "description": info["description"],
                    "icon": info["icon"],
                    "genres": [],
                    "total_songs": 0
                }
            
            # Add genre to category
            genre_data = {
                "id": genre.slug,
                "label": genre.name,
                "description": genre.description,
                "song_count": getattr(genre, 'song_count', 0) or 0,
                "is_active": genre.is_active
            }
            
            categories[category]["genres"].append(genre_data)
            categories[category]["total_songs"] += genre_data["song_count"]
        
        # Sort categories by preference
        category_order = ["israeli", "styles", "decades", "media"]
        ordered_categories = {}
        
        for cat in category_order:
            if cat in categories:
                ordered_categories[cat] = categories[cat]
        
        # Add any remaining categories
        for cat, data in categories.items():
            if cat not in ordered_categories:
                ordered_categories[cat] = data
        
        logger.info(f"Retrieved genres organized into {len(ordered_categories)} categories")
        
        return ordered_categories
        
    except Exception as e:
        logger.error(f"Error fetching genre categories: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch genre categories: {str(e)}"
        )

@router.get("/{genre_slug}", response_model=GenreResponse)
async def get_genre_details(
    genre_slug: str,
    include_song_count: bool = Query(True, description="Include song count"),
    db: Session = Depends(get_db)
):
    """
    Get detailed information for a specific genre
    
    - **genre_slug**: The unique slug identifier for the genre
    """
    try:
        if include_song_count:
            genre = db.query(
                Genre.id,
                Genre.name,
                Genre.slug,
                Genre.description,
                Genre.category,
                Genre.is_active,
                func.count(Song.id).label('song_count')
            ).outerjoin(song_genres).outerjoin(Song).filter(
                Genre.slug == genre_slug,
                Genre.is_active == True
            ).group_by(Genre.id).first()
        else:
            genre = db.query(Genre).filter(
                Genre.slug == genre_slug,
                Genre.is_active == True
            ).first()
        
        if not genre:
            raise HTTPException(
                status_code=404, 
                detail=f"Genre '{genre_slug}' not found or inactive"
            )
        
        logger.info(f"Retrieved details for genre: {genre_slug}")
        
        return GenreResponse(
            id=genre.slug,
            label=genre.name,
            description=genre.description,
            song_count=getattr(genre, 'song_count', 0) or 0,
            is_active=genre.is_active
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching genre details for {genre_slug}: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch genre details: {str(e)}"
        )

@router.get("/{genre_slug}/songs")
async def get_songs_by_genre(
    genre_slug: str,
    limit: int = Query(50, ge=1, le=100, description="Number of songs to return"),
    offset: int = Query(0, ge=0, description="Number of songs to skip"),
    active_only: bool = Query(True, description="Return only active songs"),
    search: Optional[str] = Query(None, description="Search in song title or artist"),
    db: Session = Depends(get_db)
):
    """
    Get songs for a specific genre with pagination and search
    
    - **genre_slug**: The genre to fetch songs for
    - **limit**: Maximum number of songs to return (1-100)
    - **offset**: Number of songs to skip for pagination
    - **active_only**: Include only active songs
    - **search**: Optional search term for title/artist
    """
    try:
        # Verify genre exists
        genre = db.query(Genre).filter(
            Genre.slug == genre_slug,
            Genre.is_active == True
        ).first()
        
        if not genre:
            raise HTTPException(
                status_code=404, 
                detail=f"Genre '{genre_slug}' not found"
            )
        
        # Build songs query
        songs_query = db.query(Song).join(song_genres).filter(
            song_genres.c.genre_id == genre.id
        )
        
        if active_only:
            songs_query = songs_query.filter(Song.is_active == True)
        
        # Apply search filter
        if search:
            search_term = f"%{search}%"
            songs_query = songs_query.filter(
                or_(
                    Song.title.ilike(search_term),
                    Song.artist.ilike(search_term),
                    Song.album.ilike(search_term)
                )
            )
        
        # Get total count before pagination
        total_count = songs_query.count()
        
        # Apply pagination
        songs = songs_query.offset(offset).limit(limit).all()
        
        # Format response
        songs_data = []
        for song in songs:
            songs_data.append({
                "id": song.id,
                "title": song.title,
                "artist": song.artist,
                "album": song.album,
                "release_year": song.release_year,
                "duration_seconds": song.duration_seconds,
                "youtube_id": song.youtube_id,
                "youtube_url": song.youtube_url,
                "movie_tv_source": song.movie_tv_source,
                "play_count": song.play_count,
                "success_rate": song.success_rate,
                "difficulty_timestamps": {
                    "easy_start": song.difficulty_easy_start,
                    "medium_start": song.difficulty_medium_start,
                    "hard_start": song.difficulty_hard_start
                }
            })
        
        logger.info(f"Retrieved {len(songs)} songs for genre {genre_slug} (total: {total_count})")
        
        return {
            "genre": {
                "id": genre.slug,
                "name": genre.name,
                "description": genre.description,
                "category": genre.category
            },
            "songs": songs_data,
            "pagination": {
                "total_count": total_count,
                "returned_count": len(songs),
                "limit": limit,
                "offset": offset,
                "has_more": offset + len(songs) < total_count
            },
            "search_term": search
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching songs for genre {genre_slug}: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch songs for genre: {str(e)}"
        )

@router.get("/stats/summary")
async def get_genre_stats(db: Session = Depends(get_db)):
    """
    Get summary statistics about genres and songs
    
    Useful for admin dashboards and analytics
    """
    try:
        # Count genres by category
        genre_stats = db.query(
            Genre.category,
            func.count(Genre.id).label('genre_count'),
            func.count(Song.id).label('total_songs')
        ).outerjoin(song_genres).outerjoin(Song).filter(
            Genre.is_active == True
        ).group_by(Genre.category).all()
        
        # Total counts
        total_genres = db.query(Genre).filter(Genre.is_active == True).count()
        total_songs = db.query(Song).filter(Song.is_active == True).count()
        
        # Most popular genres (by song count)
        popular_genres = db.query(
            Genre.name,
            Genre.slug,
            func.count(Song.id).label('song_count')
        ).outerjoin(song_genres).outerjoin(Song).filter(
            Genre.is_active == True,
            Song.is_active == True
        ).group_by(Genre.id).order_by(
            func.count(Song.id).desc()
        ).limit(5).all()
        
        stats = {
            "totals": {
                "genres": total_genres,
                "songs": total_songs
            },
            "by_category": {
                stat.category: {
                    "genre_count": stat.genre_count,
                    "song_count": stat.total_songs or 0
                }
                for stat in genre_stats
            },
            "most_popular_genres": [
                {
                    "name": genre.name,
                    "slug": genre.slug,
                    "song_count": genre.song_count or 0
                }
                for genre in popular_genres
            ]
        }
        
        logger.info("Retrieved genre statistics")
        return stats
        
    except Exception as e:
        logger.error(f"Error fetching genre stats: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch genre statistics: {str(e)}"
        )

# Health check endpoint specific to genres
@router.get("/health")
async def genre_service_health(db: Session = Depends(get_db)):
    """
    Health check for the genre service
    """
    try:
        # Test database connection by counting genres
        genre_count = db.query(Genre).count()
        song_count = db.query(Song).count()
        
        return {
            "status": "healthy",
            "service": "genre_api",
            "database": "connected",
            "data_status": {
                "genres": genre_count,
                "songs": song_count
            },
            "timestamp": db.execute("SELECT NOW()").scalar()
        }
        
    except Exception as e:
        logger.error(f"Genre service health check failed: {str(e)}")
        raise HTTPException(
            status_code=503,
            detail=f"Genre service unhealthy: {str(e)}"
        )