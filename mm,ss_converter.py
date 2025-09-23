"""
Convert duration from MM:SS format to seconds in CSV
"""
import csv
import re

def convert_duration_to_seconds(duration_str):
    """Convert MM:SS or M:SS to total seconds"""
    try:
        if ':' in duration_str:
            parts = duration_str.split(':')
            minutes = int(parts[0])
            seconds = int(parts[1])
            return minutes * 60 + seconds
        else:
            # Already in seconds
            return int(duration_str)
    except:
        return 180  # Default fallback

def convert_csv_durations(input_file, output_file):
    """Convert all duration fields from MM:SS to seconds"""
    
    converted_rows = []
    
    with open(input_file, 'r', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        
        for row in reader:
            # Skip comment rows
            if row['title'].startswith('#'):
                converted_rows.append(row)
                continue
            
            # Convert duration_seconds field
            if 'duration_seconds' in row:
                original = row['duration_seconds']
                converted = convert_duration_to_seconds(original)
                row['duration_seconds'] = converted
                print(f"Converted: {row['title']} - {original} → {converted} seconds")
            
            converted_rows.append(row)
    
    # Write converted data
    if converted_rows:
        fieldnames = ['title', 'artist', 'duration_seconds', 'youtube_id', 'genres']
        
        with open(output_file, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(converted_rows)
        
        print(f"\nConverted CSV saved as: {output_file}")

if __name__ == "__main__":
    convert_csv_durations("songs_simple.csv", "songs_converted.csv")