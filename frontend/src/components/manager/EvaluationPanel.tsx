import React from 'react';
import '../../styles/components/evaluation-panel.css';

interface EvaluationPanelProps {
  buzzedTeamName: string | null;
  isSoundtrack: boolean;
  onApproveSong: () => void;
  onApproveArtistContent: () => void;
  onWrongAnswer: () => void;
  disabled?: boolean;
}

const EvaluationPanel: React.FC<EvaluationPanelProps> = ({
  buzzedTeamName,
  isSoundtrack,
  onApproveSong,
  onApproveArtistContent,
  onWrongAnswer,
  disabled = false,
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
          className="eval-btn approve-song"
          onClick={onApproveSong}
          disabled={disabled}
        >
          <span className="btn-icon">✓</span>
          <span className="btn-text">
            <span className="btn-label">Approve Song</span>
            <span className="btn-points">+10 pts</span>
          </span>
        </button>

        <button
          className="eval-btn approve-artist"
          onClick={onApproveArtistContent}
          disabled={disabled}
        >
          <span className="btn-icon">✓</span>
          <span className="btn-text">
            <span className="btn-label">
              Approve {isSoundtrack ? 'Content' : 'Artist'}
            </span>
            <span className="btn-points">+5 pts</span>
          </span>
        </button>

        <button
          className="eval-btn wrong-answer"
          onClick={onWrongAnswer}
          disabled={disabled}
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
