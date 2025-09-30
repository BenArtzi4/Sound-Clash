"""
Song Selector Service
Communicates with Song Management Service to get random songs
"""
import aiohttp
import logging
from typing import List, Optional
from models.game_state import SongInfo

logger = logging.getLogger(__name__)

class SongSelector:
    def __init__(self, song_management_url: str):
        self.song_management_url = song_management_url.rstrip('/')
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def init_session(self):
        """Initialize HTTP session"""
        if not self.session:
            self.session = aiohttp.ClientSession()
    
    async def close_session(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
            self.session = None
    
    async def select_random_song(
        self,
        genres: List[str],
        exclude_ids: List[int] = []
    ) -> Optional[SongInfo]:
        """
        Select a random song from specified genres
        
        Args:
            genres: List of genre slugs to select from
            exclude_ids: Song IDs to exclude (already played)
        
        Returns:
            SongInfo or None if no songs available
        """
        await self.init_session()
        
        try:
            url = f"{self.song_management_url}/api/songs/select"
            payload = {
                "genres": genres,
                "exclude_ids": exclude_ids,
                "count": 1
            }
            
            logger.info(f"Selecting song from genres: {genres}, excluding: {exclude_ids}")
            
            async with self.session.post(url, json=payload, timeout=10) as response:
                if response.status == 200:
                    data = await response.json()
                    
                    if data and len(data) > 0:
                        song_data = data[0]
                        
                        song = SongInfo(
                            id=song_data["id"],
                            title=song_data["title"],
                            artist=song_data["artist"],
                            youtube_id=song_data["youtube_id"],
                            genres=song_data.get("genres", [])
                        )
                        
                        logger.info(f"Selected song: {song.title} by {song.artist}")
                        return song
                    else:
                        logger.warning("No songs returned from selection")
                        return None
                else:
                    logger.error(f"Song selection failed: {response.status}")
                    return None
                    
        except aiohttp.ClientError as e:
            logger.error(f"Error selecting song: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error selecting song: {e}")
            return None
    
    async def get_song_by_id(self, song_id: int) -> Optional[SongInfo]:
        """Get a specific song by ID"""
        await self.init_session()
        
        try:
            url = f"{self.song_management_url}/api/songs/{song_id}"
            
            async with self.session.get(url, timeout=10) as response:
                if response.status == 200:
                    song_data = await response.json()
                    
                    return SongInfo(
                        id=song_data["id"],
                        title=song_data["title"],
                        artist=song_data["artist"],
                        youtube_id=song_data["youtube_id"],
                        genres=song_data.get("genres", [])
                    )
                else:
                    logger.error(f"Failed to get song {song_id}: {response.status}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error getting song by ID: {e}")
            return None
