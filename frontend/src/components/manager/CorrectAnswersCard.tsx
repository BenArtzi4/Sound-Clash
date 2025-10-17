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
        <h3 className="card-title">🎯 Correct Answers</h3>
        <span className="card-subtitle">For your reference only</span>
      </div>

      <div className="answers-container">
        {/* Song Name */}
        <div className={`answer-section ${lockedComponents.song_name ? 'locked' : ''}`}>
          <div className="answer-header">
            <span className="answer-label">SONG NAME</span>
            {lockedComponents.song_name && (
              <span className="lock-indicator">
                <span className="lock-icon">✓</span>
                <span className="lock-text">Locked (+10 pts)</span>
              </span>
            )}
          </div>
          <div className="answer-value-large">
            {lockedComponents.song_name ? (
              <>
                <span className="strikethrough">{songName}</span>
              </>
            ) : (
              songName
            )}
          </div>
        </div>

        {/* Artist/Content */}
        <div className={`answer-section ${lockedComponents.artist_content ? 'locked' : ''}`}>
          <div className="answer-header">
            <span className="answer-label">
              {isSoundtrack ? 'CONTENT (MOVIE/TV/SHOW)' : 'ARTIST'}
            </span>
            {lockedComponents.artist_content && (
              <span className="lock-indicator">
                <span className="lock-icon">✓</span>
                <span className="lock-text">Locked (+5 pts)</span>
              </span>
            )}
          </div>
          <div className="answer-value-medium">
            {lockedComponents.artist_content ? (
              <>
                <span className="strikethrough">{artistOrContent}</span>
              </>
            ) : (
              artistOrContent
            )}
          </div>
        </div>
      </div>

      {/* Status Footer */}
      {(lockedComponents.song_name || lockedComponents.artist_content) && (
        <div className="card-footer">
          {lockedComponents.song_name && lockedComponents.artist_content ? (
            <span className="status-complete">🎉 Round Complete! Both components answered</span>
          ) : (
            <span className="status-partial">
              ⚡ {lockedComponents.song_name ? 'Song' : 'Artist'} locked - waiting for {lockedComponents.song_name ? (isSoundtrack ? 'content' : 'artist') : 'song'}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default CorrectAnswersCard;
