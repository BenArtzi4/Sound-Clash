import React from 'react';
import '../../styles/components/round-info.css';

interface RoundInfoProps {
  roundNumber: number;
  songLocked: boolean;
  artistLocked: boolean;
  isSoundtrack?: boolean;
}

const RoundInfo: React.FC<RoundInfoProps> = ({
  roundNumber,
  songLocked,
  artistLocked,
  isSoundtrack = false,
}) => {
  const getComponentStatus = () => {
    const songStatus = songLocked ? '✓ Song' : 'Song';
    const artistLabel = isSoundtrack ? 'Content' : 'Artist';
    const artistStatus = artistLocked ? `✓ ${artistLabel}` : artistLabel;

    if (songLocked && artistLocked) {
      return 'Round Complete ✓';
    }

    return `${songStatus} | ${artistStatus}`;
  };

  return (
    <div className="round-info-display">
      <div className="round-number">
        <span className="round-label">Round</span>
        <span className="round-value">{roundNumber}</span>
      </div>
      <div className="component-status">
        <span className="status-text">{getComponentStatus()}</span>
      </div>
    </div>
  );
};

export default RoundInfo;
