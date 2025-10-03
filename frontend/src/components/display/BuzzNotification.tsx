import React, { useEffect, useState } from 'react';
import '../../styles/components/buzz-notification.css';

interface BuzzNotificationProps {
  teamName: string | null;
  visible: boolean;
  autoHide?: boolean;
  duration?: number;
}

const BuzzNotification: React.FC<BuzzNotificationProps> = ({
  teamName,
  visible,
  autoHide = true,
  duration = 3000,
}) => {
  const [isVisible, setIsVisible] = useState(visible);

  useEffect(() => {
    setIsVisible(visible);

    if (visible && autoHide) {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible, autoHide, duration]);

  if (!isVisible || !teamName) {
    return null;
  }

  return (
    <div className="buzz-notification">
      <div className="buzz-notification-content">
        <div className="buzz-icon">⚡</div>
        <div className="buzz-message">
          <strong>{teamName}</strong> just buzzed!
        </div>
      </div>
    </div>
  );
};

export default BuzzNotification;
