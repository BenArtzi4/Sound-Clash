import React from 'react';
import '../../styles/components/correct-answers-card.css';

interface CorrectAnswersCardProps {
  songName: string;
  artistOrContent: string;
  isSoundtrack: boolean;
  lockedComponents?: {
    song_name: boolean;
    artist_content: boolean;
  };
  visible?: boolean;
}

const CorrectAnswersCard: React.FC<CorrectAnswersCardProps> = ({
  songName,
  artistOrContent,
  isSoundtrack,
  lockedComponents = { song_name: false, artist_content: false },
  visible = true,
}) => {
  if (!visible) {
    return null;
  }

  return (
    <div className="correct-answers-card">
      <div className="card-header">
        <h3 className="card-title">Correct Answers (For Your Reference)</h3>
        <span className="card-subtitle">Only you can see this</span>
      </div>

      <div className="answers-grid">
        <div className={`answer-item ${lockedComponents.song_name ? 'locked' : ''}`}>
          <div className="answer-label">
            <span>Song Name</span>
            {lockedComponents.song_name && <span className="lock-badge">✓ Locked</span>}
          </div>
          <div className="answer-value">{songName}</div>
        </div>

        <div className={`answer-item ${lockedComponents.artist_content ? 'locked' : ''}`}>
          <div className="answer-label">
            <span>{isSoundtrack ? 'Content (Movie/TV/Show)' : 'Artist'}</span>
            {lockedComponents.artist_content && <span className="lock-badge">✓ Locked</span>}
          </div>
          <div className="answer-value">{artistOrContent}</div>
        </div>
      </div>

      <div className="card-footer">
        <span className="status-text">
          {lockedComponents.song_name && lockedComponents.artist_content
            ? '🎉 Round Complete! Both components locked'
            : lockedComponents.song_name
            ? `✓ Song locked | ${isSoundtrack ? 'Content' : 'Artist'} available`
            : lockedComponents.artist_content
            ? `✓ ${isSoundtrack ? 'Content' : 'Artist'} locked | Song available`
            : `Song & ${isSoundtrack ? 'Content' : 'Artist'} available`}
        </span>
      </div>
    </div>
  );
};

export default CorrectAnswersCard;
