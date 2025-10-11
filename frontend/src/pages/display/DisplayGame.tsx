import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Scoreboard from '../../components/display/Scoreboard';
import BuzzNotification from '../../components/display/BuzzNotification';
import RoundInfo from '../../components/display/RoundInfo';
import '../../styles/pages/display-game.css';

interface Team {
  name: string;
  score: number;
}

interface RoundData {
  roundNumber: number;
  songName: string;
  artistOrContent: string;
  isSoundtrack: boolean;
  songLocked: boolean;
  artistLocked: boolean;
}

interface DisplayGameProps {
  wsUrl?: string;
}

const DisplayGame: React.FC<DisplayGameProps> = ({ wsUrl }) => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentRound, setCurrentRound] = useState<RoundData | null>(null);
  const [buzzedTeam, setBuzzedTeam] = useState<string | null>(null);
  const [showBuzzNotification, setShowBuzzNotification] = useState(false);
  const [showRoundComplete, setShowRoundComplete] = useState(false);
  const [highlightTeam, setHighlightTeam] = useState<string | null>(null);

  useEffect(() => {
    if (!gameCode) return;

    const baseUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8002';
    const websocket = new WebSocket(
      wsUrl || `${baseUrl}/ws/display/${gameCode}`
    );

    websocket.onopen = () => {
      console.log('Display Game WebSocket connected');
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Display Game received:', data);

        switch (data.type) {
          case 'game_state':
            if (data.teams) {
              setTeams(data.teams);
            }
            if (data.current_round) {
              setCurrentRound({
                roundNumber: data.current_round.round_number || 1,
                songName: data.current_round.song_name || '',
                artistOrContent: data.current_round.artist_or_content || '',
                isSoundtrack: data.current_round.is_soundtrack || false,
                songLocked: data.current_round.locked_components?.song_name || false,
                artistLocked: data.current_round.locked_components?.artist_content || false,
              });
            }
            break;

          case 'round_started':
            setCurrentRound({
              roundNumber: data.round_number || 1,
              songName: data.song_name || '',
              artistOrContent: data.artist_or_content || '',
              isSoundtrack: data.is_soundtrack || false,
              songLocked: false,
              artistLocked: false,
            });
            setShowRoundComplete(false);
            break;

          case 'buzzer_locked':
            setBuzzedTeam(data.team_name);
            setShowBuzzNotification(true);
            break;

          case 'answer_evaluated':
            if (data.scores) {
              setTeams(data.scores);
            }
            if (data.locked_components && currentRound) {
              setCurrentRound({
                ...currentRound,
                songLocked: data.locked_components.song_name,
                artistLocked: data.locked_components.artist_content,
              });
            }
            // Highlight the team that just scored
            setHighlightTeam(data.team_name);
            setTimeout(() => setHighlightTeam(null), 2000);
            break;

          case 'round_completed':
            setShowRoundComplete(true);
            break;

          case 'game_ended':
            // Navigate to winner screen
            window.location.href = `/display/winner/${gameCode}`;
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('Display Game WebSocket error:', error);
    };

    websocket.onclose = () => {
      console.log('Display Game WebSocket disconnected');
    };

    return () => {
      websocket.close();
    };
  }, [gameCode, wsUrl]);

  return (
    <div className="display-game-page">
      {/* Buzz Notification (Center, Prominent) */}
      <BuzzNotification
        teamName={buzzedTeam}
        visible={showBuzzNotification}
        autoHide={true}
        duration={3000}
      />

      {/* Main Content Grid */}
      <div className="display-game-grid">
        {/* Left Side - Scoreboard (Primary Focus) */}
        <div className="scoreboard-section">
          <Scoreboard teams={teams} highlightTeam={highlightTeam} />
        </div>

        {/* Right Side - Round Information */}
        <div className="round-section">
          {currentRound && (
            <>
              <RoundInfo
                roundNumber={currentRound.roundNumber}
                songLocked={currentRound.songLocked}
                artistLocked={currentRound.artistLocked}
                isSoundtrack={currentRound.isSoundtrack}
              />

              {showRoundComplete && (
                <div className="round-complete-card">
                  <h3 className="round-complete-title">Round Complete! ✓</h3>
                  <div className="correct-answers">
                    <div className="answer-row">
                      <span className="answer-label">Song:</span>
                      <span className="answer-value">{currentRound.songName}</span>
                    </div>
                    <div className="answer-row">
                      <span className="answer-label">
                        {currentRound.isSoundtrack ? 'Content:' : 'Artist:'}
                      </span>
                      <span className="answer-value">{currentRound.artistOrContent}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {!currentRound && (
            <div className="waiting-for-round">
              <p>Waiting for next round...</p>
            </div>
          )}
        </div>
      </div>

      {/* Game Code Footer */}
      <div className="game-code-footer">
        Game Code: <strong>{gameCode}</strong>
      </div>
    </div>
  );
};

export default DisplayGame;
