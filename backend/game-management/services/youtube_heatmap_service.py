"""
YouTube heatmap service for song difficulty timestamp analysis
"""

import json
import asyncio
import aiohttp
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import logging
import sys
import os

# Add the backend directory to the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy.orm import Session
from shared.database.models import Song

logger = logging.getLogger(__name__)

class YouTubeHeatmapService:
    def __init__(self):
        self.base_url = "https://yt.lemnoslife.com/videos"
        self.session = None
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def get_heatmap_data(self, youtube_id: str) -> Optional[Dict]:
        """
        Fetch heatmap data from yt.lemnoslife.com
        Returns dict with most replayed segments
        """
        try:
            url = f"{self.base_url}?part=mostReplayed&id={youtube_id}"
            
            async with self.session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    logger.warning(f"Failed to fetch heatmap for {youtube_id}: {response.status}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error fetching heatmap for {youtube_id}: {e}")
            return None
    
    def analyze_heatmap_segments(self, heatmap_data: Dict, duration_seconds: int) -> Dict[str, int]:
        """
        Analyze heatmap data to determine optimal difficulty timestamps
        Returns dict with easy/medium/hard start times
        """
        if not heatmap_data or 'items' not in heatmap_data:
            return self._fallback_timestamps(duration_seconds)
        
        try:
            video_data = heatmap_data['items'][0]
            if 'mostReplayed' not in video_data:
                return self._fallback_timestamps(duration_seconds)
            
            most_replayed = video_data['mostReplayed']
            heat_markers = most_replayed.get('heatMarkersDecorations', [])
            
            if not heat_markers:
                return self._fallback_timestamps(duration_seconds)
            
            # Analyze heat intensity across the video
            segments = []
            for marker in heat_markers:
                start_time = marker.get('timeRangeStartMillis', 0) // 1000
                intensity = marker.get('heatMarkerRenderer', {}).get('heatMarkerIntensityScoreNormalized', 0)
                segments.append((start_time, intensity))
            
            # Sort by intensity and categorize
            segments.sort(key=lambda x: x[1], reverse=True)
            
            # Determine difficulty timestamps
            timestamps = {}
            
            if len(segments) >= 3:
                # Easy: Highest replay intensity (chorus/hook)
                timestamps['easy'] = segments[0][0]
                
                # Medium: Medium intensity 
                mid_idx = len(segments) // 2
                timestamps['medium'] = segments[mid_idx][0]
                
                # Hard: Lowest intensity (intro/outro)
                timestamps['hard'] = segments[-1][0]
            else:
                return self._fallback_timestamps(duration_seconds)
            
            # Ensure timestamps are within bounds and logical
            timestamps = self._validate_timestamps(timestamps, duration_seconds)
            
            return timestamps
            
        except Exception as e:
            logger.error(f"Error analyzing heatmap segments: {e}")
            return self._fallback_timestamps(duration_seconds)
    
    def _fallback_timestamps(self, duration_seconds: int) -> Dict[str, int]:
        """Fallback logic when heatmap data is unavailable"""
        if duration_seconds < 60:
            return {
                'easy': 10,
                'medium': duration_seconds // 3,
                'hard': 5
            }
        elif duration_seconds < 180:
            return {
                'easy': 30,
                'medium': duration_seconds // 2,
                'hard': 10
            }
        else:
            return {
                'easy': 60,
                'medium': duration_seconds // 2,
                'hard': 15
            }
    
    def _validate_timestamps(self, timestamps: Dict[str, int], duration_seconds: int) -> Dict[str, int]:
        """Ensure timestamps are valid and within bounds"""
        validated = {}
        
        for difficulty, timestamp in timestamps.items():
            # Ensure timestamp is within video duration
            validated[difficulty] = max(5, min(timestamp, duration_seconds - 30))
        
        # Ensure hard is early, easy is later
        if validated.get('hard', 0) > validated.get('easy', 0):
            validated['hard'], validated['easy'] = validated['easy'], validated['hard']
        
        return validated

async def update_song_heatmap(db: Session, song_id: int) -> bool:
    """
    Update heatmap data for a specific song
    """
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song or not song.youtube_id:
        return False
    
    async with YouTubeHeatmapService() as heatmap_service:
        # Fetch heatmap data
        heatmap_data = await heatmap_service.get_heatmap_data(song.youtube_id)
        
        if heatmap_data:
            # Store raw heatmap data
            song.heatmap_data = json.dumps(heatmap_data)
            song.heatmap_last_updated = datetime.utcnow()
            
            # Analyze and update difficulty timestamps
            timestamps = heatmap_service.analyze_heatmap_segments(
                heatmap_data, 
                song.duration_seconds or 180
            )
            
            song.difficulty_easy_start = timestamps.get('easy', 30)
            song.difficulty_medium_start = timestamps.get('medium', 60)
            song.difficulty_hard_start = timestamps.get('hard', 10)
            
            db.commit()
            logger.info(f"Updated heatmap for song {song.title} ({song.youtube_id})")
            return True
        
        return False

async def batch_update_heatmaps(db: Session, limit: int = 10) -> int:
    """
    Update heatmap data for songs that need it
    """
    # Get songs without recent heatmap data
    cutoff_date = datetime.utcnow() - timedelta(days=7)
    
    songs = db.query(Song).filter(
        Song.youtube_id.isnot(None),
        Song.is_active == True,
        (Song.heatmap_last_updated.is_(None)) | (Song.heatmap_last_updated < cutoff_date)
    ).limit(limit).all()
    
    updated_count = 0
    
    for song in songs:
        try:
            if await update_song_heatmap(db, song.id):
                updated_count += 1
            
            # Rate limiting
            await asyncio.sleep(1)
            
        except Exception as e:
            logger.error(f"Failed to update heatmap for song {song.id}: {e}")
    
    return updated_count