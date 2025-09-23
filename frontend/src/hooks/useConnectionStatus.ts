import { useState, useEffect } from 'react';

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

interface ConnectionStatusHook {
  status: ConnectionStatus;
  isOnline: boolean;
  retryConnection: () => void;
}

export const useConnectionStatus = (): ConnectionStatusHook => {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const checkConnection = async (): Promise<boolean> => {
    try {
      // Try to fetch a small resource from your API
      const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.warn('Connection check failed:', error);
      return false;
    }
  };

  const updateConnectionStatus = async () => {
    if (!navigator.onLine) {
      setStatus('disconnected');
      setIsOnline(false);
      return;
    }

    setStatus('connecting');
    setIsOnline(true);
    
    const isConnected = await checkConnection();
    setStatus(isConnected ? 'connected' : 'disconnected');
  };

  const retryConnection = () => {
    updateConnectionStatus();
  };

  useEffect(() => {
    // Initial check
    updateConnectionStatus();

    // Listen for online/offline events
    const handleOnline = () => {
      setIsOnline(true);
      updateConnectionStatus();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setStatus('disconnected');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic connection check (every 30 seconds)
    const intervalId = setInterval(updateConnectionStatus, 30000);

    // Cleanup
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(intervalId);
    };
  }, []);

  return {
    status,
    isOnline,
    retryConnection
  };
};