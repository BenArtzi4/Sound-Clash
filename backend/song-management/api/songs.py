"""
Song management API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
import asyncio

from database.postgres import get_db_connection, SongRepository, GenreRepository
from models.song_models import (
    SongResponse, SongDetailResponse, SongCreateRequest, SongUpdateRequest,
    SongSearchRequest, SongSearchResponse, GenreResponse, GenreListResponse,
    SongSelectionRequest, SongSelectionResponse, BulkOperationResponse
)

router = APIRouter()

# Helper function to get repositories
async def get_song_repo(conn=Depends(get_db_connection)):
    async for connection in conn:
        yield SongRepository(connection)

async def get_genre_repo(conn=Depends(get_db_connection)):
    async for connection in conn:
        yield GenreRepository(connection)

@router.get("/", response_model=List[SongDetailResponse])
async def get_all_songs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    repo: SongRepository = Depends(get_song_repo)
):
    """Get all songs with pagination"""
    try:
        offset = (page - 1) * page_size
        songs = await repo.get_all_songs(limit=page_size, offset=offset)
        return [SongDetailResponse(**song) for song in songs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch songs: {str(e)}")

@router.get("/{song_id}", response_model=SongDetailResponse)
async def get_song(song_id: int, repo: SongRepository = Depends(get_song_repo)):
    """Get song by ID"""
    try:
        song = await repo.get_song_by_id(song_id)
        if not song:
            raise HTTPException(status_code=404, detail="Song not found")
        return SongDetailResponse(**song)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch song: {str(e)}")

@router.post("/search", response_model=SongSearchResponse)
async def search_songs(
    request: SongSearchRequest,
    repo: SongRepository = Depends(get_song_repo)
):
    """Search songs with filters"""
    try:
        offset = (request.page - 1) * request.page_size
        songs, total_count = await repo.search_songs(
            search_term=request.search_term,
            genres=request.genres,
            is_active=request.is_active,
            limit=request.page_size,
            offset=offset
        )
        
        total_pages = (total_count + request.page_size - 1) // request.page_size
        
        return SongSearchResponse(
            songs=[SongDetailResponse(**song) for song in songs],
            total_songs=total_count,
            page=request.page,
            page_size=request.page_size,
            total_pages=total_pages
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@router.post("/", response_model=SongDetailResponse)
async def create_song(
    request: SongCreateRequest,
    repo: SongRepository = Depends(get_song_repo)
):
    """Create new song"""
    try:
        song_id = await repo.create_song(request.dict())
        song = await repo.get_song_by_id(song_id)
        return SongDetailResponse(**song)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create song: {str(e)}")

@router.put("/{song_id}", response_model=SongDetailResponse)
async def update_song(
    song_id: int,
    request: SongUpdateRequest,
    repo: SongRepository = Depends(get_song_repo)
):
    """Update existing song"""
    try:
        # Check if song exists
        existing_song = await repo.get_song_by_id(song_id)
        if not existing_song:
            raise HTTPException(status_code=404, detail="Song not found")
        
        # Update song
        update_data = {k: v for k, v in request.dict().items() if v is not None}
        await repo.update_song(song_id, update_data)
        
        # Return updated song
        song = await repo.get_song_by_id(song_id)
        return SongDetailResponse(**song)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update song: {str(e)}")

@router.delete("/{song_id}")
async def delete_song(song_id: int, repo: SongRepository = Depends(get_song_repo)):
    """Delete song (soft delete)"""
    try:
        success = await repo.delete_song(song_id)
        if not success:
            raise HTTPException(status_code=404, detail="Song not found")
        return {"message": "Song deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete song: {str(e)}")

@router.post("/select", response_model=SongSelectionResponse)
async def select_songs(
    request: SongSelectionRequest,
    repo: SongRepository = Depends(get_song_repo)
):
    """Select songs based on criteria (for game use)"""
    try:
        songs = await repo.get_songs_by_genres(
            genre_slugs=request.genres,
            limit=request.limit,
            exclude_ids=request.exclude_song_ids or []
        )
        
        return SongSelectionResponse(
            songs=[SongDetailResponse(**song) for song in songs],
            total_available=len(songs),
            selection_criteria={
                "genres": request.genres,
                "excluded_count": len(request.exclude_song_ids or []),
                "limit": request.limit
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Song selection failed: {str(e)}")

# Genre endpoints
@router.get("/genres/all", response_model=GenreListResponse)
async def get_all_genres(repo: GenreRepository = Depends(get_genre_repo)):
    """Get all genres with song counts"""
    try:
        genres = await repo.get_all_genres()
        categories = await repo.get_genres_by_category()
        
        return GenreListResponse(
            genres=[GenreResponse(**genre) for genre in genres],
            categories={
                category: [GenreResponse(**genre) for genre in genre_list]
                for category, genre_list in categories.items()
            },
            total_count=len(genres)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch genres: {str(e)}")

@router.get("/genres/{category}", response_model=List[GenreResponse])
async def get_genres_by_category(
    category: str,
    repo: GenreRepository = Depends(get_genre_repo)
):
    """Get genres by category"""
    try:
        categories = await repo.get_genres_by_category()
        if category not in categories:
            raise HTTPException(status_code=404, detail="Category not found")
        
        return [GenreResponse(**genre) for genre in categories[category]]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch category: {str(e)}")

# Bulk operations
@router.post("/bulk/activate", response_model=BulkOperationResponse)
async def bulk_activate_songs(
    song_ids: List[int],
    repo: SongRepository = Depends(get_song_repo)
):
    """Bulk activate songs"""
    import time
    start_time = time.time()
    
    successful = 0
    failed = 0
    errors = []
    
    for song_id in song_ids:
        try:
            await repo.update_song(song_id, {"is_active": True})
            successful += 1
        except Exception as e:
            failed += 1
            errors.append(f"Song {song_id}: {str(e)}")
    
    return BulkOperationResponse(
        processed=len(song_ids),
        successful=successful,
        failed=failed,
        errors=errors,
        processing_time_seconds=time.time() - start_time
    )

@router.post("/bulk/deactivate", response_model=BulkOperationResponse)
async def bulk_deactivate_songs(
    song_ids: List[int],
    repo: SongRepository = Depends(get_song_repo)
):
    """Bulk deactivate songs"""
    import time
    start_time = time.time()
    
    successful = 0
    failed = 0
    errors = []
    
    for song_id in song_ids:
        try:
            await repo.update_song(song_id, {"is_active": False})
            successful += 1
        except Exception as e:
            failed += 1
            errors.append(f"Song {song_id}: {str(e)}")
    
    return BulkOperationResponse(
        processed=len(song_ids),
        successful=successful,
        failed=failed,
        errors=errors,
        processing_time_seconds=time.time() - start_time
    )