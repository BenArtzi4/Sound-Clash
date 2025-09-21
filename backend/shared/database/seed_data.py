"""
Seed the database with initial genre and song data
"""

import json
from sqlalchemy.orm import Session
from models import Genre, Song
from database.postgres import get_db

# Spotify-inspired genre categories and data
GENRE_SEED_DATA = [
    # Decades
    {"name": "60s Rock", "slug": "60s-rock", "description": "Classic rock from the swinging sixties", "category": "decades", "sort_order": 1},
    {"name": "70s Disco & Funk", "slug": "70s-disco", "description": "Groove and disco fever", "category": "decades", "sort_order": 2},
    {"name": "80s New Wave", "slug": "80s-new-wave", "description": "Synth-pop and new wave classics", "category": "decades", "sort_order": 3},
    {"name": "90s Alternative", "slug": "90s-alternative", "description": "Grunge, indie, and alternative rock", "category": "decades", "sort_order": 4},
    {"name": "2000s Emo & Pop Punk", "slug": "2000s-emo", "description": "Emo, pop-punk, and nu-metal", "category": "decades", "sort_order": 5},
    {"name": "2010s EDM", "slug": "2010s-edm", "description": "Electronic dance music explosion", "category": "decades", "sort_order": 6},
    {"name": "2020s Viral Hits", "slug": "2020s-viral", "description": "TikTok and streaming era", "category": "decades", "sort_order": 7},
    
    # Musical Styles (Spotify-inspired)
    {"name": "Classic Rock", "slug": "classic-rock", "description": "Timeless rock anthems", "category": "styles", "sort_order": 1},
    {"name": "Pop", "slug": "pop", "description": "Chart-topping pop hits", "category": "styles", "sort_order": 2},
    {"name": "Hip-Hop", "slug": "hip-hop", "description": "Rap and hip-hop beats", "category": "styles", "sort_order": 3},
    {"name": "Indie Pop", "slug": "indie-pop", "description": "Independent and alternative pop", "category": "styles", "sort_order": 4},
    {"name": "Electronic", "slug": "electronic", "description": "Electronic and dance music", "category": "styles", "sort_order": 5},
    {"name": "R&B", "slug": "rnb", "description": "Rhythm and blues", "category": "styles", "sort_order": 6},
    {"name": "Country", "slug": "country", "description": "Country and folk music", "category": "styles", "sort_order": 7},
    {"name": "Punk Rock", "slug": "punk-rock", "description": "Raw and energetic punk", "category": "styles", "sort_order": 8},
    {"name": "Metal", "slug": "metal", "description": "Heavy metal and hard rock", "category": "styles", "sort_order": 9},
    {"name": "Reggae", "slug": "reggae", "description": "Jamaican reggae rhythms", "category": "styles", "sort_order": 10},
    
    # Israeli Music
    {"name": "Israeli Rock", "slug": "israeli-rock", "description": "Israeli rock bands and anthems", "category": "israeli", "sort_order": 1},
    {"name": "Israeli Hafla", "slug": "israeli-hafla", "description": "Party and celebration songs", "category": "israeli", "sort_order": 2},
    {"name": "Israeli Classics", "slug": "israeli-classics", "description": "Timeless Israeli songs and folk", "category": "israeli", "sort_order": 3},
    {"name": "Israeli Pop", "slug": "israeli-pop", "description": "Modern Israeli pop hits", "category": "israeli", "sort_order": 4},
    {"name": "Mizrahi", "slug": "mizrahi", "description": "Middle Eastern influenced Israeli music", "category": "israeli", "sort_order": 5},
    {"name": "Israeli Hip-Hop", "slug": "israeli-hip-hop", "description": "Israeli rap and urban music", "category": "israeli", "sort_order": 6},
    {"name": "Shirei Eretz Israel", "slug": "shirei-eretz-israel", "description": "Traditional songs of the land", "category": "israeli", "sort_order": 7},
    
    # Media & Culture
    {"name": "Movie Soundtracks", "slug": "movie-soundtracks", "description": "Iconic movie themes and songs", "category": "media", "sort_order": 1},
    {"name": "TV Show Themes", "slug": "tv-themes", "description": "Television opening themes", "category": "media", "sort_order": 2},
    {"name": "Disney", "slug": "disney", "description": "Disney animated classics", "category": "media", "sort_order": 3},
    {"name": "Video Game Music", "slug": "video-game-music", "description": "Gaming soundtracks and chiptunes", "category": "media", "sort_order": 4},
    {"name": "Anime Themes", "slug": "anime-themes", "description": "Japanese anime opening songs", "category": "media", "sort_order": 5},
    {"name": "Commercial Jingles", "slug": "commercial-jingles", "description": "Memorable advertising music", "category": "media", "sort_order": 6},
    {"name": "Meme Songs", "slug": "meme-songs", "description": "Internet viral music memes", "category": "media", "sort_order": 7},
]

