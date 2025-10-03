import React from 'react';
import '../styles/components/buzzer-button.css';

export type BuzzerState = 'enabled' | 'disabled' | 'you_buzzed' | 'other_buzzed';

interface BuzzerButtonProps {
  state: BuzzerState;
  onBuzz: () => void;
  buzzedTeamName?: string;
}

const BuzzerButton: React.FC<BuzzerButtonProps> = ({ state, onBuzz, buzzedTeamName }) => {
  const getButtonText = () => {
    switch (state) {
      case 'enabled':
        return 'BUZZ!';
      case 'disabled':
        return 'Buzzer Locked';
      case 'you_buzzed':
        return 'You Buzzed!';
      case 'other_buzzed':
        return `${buzzedTeamName} Buzzed!`;
      default:
        return 'BUZZ!';
    }
  };

  const getSubText = () => {
    switch (state) {
      case 'enabled':
        return 'Tap when you know the answer';
      case 'disabled':
        return 'Wait for the next round';
      case 'you_buzzed':
        return 'Say your answer out loud!';
      case 'other_buzzed':
        return 'Another team was faster';
      default:
        return '';
    }
  };

  const handleClick = () => {
    if (state === 'enabled') {
      onBuzz();
    }
  };

  return (
    <div className="buzzer-container">
      <button
        className={`buzzer-button buzzer-${state}`}
        onClick={handleClick}
        disabled={state !== 'enabled'}
      >
        <span className="buzzer-text">{getButtonText()}</span>
        {state === 'you_buzzed' && (
          <span className="buzzer-pulse"></span>
        )}
      </button>
      <p className="buzzer-subtext">{getSubText()}</p>
    </div>
  );
};

export default BuzzerButton;
