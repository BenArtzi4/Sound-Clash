"""
CSV import script for simplified song database
"""

import csv
import sys
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    """Get database connection"""
    return psycopg2.connect(
        host=os.getenv('POSTGRES_HOST'),
        port=os.getenv('POSTGRES_PORT', '5432'),
        database=os.getenv('POSTGRES_DB', 'soundclash'),
        user=os.getenv('POSTGRES_USER', 'postgres'),
        password=os.getenv('POSTGRES_PASSWORD'),
        connect_timeout=30
    )

def import_songs_from_csv(csv_file_path: str) -> int:
    """
    Import songs from CSV file with simplified schema
    
    Expected CSV format:
    title,artist,youtube_id,genres
    """
    
    if not os.path.exists(csv_file_path):
        print(f"Error: File '{csv_file_path}' not found")
        return 0
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get genre mapping
    cursor.execute("SELECT slug, id FROM genres")
    genre_map = dict(cursor.fetchall())
    print(f"Available genres: {list(genre_map.keys())}")
    
    imported_count = 0
    skipped_count = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            
            # Validate required fields
            required_fields = ['title', 'artist', 'youtube_id', 'genres']
            missing_fields = [field for field in required_fields if field not in reader.fieldnames]
            
            if missing_fields:
                print(f"Error: Missing required CSV fields: {missing_fields}")
                return 0
            
            print(f"Starting import from {csv_file_path}...")
            print(f"CSV fields: {reader.fieldnames}")
            
            for row_num, row in enumerate(reader, 1):
                try:
                    # Skip comment rows or empty rows
                    if row['title'].startswith('#') or not row['title'].strip():
                        continue
                    
                    title = row['title'].strip()
                    artist = row['artist'].strip()
                    youtube_id = row.get('youtube_id', '').strip() or None
                    
                    # Check if song already exists
                    cursor.execute(
                        "SELECT id FROM songs WHERE title = %s AND artist = %s",
                        (title, artist)
                    )
                    
                    if cursor.fetchone():
                        print(f"Row {row_num}: '{title}' by {artist} already exists, skipping...")
                        skipped_count += 1
                        continue
                    
                    # Parse genres
                    genre_slugs = [slug.strip() for slug in row['genres'].split(',') if slug.strip()]
                    
                    # Validate genres exist
                    valid_genre_ids = []
                    for slug in genre_slugs:
                        if slug in genre_map:
                            valid_genre_ids.append(genre_map[slug])
                        else:
                            print(f"Warning: Genre '{slug}' not found for song '{title}'")
                    
                    if not valid_genre_ids:
                        print(f"Row {row_num}: No valid genres found for '{title}', skipping...")
                        skipped_count += 1
                        continue
                    
                    # Insert song
                    cursor.execute("""
                        INSERT INTO songs (title, artist, youtube_id, youtube_url, is_active, play_count)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        RETURNING id
                    """, (
                        title,
                        artist,
                        youtube_id,
                        f"https://www.youtube.com/watch?v={youtube_id}" if youtube_id else None,
                        True,
                        0
                    ))
                    
                    song_id = cursor.fetchone()[0]
                    
                    # Insert genre relationships
                    for genre_id in valid_genre_ids:
                        cursor.execute(
                            "INSERT INTO song_genres (song_id, genre_id) VALUES (%s, %s)",
                            (song_id, genre_id)
                        )
                    
                    imported_count += 1
                    print(f"Row {row_num}: Imported '{title}' by {artist}")
                    
                except Exception as e:
                    print(f"Error processing row {row_num}: {e}")
                    skipped_count += 1
                    conn.rollback()
                    continue
    
        # Commit all changes
        conn.commit()
        
    except Exception as e:
        print(f"Import failed: {e}")
        conn.rollback()
        raise e
    
    finally:
        cursor.close()
        conn.close()
    
    print(f"\nImport completed!")
    print(f"Songs imported: {imported_count}")
    print(f"Songs skipped: {skipped_count}")
    
    return imported_count

def create_sample_csv(output_path: str = "sample_songs.csv"):
    """Create a sample CSV file with the simplified format"""
    
    sample_data = [
        {
            'title': 'Bohemian Rhapsody',
            'artist': 'Queen',
            'youtube_id': 'fJ9rUzIMcZQ',
            'genres': 'rock'
        },
        {
            'title': 'My Heart Will Go On',
            'artist': 'Titanic',  # Movie name as artist for soundtracks
            'youtube_id': 'F2RnxZnubCM',
            'genres': 'soundtracks'
        },
        {
            'title': 'שני משוגעים',
            'artist': 'עומר אדם',
            'youtube_id': 'Zl8GgLgNeq4',
            'genres': 'mizrahit'
        }
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['title', 'artist', 'youtube_id', 'genres']
        
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(sample_data)
    
    print(f"Sample CSV created: {output_path}")

def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python import_songs_csv.py <csv_file>     # Import songs")
        print("  python import_songs_csv.py --sample       # Create sample CSV")
        sys.exit(1)
    
    if sys.argv[1] == '--sample':
        create_sample_csv()
        return
    
    csv_file = sys.argv[1]
    
    try:
        import_songs_from_csv(csv_file)
    except Exception as e:
        print(f"Import failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()