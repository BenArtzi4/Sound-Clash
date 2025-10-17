import React from 'react';
import '../../styles/components/evaluation-panel.css';

interface EvaluationPanelProps {
  buzzedTeamName: string | null;
  isSoundtrack: boolean;
  onApproveSong: () => void;
  onApproveArtistContent: () => void;
  onWrongAnswer: () => void;
  disabled?: boolean;
  lockedComponents?: { song_name: boolean; artist_content: boolean };
}

const EvaluationPanel: React.FC<EvaluationPanelProps> = ({
  buzzedTeamName,
  isSoundtrack,
  onApproveSong,
  onApproveArtistContent,
  onWrongAnswer,
  disabled = false,
  lockedComponents = { song_name: false, artist_content: false },
}) => {
  if (!buzzedTeamName) {
    return null;
  }

  return (
    <div className="evaluation-panel">
      <div className="evaluation-header">
        <div className="buzz-notification">
          <span className="buzz-icon">🔔</span>
          <div className="buzz-info">
            <span className="buzz-label">Team Buzzed!</span>
            <span className="buzz-team">{buzzedTeamName}</span>
          </div>
        </div>
        <p className="evaluation-instruction">
          Listen to their answer and evaluate:
        </p>
      </div>

      <div className="evaluation-buttons">
        <button
          className={`eval-btn approve-song ${lockedComponents.song_name ? 'locked' : ''}`}
          onClick={onApproveSong}
          disabled={disabled || lockedComponents.song_name}
          title={lockedComponents.song_name ? 'Song name already awarded points' : 'Approve if song name is correct'}
        >
          <span className="btn-icon">{lockedComponents.song_name ? '✓' : '✓'}</span>
          <span className="btn-text">
            <span className="btn-label">
              {lockedComponents.song_name ? '✓ Already Awarded' : 'Approve Song'}
            </span>
            <span className="btn-points">
              {lockedComponents.song_name ? 'Given +10 pts' : '+10 pts'}
            </span>
          </span>
        </button>

        <button
          className={`eval-btn approve-artist ${lockedComponents.artist_content ? 'locked' : ''}`}
          onClick={onApproveArtistContent}
          disabled={disabled || lockedComponents.artist_content}
          title={lockedComponents.artist_content ? `${isSoundtrack ? 'Content' : 'Artist'} already awarded points` : `Approve if ${isSoundtrack ? 'content' : 'artist'} is correct`}
        >
          <span className="btn-icon">{lockedComponents.artist_content ? '✓' : '✓'}</span>
          <span className="btn-text">
            <span className="btn-label">
              {lockedComponents.artist_content
                ? '✓ Already Awarded'
                : `Approve ${isSoundtrack ? 'Content' : 'Artist'}`
              }
            </span>
            <span className="btn-points">
              {lockedComponents.artist_content ? 'Given +5 pts' : '+5 pts'}
            </span>
          </span>
        </button>

        <button
          className="eval-btn wrong-answer"
          onClick={onWrongAnswer}
          disabled={disabled}
          title="Deduct points for incorrect answer"
        >
          <span className="btn-icon">✗</span>
          <span className="btn-text">
            <span className="btn-label">Wrong Answer</span>
            <span className="btn-points">-2 pts</span>
          </span>
        </button>
      </div>

      <div className="evaluation-hint">
        <p>💡 You can approve multiple components if the team answered both correctly</p>
      </div>
    </div>
  );
};

export default EvaluationPanel;
