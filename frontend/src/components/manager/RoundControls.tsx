import React, { useState } from 'react';
import '../../styles/components/round-controls.css';

interface RoundControlsProps {
  roundNumber: number | null;
  gameState: 'waiting' | 'playing' | 'finished';
  roundState: 'idle' | 'active' | 'completed';
  onStartRound: () => void;
  onNextRound: () => void;
  onRestartSong: () => void;
  onSkipRound: () => void;
  onEndGame: () => void;
  disabled?: boolean;
}

const RoundControls: React.FC<RoundControlsProps> = ({
  roundNumber,
  gameState,
  roundState,
  onStartRound,
  onNextRound,
  onRestartSong,
  onSkipRound,
  onEndGame,
  disabled = false,
}) => {
  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);

  const handleEndGameClick = () => {
    setShowEndGameConfirm(true);
  };

  const handleEndGameConfirm = () => {
    onEndGame();
    setShowEndGameConfirm(false);
  };

  const handleEndGameCancel = () => {
    setShowEndGameConfirm(false);
  };

  return (
    <div className="round-controls">
      {/* Round Info */}
      <div className="round-info-header">
        <div className="round-number-display">
          <span className="round-label">Round</span>
          <span className="round-value">{roundNumber || '-'}</span>
        </div>
        <div className="game-state-badge">
          {gameState === 'waiting' && <span className="badge waiting">Waiting</span>}
          {gameState === 'playing' && <span className="badge playing">Playing</span>}
          {gameState === 'finished' && <span className="badge finished">Finished</span>}
        </div>
      </div>

      {/* Playback Controls */}
      {gameState === 'playing' && roundState === 'active' && (
        <div className="control-section">
          <h4 className="section-title">Playback Controls</h4>
          <div className="control-buttons">
            <button
              className="control-btn secondary"
              onClick={onRestartSong}
              disabled={disabled}
            >
              <span className="btn-icon">⏮</span>
              Restart Song
            </button>
            <button
              className="control-btn secondary"
              onClick={onSkipRound}
              disabled={disabled}
            >
              <span className="btn-icon">⏭</span>
              Skip Round
            </button>
          </div>
        </div>
      )}

      {/* Round Management Controls */}
      <div className="control-section">
        <h4 className="section-title">Round Management</h4>
        <div className="control-buttons">
          {gameState === 'playing' && roundState === 'idle' && (
            <button
              className="control-btn primary large"
              onClick={onStartRound}
              disabled={disabled}
            >
              <span className="btn-icon">▶️</span>
              Start Round
            </button>
          )}

          {gameState === 'playing' && roundState === 'completed' && (
            <button
              className="control-btn primary large"
              onClick={onNextRound}
              disabled={disabled}
            >
              <span className="btn-icon">➡️</span>
              Next Round
            </button>
          )}

          {gameState === 'playing' && (
            <button
              className="control-btn danger"
              onClick={handleEndGameClick}
              disabled={disabled}
            >
              <span className="btn-icon">🏁</span>
              End Game
            </button>
          )}
        </div>
      </div>

      {/* End Game Confirmation Modal */}
      {showEndGameConfirm && (
        <div className="modal-overlay" onClick={handleEndGameCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>End Game?</h3>
            <p>Are you sure you want to end the game now?</p>
            <p className="modal-warning">This will finish the game and show the final scores.</p>
            <div className="modal-actions">
              <button className="btn-confirm-danger" onClick={handleEndGameConfirm}>
                Yes, End Game
              </button>
              <button className="btn-cancel" onClick={handleEndGameCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoundControls;