# Expanded song catalog with Israeli music and 5 additional songs
SAMPLE_SONGS = [
    # International Classics
    {
        "title": "Bohemian Rhapsody",
        "artist": "Queen", 
        "album": "A Night at the Opera",
        "release_year": 1975,
        "youtube_id": "fJ9rUzIMcZQ",
        "youtube_url": "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
        "genres": ["classic-rock", "70s-disco"],
        "duration_seconds": 355,
        "difficulty_easy_start": 60,   # "Mama, just killed a man"
        "difficulty_medium_start": 180, # Piano section
        "difficulty_hard_start": 10,   # Opening
        "movie_tv_source": "Wayne's World"
    },
    {
        "title": "Billie Jean",
        "artist": "Michael Jackson",
        "album": "Thriller", 
        "release_year": 1983,
        "youtube_id": "Zi_XLOBDo_Y",
        "youtube_url": "https://www.youtube.com/watch?v=Zi_XLOBDo_Y",
        "genres": ["pop", "80s-new-wave"],
        "duration_seconds": 294,
        "difficulty_easy_start": 30,   # "Billie Jean is not my lover"
        "difficulty_medium_start": 5,  # Bass line intro
        "difficulty_hard_start": 120,  # Bridge section
    },
    {
        "title": "Smells Like Teen Spirit", 
        "artist": "Nirvana",
        "album": "Nevermind",
        "release_year": 1991,
        "youtube_id": "hTWKbfoikeg",
        "youtube_url": "https://www.youtube.com/watch?v=hTWKbfoikeg",
        "genres": ["90s-alternative", "punk-rock"],
        "duration_seconds": 301,
        "difficulty_easy_start": 24,   # Main riff
        "difficulty_medium_start": 5,  # Intro
        "difficulty_hard_start": 180,  # Solo section
    },
    {
        "title": "Hey Ya!",
        "artist": "OutKast", 
        "album": "Speakerboxxx/The Love Below",
        "release_year": 2003,
        "youtube_id": "PWgvGjAhvIw",
        "youtube_url": "https://www.youtube.com/watch?v=PWgvGjAhvIw",
        "genres": ["hip-hop", "2000s-emo"],
        "duration_seconds": 235,
        "difficulty_easy_start": 45,   # "Hey Ya!"
        "difficulty_medium_start": 15, # Verse start
        "difficulty_hard_start": 120,  # Bridge
    },
    {
        "title": "Uptown Funk",
        "artist": "Mark Ronson ft. Bruno Mars",
        "album": "Uptown Special", 
        "release_year": 2014,
        "youtube_id": "OPf0YbXqDm0",
        "youtube_url": "https://www.youtube.com/watch?v=OPf0YbXqDm0",
        "genres": ["pop", "2010s-edm"],
        "duration_seconds": 269,
        "difficulty_easy_start": 60,   # "Uptown Funk you up"
        "difficulty_medium_start": 10, # Intro
        "difficulty_hard_start": 180,  # Bridge section
    },
    
    # Israeli Music
    {
        "title": "איך שאני אוהב אותך",
        "artist": "אריק איינשטיין",
        "album": "פלאסטיק",
        "release_year": 1979,
        "youtube_id": "kzJZjlGRPes",
        "youtube_url": "https://www.youtube.com/watch?v=kzJZjlGRPes", 
        "genres": ["israeli-classics", "israeli-rock"],
        "duration_seconds": 225,
        "difficulty_easy_start": 30,
        "difficulty_medium_start": 5,
        "difficulty_hard_start": 120,
    },
    {
        "title": "מחרוזת ישראלית",
        "artist": "להקת פיקוד דרום",
        "album": "מחרוזת ישראלית",
        "release_year": 1985,
        "youtube_id": "X6szXgeIeGk",
        "youtube_url": "https://www.youtube.com/watch?v=X6szXgeIeGk",
        "genres": ["israeli-hafla", "shirei-eretz-israel"],
        "duration_seconds": 420,
        "difficulty_easy_start": 60,
        "difficulty_medium_start": 20,
        "difficulty_hard_start": 200,
    },
    {
        "title": "אני אוהב אותך חיים",
        "artist": "זהבה בן",
        "album": "Greatest Hits",
        "release_year": 1980,
        "youtube_id": "Aj5zQvU7Nes",
        "youtube_url": "https://www.youtube.com/watch?v=Aj5zQvU7Nes",
        "genres": ["israeli-classics", "mizrahi"],
        "duration_seconds": 195,
        "difficulty_easy_start": 25,
        "difficulty_medium_start": 5,
        "difficulty_hard_start": 90,
    },
    {
        "title": "גלגל ענק",
        "artist": "משינה",
        "album": "השתיקה של הכבשים",
        "release_year": 2007,
        "youtube_id": "PZ12SD4op8o", 
        "youtube_url": "https://www.youtube.com/watch?v=PZ12SD4op8o",
        "genres": ["israeli-rock", "israeli-pop"],
        "duration_seconds": 267,
        "difficulty_easy_start": 45,
        "difficulty_medium_start": 10,
        "difficulty_hard_start": 150,
    },
    {
        "title": "בואי",
        "artist": "עדן בן זקן",
        "album": "מילים ולחנים",
        "release_year": 2020,
        "youtube_id": "HBMmK1c44sE",
        "youtube_url": "https://www.youtube.com/watch?v=HBMmK1c44sE",
        "genres": ["israeli-pop", "israeli-hip-hop"],
        "duration_seconds": 213,
        "difficulty_easy_start": 30,
        "difficulty_medium_start": 8,
        "difficulty_hard_start": 120,
    }
]

