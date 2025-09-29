import React from 'react';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';

const ConnectionStatus: React.FC = () => {
  const { status, isOnline, retryConnection } = useConnectionStatus();

  // Don't show anything if connected
  if (status === 'connected') {
    return null;
  }

  const getStatusText = () => {
    switch (status) {
      case 'connecting':
        return '🔄 Connecting...';
      case 'disconnected':
        return isOnline ? '⚠️ Server Unavailable' : '📶 No Internet';
      default:
        return '✅ Connected';
    }
  };

  const getStatusClass = () => {
    return `connection-status ${status}`;
  };

  const handleClick = () => {
    if (status === 'disconnected') {
      retryConnection();
    }
  };

  return (
    <div 
      className={getStatusClass()}
      onClick={handleClick}
      style={{ cursor: status === 'disconnected' ? 'pointer' : 'default' }}
      title={status === 'disconnected' ? 'Click to retry connection' : ''}
    >
      {getStatusText()}
    </div>
  );
};

export default ConnectionStatus;