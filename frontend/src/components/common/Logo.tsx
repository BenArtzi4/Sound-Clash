import React from 'react';
import '../../styles/components/logo.css';

interface LogoProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
  animated?: boolean;
}

const Logo: React.FC<LogoProps> = ({ size = 'medium', className = '', animated = true }) => {
  return (
    <div className={`logo ${size} ${className}`}>
      <div className={`sound-wave-icon ${size} ${animated ? 'animated' : ''}`}>
        <div className="wave-bar"></div>
        <div className="wave-bar"></div>
        <div className="wave-bar"></div>
        <div className="wave-bar"></div>
      </div>
      <span className="logo-text">Sound Clash</span>
    </div>
  );
};

export default Logo;
