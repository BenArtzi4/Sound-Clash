import axios, { type AxiosInstance, AxiosError } from 'axios';
import type { ApiResponse, Game, CreateGameForm, JoinGameForm, ApiError } from '../types';

// API Configuration - Updated for microservices
const GAME_API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const SONG_API_BASE_URL = import.meta.env.VITE_SONG_API_URL || 'http://localhost:8001';

class ApiService {
  private gameClient: AxiosInstance;
  private songClient: AxiosInstance;

  constructor() {
    // Game Management Service Client
    this.gameClient = axios.create({
      baseURL: GAME_API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Song Management Service Client
    this.songClient = axios.create({
      baseURL: SONG_API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Setup interceptors for both clients
    this.setupInterceptors(this.gameClient, 'GAME');
    this.setupInterceptors(this.songClient, 'SONG');
  }

private setupInterceptors(client: AxiosInstance, serviceName: string) {
    // Request interceptor
    client.interceptors.request.use(
      (config) => {
        console.log(`${serviceName} API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error(`${serviceName} API Request Error:`, error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    client.interceptors.response.use(
      (response) => {
        console.log(`${serviceName} API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error: AxiosError) => {
        console.error(`${serviceName} API Response Error:`, error.response?.status, error.message);
        return Promise.reject(this.handleError(error));
      }
    );
  }

  private handleError(error: AxiosError): ApiError {
    if (error.response) {
      // Server responded with error status
      const data = error.response.data as any;
      return {
        message: data.message || data.error || data.detail || 'Server error occurred',
        code: data.code || error.response.status.toString(),
        details: data.details || [],
      };
    } else if (error.request) {
      // Network error
      return {
        message: 'Network error. Please check your connection.',
        code: 'NETWORK_ERROR',
      };
    } else {
      // Other error
      return {
        message: error.message || 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR',
      };
    }
  }

  // Game Management APIs (using gameClient)
  async createGame(data: CreateGameForm): Promise<ApiResponse<Game>> {
    try {
      const response = await this.gameClient.post<ApiResponse<Game>>('/api/games', data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async joinGame(data: JoinGameForm): Promise<ApiResponse<Game>> {
    try {
      const response = await this.gameClient.post<ApiResponse<Game>>(
        `/api/games/${data.gameCode}/join`,
        { teamName: data.teamName }
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getGameStatus(gameCode: string): Promise<ApiResponse<Game>> {
    try {
      const response = await this.gameClient.get<ApiResponse<Game>>(`/api/games/${gameCode}/status`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getWaitingRoom(gameCode: string): Promise<ApiResponse<Game>> {
    try {
      const response = await this.gameClient.get<ApiResponse<Game>>(`/api/games/${gameCode}/waiting-room`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async startGame(gameCode: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.gameClient.post<ApiResponse<void>>(`/api/games/${gameCode}/start`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async leaveGame(gameCode: string, teamName: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.gameClient.post<ApiResponse<void>>(
        `/api/games/${gameCode}/leave`,
        { teamName }
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async deleteGame(gameCode: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.gameClient.delete<ApiResponse<void>>(`/api/games/${gameCode}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Genre Management APIs (using gameClient - existing genres endpoint)
  async getGenres(): Promise<ApiResponse<{ genres: any[], total_count: number }>> {
    try {
      const response = await this.gameClient.get<ApiResponse<{ genres: any[], total_count: number }>>('/api/genres');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getGenreCategories(): Promise<ApiResponse<Record<string, any>>> {
    try {
      const response = await this.gameClient.get<ApiResponse<Record<string, any>>>('/api/genres/categories');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getGenreDetails(genreSlug: string): Promise<ApiResponse<any>> {
    try {
      const response = await this.gameClient.get<ApiResponse<any>>(`/api/genres/${genreSlug}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getSongsByGenre(genreSlug: string, limit: number = 50, offset: number = 0): Promise<ApiResponse<any>> {
    try {
      const response = await this.gameClient.get<ApiResponse<any>>(`/api/genres/${genreSlug}/songs`, {
        params: { limit, offset }
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Song Management APIs (using songClient)
  async getAllSongs(page: number = 1, pageSize: number = 20): Promise<any[]> {
    try {
      const response = await this.songClient.get('/api/songs/', {
        params: { page, page_size: pageSize }
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getSong(id: number): Promise<any> {
    try {
      const response = await this.songClient.get(`/api/songs/${id}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async searchSongs(request: any): Promise<any> {
    try {
      const response = await this.songClient.post('/api/songs/search', request);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async createSong(request: any): Promise<any> {
    try {
      const response = await this.songClient.post('/api/songs/', request);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async updateSong(id: number, request: any): Promise<any> {
    try {
      const response = await this.songClient.put(`/api/songs/${id}`, request);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async deleteSong(id: number): Promise<void> {
    try {
      await this.songClient.delete(`/api/songs/${id}`);
    } catch (error) {
      throw error;
    }
  }

  async selectSongs(request: any): Promise<any> {
    try {
      const response = await this.songClient.post('/api/songs/select', request);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getSongGenres(): Promise<any> {
    try {
      const response = await this.songClient.get('/api/songs/genres/all');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getSongGenresByCategory(category: string): Promise<any[]> {
    try {
      const response = await this.songClient.get(`/api/songs/genres/${category}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async bulkActivateSongs(songIds: number[]): Promise<any> {
    try {
      const response = await this.songClient.post('/api/songs/bulk/activate', songIds);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async bulkDeactivateSongs(songIds: number[]): Promise<any> {
    try {
      const response = await this.songClient.post('/api/songs/bulk/deactivate', songIds);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Health check methods
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    try {
      const response = await this.gameClient.get<ApiResponse<{ status: string }>>('/health');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async songServiceHealthCheck(): Promise<any> {
    try {
      const response = await this.songClient.get('/health');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Utility method to test connections
  async testConnection(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch (error) {
      console.error('Game API connection test failed:', error);
      return false;
    }
  }

  async testSongConnection(): Promise<boolean> {
    try {
      await this.songServiceHealthCheck();
      return true;
    } catch (error) {
      console.error('Song API connection test failed:', error);
      return false;
    }
  }
}

// Create and export a singleton instance
export const apiService = new ApiService();
export default apiService;