async def seed_genres(db: Session):
    """Seed initial genre data"""
    print("Seeding genres...")
    
    for genre_data in GENRE_SEED_DATA:
        # Check if genre already exists
        existing = db.query(Genre).filter(Genre.slug == genre_data["slug"]).first()
        if not existing:
            genre = Genre(**genre_data)
            db.add(genre)
    
    db.commit()
    print(f"Seeded {len(GENRE_SEED_DATA)} genres")

async def seed_songs(db: Session):
    """Seed initial song data"""
    print("Seeding songs...")
    
    for song_data in SAMPLE_SONGS:
        # Extract genre slugs
        genre_slugs = song_data.pop("genres", [])
        
        # Check if song already exists
        existing = db.query(Song).filter(
            Song.title == song_data["title"],
            Song.artist == song_data["artist"]
        ).first()
        
        if not existing:
            song = Song(**song_data)
            
            # Add genre relationships
            for genre_slug in genre_slugs:
                genre = db.query(Genre).filter(Genre.slug == genre_slug).first()
                if genre:
                    song.genres.append(genre)
            
            db.add(song)
    
    db.commit()
    print(f"Seeded {len(SAMPLE_SONGS)} songs")

async def run_seed():
    """Run all seed operations"""
    db = next(get_db())
    try:
        await seed_genres(db)
        await seed_songs(db)
        print("Database seeding completed successfully!")
    except Exception as e:
        print(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_seed())