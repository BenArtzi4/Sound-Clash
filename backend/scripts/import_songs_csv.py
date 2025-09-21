"""
CSV import script for simplified song database
"""

import csv
import asyncio
import sys
import os
from typing import List, Dict
from sqlalchemy.orm import Session

# Add the correct paths to find the modules
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
game_management_dir = os.path.join(backend_dir, 'game-management')
shared_dir = os.path.join(backend_dir, 'shared')

sys.path.append(backend_dir)
sys.path.append(game_management_dir)
sys.path.append(shared_dir)

# Now import from the correct locations
from database.postgres import get_db
from database.models import Song, Genre
from services.youtube_heatmap_service import update_song_heatmap

async def import_songs_from_csv(csv_file_path: str, update_heatmaps: bool = True) -> int:
    """
    Import songs from CSV file with simplified schema
    
    Expected CSV format:
    title,artist,duration_seconds,youtube_id,genres,difficulty_easy_start,difficulty_medium_start,difficulty_hard_start,movie_tv_source
    """
    db = next(get_db())
    imported_count = 0
    updated_count = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            
            # Validate CSV headers
            required_fields = ['title', 'artist', 'youtube_id', 'genres']
            missing_fields = [field for field in required_fields if field not in reader.fieldnames]
            
            if missing_fields:
                raise ValueError(f"Missing required CSV fields: {missing_fields}")
            
            print(f"Starting import from {csv_file_path}...")
            print(f"Expected fields: {reader.fieldnames}")
            
            for row_num, row in enumerate(reader, 1):
                try:
                    # Skip comment rows
                    if row['title'].startswith('#'):
                        continue
                    
                    # Check if song already exists
                    existing_song = db.query(Song).filter(
                        Song.title == row['title'],
                        Song.artist == row['artist']
                    ).first()
                    
                    if existing_song:
                        print(f"Row {row_num}: Song '{row['title']}' by {row['artist']} already exists, skipping...")
                        continue
                    
                    # Parse genres
                    genre_slugs = [slug.strip() for slug in row['genres'].split(',') if slug.strip()]
                    
                    # Validate genres exist
                    genres = []
                    for slug in genre_slugs:
                        genre = db.query(Genre).filter(Genre.slug == slug).first()
                        if genre:
                            genres.append(genre)
                        else:
                            print(f"Warning: Genre '{slug}' not found for song '{row['title']}'")
                    
                    if not genres:
                        print(f"Row {row_num}: No valid genres found for '{row['title']}', skipping...")
                        continue
                    
                    # Create song object
                    song_data = {
                        'title': row['title'].strip(),
                        'artist': row['artist'].strip(),
                        'youtube_id': row['youtube_id'].strip() if row.get('youtube_id') else None,
                        'duration_seconds': int(row['duration_seconds']) if row.get('duration_seconds') else 180,
                        'difficulty_easy_start': int(row['difficulty_easy_start']) if row.get('difficulty_easy_start') else 30,
                        'difficulty_medium_start': int(row['difficulty_medium_start']) if row.get('difficulty_medium_start') else 60,
                        'difficulty_hard_start': int(row['difficulty_hard_start']) if row.get('difficulty_hard_start') else 10,
                        'movie_tv_source': row.get('movie_tv_source', '').strip() or None,
                        'is_active': True
                    }
                    
                    # Set YouTube URL if ID is provided
                    if song_data['youtube_id']:
                        song_data['youtube_url'] = f"https://www.youtube.com/watch?v={song_data['youtube_id']}"
                    
                    # Create song
                    song = Song(**song_data)
                    song.genres = genres
                    
                    db.add(song)
                    db.commit()
                    
                    imported_count += 1
                    print(f"Row {row_num}: Imported '{song.title}' by {song.artist}")
                    
                    # Update heatmap data if requested and YouTube ID exists
                    if update_heatmaps and song.youtube_id:
                        try:
                            if await update_song_heatmap(db, song.id):
                                updated_count += 1
                                print(f"  - Updated heatmap data for '{song.title}'")
                            else:
                                print(f"  - No heatmap data available for '{song.title}'")
                        except Exception as e:
                            print(f"  - Failed to update heatmap for '{song.title}': {e}")
                        
                        # Rate limiting for API calls
                        await asyncio.sleep(1)
                    
                except Exception as e:
                    print(f"Error processing row {row_num}: {e}")
                    db.rollback()
                    continue
    
    except Exception as e:
        print(f"Import failed: {e}")
        db.rollback()
        raise e
    
    finally:
        db.close()
    
    print(f"\nImport completed!")
    print(f"Songs imported: {imported_count}")
    if update_heatmaps:
        print(f"Heatmaps updated: {updated_count}")
    
    return imported_count

def create_sample_csv(output_path: str = "sample_songs.csv"):
    """Create a sample CSV file with the new simplified format"""
    
    sample_data = [
        {
            'title': 'Bohemian Rhapsody',
            'artist': 'Queen',
            'duration_seconds': '355',
            'youtube_id': 'fJ9rUzIMcZQ',
            'genres': 'classic-rock,70s-disco',
            'difficulty_easy_start': '60',
            'difficulty_medium_start': '180',
            'difficulty_hard_start': '10',
            'movie_tv_source': "Wayne's World"
        },
        {
            'title': 'Billie Jean',
            'artist': 'Michael Jackson',
            'duration_seconds': '294',
            'youtube_id': 'Zi_XLOBDo_Y',
            'genres': 'pop,80s-new-wave',
            'difficulty_easy_start': '30',
            'difficulty_medium_start': '5',
            'difficulty_hard_start': '120',
            'movie_tv_source': ''
        },
        {
            'title': 'Smells Like Teen Spirit',
            'artist': 'Nirvana',
            'duration_seconds': '301',
            'youtube_id': 'hTWKbfoikeg',
            'genres': '90s-alternative,punk-rock',
            'difficulty_easy_start': '24',
            'difficulty_medium_start': '5',
            'difficulty_hard_start': '180',
            'movie_tv_source': ''
        }
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['title', 'artist', 'duration_seconds', 'youtube_id', 'genres', 
                     'difficulty_easy_start', 'difficulty_medium_start', 'difficulty_hard_start', 
                     'movie_tv_source']
        
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(sample_data)
    
    print(f"Sample CSV created: {output_path}")

async def main():
    """Main function to run import"""
    if len(sys.argv) < 2:
        print("Usage: python import_songs_csv.py <csv_file> [--no-heatmaps]")
        print("   or: python import_songs_csv.py --create-sample")
        sys.exit(1)
    
    if sys.argv[1] == '--create-sample':
        create_sample_csv()
        return
    
    csv_file = sys.argv[1]
    update_heatmaps = '--no-heatmaps' not in sys.argv
    
    if not os.path.exists(csv_file):
        print(f"Error: File '{csv_file}' not found")
        sys.exit(1)
    
    try:
        await import_songs_from_csv(csv_file, update_heatmaps)
    except Exception as e:
        print(f"Import failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())