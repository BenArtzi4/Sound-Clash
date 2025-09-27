import React from 'react';

interface LogoProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ size = 'medium', className = '' }) => {
  // Simple sound wave icon using CSS
  const SoundWaveIcon = () => (
    <div className={`sound-wave-icon ${size}`}>
      <div className="wave-bar"></div>
      <div className="wave-bar"></div>
      <div className="wave-bar"></div>
      <div className="wave-bar"></div>
    </div>
  );

  return (
    <div className={`logo ${size} ${className}`}>
      <SoundWaveIcon />
      <span className="logo-text">Sound Clash</span>
    </div>
  );
};

export default Logo;