import axios, { type AxiosInstance, AxiosError } from 'axios';
import type { ApiResponse, Game, CreateGameForm, JoinGameForm, ApiError } from '../types';

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        console.log(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error: AxiosError) => {
        console.error('API Response Error:', error.response?.status, error.message);
        return Promise.reject(this.handleError(error));
      }
    );
  }

  private handleError(error: AxiosError): ApiError {
    if (error.response) {
      // Server responded with error status
      const data = error.response.data as any;
      return {
        message: data.message || data.error || 'Server error occurred',
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

  // Game Management APIs
  async createGame(data: CreateGameForm): Promise<ApiResponse<Game>> {
    try {
      const response = await this.client.post<ApiResponse<Game>>('/api/games', data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async joinGame(data: JoinGameForm): Promise<ApiResponse<Game>> {
    try {
      const response = await this.client.post<ApiResponse<Game>>(
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
      const response = await this.client.get<ApiResponse<Game>>(`/api/games/${gameCode}/status`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async getWaitingRoom(gameCode: string): Promise<ApiResponse<Game>> {
    try {
      const response = await this.client.get<ApiResponse<Game>>(`/api/games/${gameCode}/waiting-room`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async startGame(gameCode: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(`/api/games/${gameCode}/start`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async leaveGame(gameCode: string, teamName: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(
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
      const response = await this.client.delete<ApiResponse<void>>(`/api/games/${gameCode}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    try {
      const response = await this.client.get<ApiResponse<{ status: string }>>('/health');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Utility method to test connection
  async testConnection(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch (error) {
      console.error('API connection test failed:', error);
      return false;
    }
  }
}

// Create and export a singleton instance
export const apiService = new ApiService();
export default apiService;