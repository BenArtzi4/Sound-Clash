/**
 * WebSocket Configuration for Sound Clash
 * Manages WebSocket URL based on environment
 */

// Get the base URL for WebSocket connections
const getWebSocketBaseURL = (): string => {
  // In production, use the ALB DNS
  // In development, use localhost
  
  if (import.meta.env.PROD) {
    // Production: Use ALB DNS from environment variable or default
    const albDns = import.meta.env.VITE_ALB_DNS || 'sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com';
    return `ws://${albDns}`;
  } else {
    // Development: Use localhost
    return 'ws://localhost:8002';
  }
};

export const WEBSOCKET_CONFIG = {
  baseURL: getWebSocketBaseURL(),
  reconnectInterval: 3000, // 3 seconds
  maxReconnectAttempts: 5,
  pingInterval: 30000, // 30 seconds
  connectionTimeout: 10000, // 10 seconds
};

/**
 * Get the full WebSocket URL for a team connection
 */
export const getTeamWebSocketURL = (gameCode: string): string => {
  return `${WEBSOCKET_CONFIG.baseURL}/ws/team/${gameCode}`;
};

/**
 * Get the full WebSocket URL for a manager connection
 */
export const getManagerWebSocketURL = (gameCode: string): string => {
  return `${WEBSOCKET_CONFIG.baseURL}/ws/manager/${gameCode}`;
};

/**
 * Get the full WebSocket URL for a spectator connection
 */
export const getSpectatorWebSocketURL = (gameCode: string): string => {
  return `${WEBSOCKET_CONFIG.baseURL}/ws/spectator/${gameCode}`;
};
