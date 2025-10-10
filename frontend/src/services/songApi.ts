/**
 * API client for Song Management Service
 */

import axios, { AxiosResponse } from 'axios';

// Hardcoded HTTPS for production
const API_BASE_URL = 'https://api.soundclash.org';

const songApi = axios.create({
  baseURL: `${API_BASE_URL}/api/songs`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request/Response interfaces
export interface Song {
  id: number;
  title: string;
  artist: string;
  youtube_id?: string;
  youtube_url?: string;
  play_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  genres: string[];
}

export interface Genre {
  id: number;
  name: string;
  slug: string;
  description?: string;
  category: string;
  is_active: boolean;
  song_count: number;
}

export interface SongSearchRequest {
  search_term?: string;
  genres?: string[];
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface SongSearchResponse {
  songs: Song[];
  total_songs: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CreateSongRequest {
  title: string;
  artist: string;
  youtube_id?: string;
  genres: string[];
}

export interface UpdateSongRequest {
  title?: string;
  artist?: string;
  youtube_id?: string;
  genres?: string[];
  is_active?: boolean;
}

export interface SongSelectionRequest {
  genres: string[];
  exclude_song_ids?: number[];
  limit?: number;
}

export interface SongSelectionResponse {
  songs: Song[];
  total_available: number;
  selection_criteria: {
    genres: string[];
    excluded_count: number;
    limit: number;
  };
}

// API functions
export const songApiService = {
  // Songs
  async getAllSongs(page: number = 1, pageSize: number = 20): Promise<Song[]> {
    const response: AxiosResponse<Song[]> = await songApi.get('/', {
      params: { page, page_size: pageSize }
    });
    return response.data;
  },

  async getSong(id: number): Promise<Song> {
    const response: AxiosResponse<Song> = await songApi.get(`/${id}`);
    return response.data;
  },

  async searchSongs(request: SongSearchRequest): Promise<SongSearchResponse> {
    const response: AxiosResponse<SongSearchResponse> = await songApi.post('/search', request);
    return response.data;
  },

  async createSong(request: CreateSongRequest): Promise<Song> {
    const response: AxiosResponse<Song> = await songApi.post('/', request);
    return response.data;
  },

  async updateSong(id: number, request: UpdateSongRequest): Promise<Song> {
    const response: AxiosResponse<Song> = await songApi.put(`/${id}`, request);
    return response.data;
  },

  async deleteSong(id: number): Promise<void> {
    await songApi.delete(`/${id}`);
  },

  async selectSongs(request: SongSelectionRequest): Promise<SongSelectionResponse> {
    const response: AxiosResponse<SongSelectionResponse> = await songApi.post('/select', request);
    return response.data;
  },

  // Genres
  async getAllGenres(): Promise<{ genres: Genre[], categories: Record<string, Genre[]>, total_count: number }> {
    const response = await songApi.get('/genres/all');
    return response.data;
  },

  async getGenresByCategory(category: string): Promise<Genre[]> {
    const response: AxiosResponse<Genre[]> = await songApi.get(`/genres/${category}`);
    return response.data;
  },

  // Bulk operations
  async bulkActivate(songIds: number[]): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: string[];
    processing_time_seconds: number;
  }> {
    const response = await songApi.post('/bulk/activate', songIds);
    return response.data;
  },

  async bulkDeactivate(songIds: number[]): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: string[];
    processing_time_seconds: number;
  }> {
    const response = await songApi.post('/bulk/deactivate', songIds);
    return response.data;
  },

  // Health check
  async healthCheck(): Promise<{ status: string; service: string; timestamp: string }> {
    const response = await songApi.get('/health');
    return response.data;
  }
};

// Error handling
songApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 404) {
      throw new Error('Resource not found');
    } else if (error.response?.status === 500) {
      throw new Error('Server error occurred');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout');
    } else {
      throw new Error(error.response?.data?.detail || 'Unknown error occurred');
    }
  }
);

export default songApiService;