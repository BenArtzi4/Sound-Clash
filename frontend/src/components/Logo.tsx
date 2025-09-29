import React from 'react';

interface LogoProps {
  size?: 'small' | 'medium' | 'large';
}

const Logo: React.FC<LogoProps> = ({ size = 'medium' }) => {
  const sizes = {
    small: { fontSize: '20px', height: '30px' },
    medium: { fontSize: '32px', height: '48px' },
    large: { fontSize: '48px', height: '64px' },
  };

  const style = sizes[size];

  return (
    <div style={{ 
      fontWeight: 'bold',
      color: 'var(--primary, #1db954)',
      fontSize: style.fontSize,
      height: style.height,
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }}>
      <span style={{ fontSize: '1.2em' }}>🎵</span>
      <span>Sound Clash</span>
    </div>
  );
};

export default Logo;
