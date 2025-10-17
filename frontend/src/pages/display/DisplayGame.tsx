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
      console.log('[Display Game] WebSocket connected');
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Display Game] Received:', data);

        switch (data.type) {
          case 'display_connected':
            // Initial connection - receive current game state
            if (data.teams) {
              console.log('[Display Game] Initial teams:', data.teams);
              console.log('[Display Game] Initial team_scores:', data.team_scores);
              const initialTeams = data.teams.map((t: any) => {
                const teamName = typeof t === 'string' ? t : t.name;
                return {
                  name: teamName,
                  score: data.team_scores?.[teamName] || 0
                };
              });
              console.log('[Display Game] Setting initial teams with scores:', initialTeams);
              setTeams(initialTeams);
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

          case 'game_state':
            // Full game state update
            if (data.teams) {
              console.log('[Display Game] Game state teams:', data.teams);
              setTeams(data.teams.map((t: any) => ({
                name: typeof t === 'string' ? t : t.name,
                score: typeof t === 'object' ? (t.score || 0) : 0
              })));
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

          case 'team_update':
            // Team scores updated
            if (data.teams) {
              console.log('[Display Game] Team scores updated:', data.teams);
              setTeams(data.teams.map((t: any) => ({
                name: typeof t === 'string' ? t : t.name,
                score: typeof t === 'object' ? (t.score || 0) : 0
              })));
            }
            break;

          case 'round_started':
            console.log('[Display Game] Round started:', data);
            setCurrentRound({
              roundNumber: data.round_number || 1,
              songName: data.song_name || '',
              artistOrContent: data.artist_or_content || '',
              isSoundtrack: data.is_soundtrack || false,
              songLocked: false,
              artistLocked: false,
            });
            setShowRoundComplete(false);
            setBuzzedTeam(null);
            setShowBuzzNotification(false);
            break;

          case 'buzzer_locked':
            console.log('[Display Game] Buzzer locked:', data.team_name);
            setBuzzedTeam(data.team_name);
            setShowBuzzNotification(true);
            // Auto-hide buzz notification after 3 seconds
            setTimeout(() => setShowBuzzNotification(false), 3000);
            break;

          case 'answer_evaluated':
            console.log('[Display Game] Answer evaluated:', data);
            // Update team scores
            if (data.team_scores) {
              console.log('[Display Game] Updating team scores:', data.team_scores);
              setTeams(prevTeams => prevTeams.map(team => ({
                ...team,
                score: data.team_scores[team.name] !== undefined
                  ? data.team_scores[team.name]
                  : team.score
              })));
            }
            // Update locked components
            if (data.locked_components) {
              setCurrentRound(prevRound => prevRound ? {
                ...prevRound,
                songLocked: data.locked_components.song_name,
                artistLocked: data.locked_components.artist_content,
              } : null);
            }
            // Highlight the team that just scored
            if (data.team_name) {
              setHighlightTeam(data.team_name);
              setTimeout(() => setHighlightTeam(null), 2000);
            }
            break;

          case 'song_restarted':
            console.log('[Display Game] Song restarted');
            // Clear buzz notification when song restarts
            setBuzzedTeam(null);
            setShowBuzzNotification(false);
            break;

          case 'round_completed':
            console.log('[Display Game] Round completed');
            setShowRoundComplete(true);
            setBuzzedTeam(null);
            setShowBuzzNotification(false);
            break;

          case 'game_started':
            console.log('[Display Game] Game started');
            // Game transitioned from waiting to playing
            break;

          case 'game_ended':
            console.log('[Display Game] Game ended');
            // Navigate to winner screen
            window.location.href = `/display/winner/${gameCode}`;
            break;

          case 'pong':
            // Heartbeat response
            break;

          default:
            console.log('[Display Game] Unhandled message type:', data.type);
        }
      } catch (error) {
        console.error('[Display Game] Error parsing WebSocket message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('[Display Game] WebSocket error:', error);
    };

    websocket.onclose = () => {
      console.log('[Display Game] WebSocket disconnected');
    };

    // Heartbeat to keep connection alive (backend has 10-minute timeout)
    const heartbeatInterval = setInterval(() => {
      if (websocket.readyState === WebSocket.OPEN) {
        console.log('[Display Game] Sending heartbeat ping');
        websocket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 3000); // Every 3 seconds

    return () => {
      clearInterval(heartbeatInterval);
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
