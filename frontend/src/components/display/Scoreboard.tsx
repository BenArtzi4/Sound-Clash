import React from 'react';
import '../../styles/components/scoreboard.css';

interface Team {
  name: string;
  score: number;
}

interface ScoreboardProps {
  teams: Team[];
  highlightTeam?: string | null;
}

const Scoreboard: React.FC<ScoreboardProps> = ({ teams, highlightTeam }) => {
  // Sort teams by score (highest first)
  const sortedTeams = [...teams].sort((a, b) => b.score - a.score);

  const getRankClass = (index: number) => {
    switch (index) {
      case 0:
        return 'rank-first';
      case 1:
        return 'rank-second';
      case 2:
        return 'rank-third';
      default:
        return '';
    }
  };

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0:
        return '🥇';
      case 1:
        return '🥈';
      case 2:
        return '🥉';
      default:
        return `${index + 1}.`;
    }
  };

  return (
    <div className="scoreboard">
      <div className="scoreboard-header">
        <h2>🏆 Leaderboard</h2>
      </div>
      <div className="scoreboard-body">
        {sortedTeams.map((team, index) => (
          <div
            key={team.name}
            className={`scoreboard-row ${getRankClass(index)} ${
              highlightTeam === team.name ? 'highlight' : ''
            }`}
          >
            <div className="rank-badge">{getRankIcon(index)}</div>
            <div className="team-name">{team.name}</div>
            <div className="team-score">{team.score}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Scoreboard;
