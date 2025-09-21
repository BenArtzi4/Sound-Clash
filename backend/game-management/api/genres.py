"""
Genre management endpoints with database integration
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict, Any
from database.postgres import get_db
from database.models import Genre, Song, song_genres
from models.game import GenreResponse, GenreListResponse

router = APIRouter(prefix="/api/genres", tags=["genres"])

@router.get("/", response_model=GenreListResponse)
async def get_available_genres(db: Session = Depends(get_db)):
    """Get all available genres in flat list with song counts"""
    try:
        # Query genres with song counts
        genres_with_counts = db.query(
            Genre.id,
            Genre.name,
            Genre.slug,
            Genre.description,
            Genre.category,
            Genre.is_active,
            func.count(Song.id).label('song_count')
        ).outerjoin(song_genres).outerjoin(Song).filter(
            Genre.is_active == True
        ).group_by(Genre.id).order_by(Genre.sort_order).all()
        
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
        
        return GenreListResponse(
            genres=genre_responses,
            total_count=len(genre_responses)
        )
    except Exception as e:
        print(f"Error fetching genres: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch genres")

@router.get("/categories", response_model=Dict[str, Any])
async def get_genres_by_categories(db: Session = Depends(get_db)):
    """Get genres organized by categories for visual selection"""
    try:
        # Query all active genres grouped by category
        genres = db.query(
            Genre.id,
            Genre.name,
            Genre.slug,
            Genre.description,
            Genre.category,
            Genre.is_active,
            func.count(Song.id).label('song_count')
        ).outerjoin(song_genres).outerjoin(Song).filter(
            Genre.is_active == True
        ).group_by(Genre.id).order_by(Genre.sort_order).all()
        
        # Group by category
        categories = {}
        category_info = {
            "decades": {"name": "Decades", "description": "Music by time period"},
            "styles": {"name": "Musical Styles", "description": "Genre-based categories"}, 
            "media": {"name": "Media & Culture", "description": "Songs from movies, TV, and internet"}
        }
        
        for genre in genres:
            category = genre.category
            if category not in categories:
                categories[category] = {
                    "name": category_info.get(category, {}).get("name", category.title()),
                    "description": category_info.get(category, {}).get("description", ""),
                    "genres": []
                }
            
            categories[category]["genres"].append({
                "id": genre.slug,
                "label": genre.name,
                "description": genre.description,
                "song_count": genre.song_count or 0,
                "is_active": genre.is_active
            })
        
        return categories
    except Exception as e:
        print(f"Error fetching genre categories: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch genre categories")

@router.get("/{genre_slug}", response_model=GenreResponse)
async def get_genre_details(genre_slug: str, db: Session = Depends(get_db)):
    """Get details for a specific genre"""
    genre = db.query(
        Genre.id,
        Genre.name,
        Genre.slug,
        Genre.description,
        Genre.is_active,
        func.count(Song.id).label('song_count')
    ).outerjoin(song_genres).outerjoin(Song).filter(
        Genre.slug == genre_slug,
        Genre.is_active == True
    ).group_by(Genre.id).first()
    
    if not genre:
        raise HTTPException(status_code=404, detail="Genre not found")
    
    return GenreResponse(
        id=genre.slug,
        label=genre.name,
        description=genre.description,
        song_count=genre.song_count or 0,
        is_active=genre.is_active
    )

@router.get("/{genre_slug}/songs")
async def get_songs_by_genre(
    genre_slug: str, 
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Get songs for a specific genre"""
    genre = db.query(Genre).filter(
        Genre.slug == genre_slug,
        Genre.is_active == True
    ).first()
    
    if not genre:
        raise HTTPException(status_code=404, detail="Genre not found")
    
    songs = db.query(Song).join(song_genres).filter(
        song_genres.c.genre_id == genre.id,
        Song.is_active == True
    ).offset(offset).limit(limit).all()
    
    return {
        "genre": genre.name,
        "songs": [
            {
                "id": song.id,
                "title": song.title,
                "artist": song.artist,
                "album": song.album,
                "release_year": song.release_year,
                "youtube_id": song.youtube_id,
                "youtube_url": song.youtube_url,
                "duration_seconds": song.duration_seconds,
                "movie_tv_source": song.movie_tv_source
            }
            for song in songs
        ],
        "total_count": len(songs)
    }