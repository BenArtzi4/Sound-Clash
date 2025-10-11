import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Confetti from 'react-confetti';
import Scoreboard from '../../components/display/Scoreboard';
import Logo from '../../components/common/Logo';
import '../../styles/pages/display-winner.css';

interface Team {
  name: string;
  score: number;
}

interface WinnerData {
  winner: string;
  finalScores: Team[];
  roundsPlayed: number;
}

interface DisplayWinnerProps {
  wsUrl?: string;
}

const DisplayWinner: React.FC<DisplayWinnerProps> = ({ wsUrl }) => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const [winnerData, setWinnerData] = useState<WinnerData | null>(null);
  const [showConfetti, setShowConfetti] = useState(true);
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    if (!gameCode) return;

    const baseUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8002';
    const websocket = new WebSocket(
      wsUrl || `${baseUrl}/ws/display/${gameCode}`
    );

    websocket.onopen = () => {
      console.log('Display Winner WebSocket connected');
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Display Winner received:', data);

        if (data.type === 'game_ended') {
          setWinnerData({
            winner: data.winner,
            finalScores: data.final_scores || [],
            roundsPlayed: data.rounds_played || 0,
          });
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('Display Winner WebSocket error:', error);
    };

    websocket.onclose = () => {
      console.log('Display Winner WebSocket disconnected');
    };

    return () => {
      websocket.close();
    };
  }, [gameCode, wsUrl]);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Stop confetti after 10 seconds
    const timer = setTimeout(() => {
      setShowConfetti(false);
    }, 10000);

    return () => clearTimeout(timer);
  }, []);

  if (!winnerData) {
    return (
      <div className="display-winner-loading">
        <p>Loading results...</p>
      </div>
    );
  }

  const winner = winnerData.finalScores.find((t) => t.name === winnerData.winner);
  const runnerUp = winnerData.finalScores[1];
  const thirdPlace = winnerData.finalScores[2];

  return (
    <div className="display-winner-page">
      {showConfetti && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          numberOfPieces={500}
          recycle={false}
          gravity={0.3}
        />
      )}

      <div className="winner-header">
        <Logo size="large" animated />
        <h1 className="winner-title">🎉 Game Complete! 🎉</h1>
      </div>

      <div className="winner-content">
        {/* Winner Announcement */}
        <div className="winner-announcement">
          <div className="trophy-icon">🏆</div>
          <h2 className="winner-name">{winnerData.winner}</h2>
          <p className="winner-subtitle">Champion</p>
          {winner && <p className="winner-score">{winner.score} points</p>}
        </div>

        {/* Runner-ups */}
        {(runnerUp || thirdPlace) && (
          <div className="runner-ups">
            {runnerUp && (
              <div className="runner-up-card second-place">
                <div className="medal-icon">🥈</div>
                <p className="runner-up-name">{runnerUp.name}</p>
                <p className="runner-up-score">{runnerUp.score} pts</p>
              </div>
            )}
            {thirdPlace && (
              <div className="runner-up-card third-place">
                <div className="medal-icon">🥉</div>
                <p className="runner-up-name">{thirdPlace.name}</p>
                <p className="runner-up-score">{thirdPlace.score} pts</p>
              </div>
            )}
          </div>
        )}

        {/* Full Scoreboard */}
        <div className="final-scoreboard-section">
          <h3 className="final-scoreboard-title">Final Standings</h3>
          <Scoreboard teams={winnerData.finalScores} />
        </div>

        {/* Game Summary */}
        <div className="game-summary">
          <p className="summary-text">
            Game completed with <strong>{winnerData.finalScores.length}</strong> teams
            over <strong>{winnerData.roundsPlayed}</strong> rounds
          </p>
        </div>

        {/* Thank You Message */}
        <div className="thank-you-message">
          <p>Thank you for playing Sound Clash!</p>
          <p className="play-again-text">Ready for another round?</p>
        </div>
      </div>
    </div>
  );
};

export default DisplayWinner;
