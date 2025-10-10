import axios from 'axios';

const API_URL = 'https://api.soundclash.org';

export interface Song {
  id: number;
  title: string;
  artist: string;
  youtube_id: string;
  duration_seconds?: number;
  genres: string[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SongCreate {
  title: string;
  artist: string;
  youtube_id: string;
  duration_seconds?: number;
  genres: string[];
}

export interface SongUpdate {
  title?: string;
  artist?: string;
  youtube_id?: string;
  duration_seconds?: number;
  genres?: string[];
  is_active?: boolean;
}

export interface PaginatedResponse {
  songs: Song[];
  total: number;
  total_songs: number;  // Add this field
  page: number;
  per_page: number;
  total_pages: number;
}

export interface GenreStats {
  genre: string;
  count: number;
}

class AdminAPI {
  // Get all songs with pagination and filters
  async getSongs(params?: {
    page?: number;
    per_page?: number;
    search?: string;
    genre?: string;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
  }): Promise<PaginatedResponse> {
    const response = await axios.get(`${API_URL}/api/songs/`, { params });
    return response.data;
  }

  // Get single song by ID
  async getSong(id: number): Promise<Song> {
    const response = await axios.get(`${API_URL}/api/songs/${id}`);
    return response.data;
  }

  // Create new song
  async createSong(song: SongCreate): Promise<Song> {
    const response = await axios.post(`${API_URL}/api/songs/`, song);
    return response.data;
  }

  // Update existing song
  async updateSong(id: number, song: SongUpdate): Promise<Song> {
    const response = await axios.put(`${API_URL}/api/songs/${id}`, song);
    return response.data;
  }

  // Delete song
  async deleteSong(id: number): Promise<void> {
    await axios.delete(`${API_URL}/api/songs/${id}`);
  }

  // Get genre statistics
  async getGenreStats(): Promise<GenreStats[]> {
    const response = await axios.get(`${API_URL}/api/songs/genres/stats`);
    return response.data;
  }

  // Bulk import songs from CSV
  async bulkImport(csvData: string): Promise<{ success: number; errors: string[] }> {
    const response = await axios.post(`${API_URL}/api/songs/bulk-import`, { csv_data: csvData });
    return response.data;
  }

  // Validate YouTube ID
  async validateYouTubeId(youtubeId: string): Promise<{ valid: boolean; title?: string; duration?: number }> {
    try {
      const response = await axios.get(`${API_URL}/api/songs/validate-youtube/${youtubeId}`);
      return response.data;
    } catch (error) {
      return { valid: false };
    }
  }

  // Get available genres
  getAvailableGenres(): string[] {
    return [
      'rock',
      'pop',
      'electronic',
      'hip-hop',
      'soundtracks',
      'mizrahit',
      'israeli-rock-pop',
      'israeli-cover',
      'israeli-pop',
      'israeli-rap-hip-hop'
    ];
  }
}

export const adminAPI = new AdminAPI();
