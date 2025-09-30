"""
Round Manager Service
Manages game rounds, state transitions, and scoring
"""
import logging
from datetime import datetime
from typing import Optional, Dict, List
from models.game_state import (
    GameData, GameState, RoundData, RoundState,
    SongInfo, BuzzerPress, TeamAnswer, RoundScore
)
from services.song_selector import SongSelector

logger = logging.getLogger(__name__)

class RoundManager:
    def __init__(self, song_selector: SongSelector):
        self.song_selector = song_selector
        self.games: Dict[str, GameData] = {}  # game_code -> GameData
    
    def create_game(
        self,
        game_code: str,
        max_rounds: int = 10,
        selected_genres: List[str] = []
    ) -> GameData:
        """Create a new game"""
        game = GameData(
            game_code=game_code,
            state=GameState.WAITING,
            max_rounds=max_rounds,
            selected_genres=selected_genres,
            created_at=datetime.now()
        )
        self.games[game_code] = game
        logger.info(f"Created game {game_code} with {max_rounds} rounds")
        return game
    
    def get_game(self, game_code: str) -> Optional[GameData]:
        """Get game data"""
        return self.games.get(game_code)
    
    async def start_game(self, game_code: str) -> Optional[GameData]:
        """Start the game (transition from WAITING to PLAYING)"""
        game = self.games.get(game_code)
        if not game:
            logger.error(f"Game {game_code} not found")
            return None
        
        if game.state != GameState.WAITING:
            logger.warning(f"Game {game_code} already started")
            return game
        
        game.state = GameState.PLAYING
        game.started_at = datetime.now()
        
        logger.info(f"Game {game_code} started")
        return game
    
    async def start_round(self, game_code: str) -> Optional[RoundData]:
        """
        Start a new round
        - Increment round number
        - Select random song
        - Set round state to SONG_PLAYING
        """
        game = self.games.get(game_code)
        if not game:
            logger.error(f"Game {game_code} not found")
            return None
        
        if game.state != GameState.PLAYING:
            logger.error(f"Game {game_code} not in PLAYING state")
            return None
        
        if game.current_round >= game.max_rounds:
            logger.warning(f"Game {game_code} already at max rounds")
            return None
        
        # Get already played song IDs
        played_song_ids = [r.song.id for r in game.rounds_history if r.song]
        
        # Select random song
        song = await self.song_selector.select_random_song(
            genres=game.selected_genres,
            exclude_ids=played_song_ids
        )
        
        if not song:
            logger.error(f"No songs available for game {game_code}")
            return None
        
        # Create new round
        game.current_round += 1
        round_data = RoundData(
            round_number=game.current_round,
            state=RoundState.SONG_PLAYING,
            song=song,
            started_at=datetime.now()
        )
        
        game.rounds_history.append(round_data)
        
        logger.info(f"Round {game.current_round} started for game {game_code}: {song.title}")
        return round_data
    
    def register_buzzer_press(
        self,
        game_code: str,
        team_name: str,
        reaction_time_ms: int
    ) -> bool:
        """
        Register a buzzer press
        Returns True if this team got the buzzer, False otherwise
        """
        game = self.games.get(game_code)
        if not game or not game.rounds_history:
            return False
        
        current_round = game.rounds_history[-1]
        
        # Check if buzzer already locked
        if current_round.state != RoundState.SONG_PLAYING:
            return False
        
        # Lock buzzer to this team
        current_round.state = RoundState.BUZZER_LOCKED
        current_round.buzzer_winner = team_name
        current_round.buzzer_press = BuzzerPress(
            team_name=team_name,
            timestamp=datetime.now(),
            reaction_time_ms=reaction_time_ms
        )
        
        logger.info(f"Team '{team_name}' won buzzer in game {game_code}")
        return True
    
    def submit_answer(
        self,
        game_code: str,
        team_name: str,
        song_name: Optional[str] = None,
        artist_name: Optional[str] = None,
        movie_tv_name: Optional[str] = None
    ) -> bool:
        """Submit team's answer"""
        game = self.games.get(game_code)
        if not game or not game.rounds_history:
            return False
        
        current_round = game.rounds_history[-1]
        
        if current_round.buzzer_winner != team_name:
            logger.warning(f"Team '{team_name}' tried to answer but didn't win buzzer")
            return False
        
        if current_round.state != RoundState.BUZZER_LOCKED:
            logger.warning(f"Cannot submit answer, round state: {current_round.state}")
            return False
        
        current_round.team_answer = TeamAnswer(
            team_name=team_name,
            song_name=song_name,
            artist_name=artist_name,
            movie_tv_name=movie_tv_name,
            submitted_at=datetime.now()
        )
        
        current_round.state = RoundState.EVALUATING
        
        logger.info(f"Team '{team_name}' submitted answer for game {game_code}")
        return True
    
    def evaluate_answer(
        self,
        game_code: str,
        song_correct: bool,
        artist_correct: bool,
        movie_tv_correct: bool
    ) -> Optional[RoundScore]:
        """
        Manager evaluates the answer and awards points
        Returns the score for this round
        """
        game = self.games.get(game_code)
        if not game or not game.rounds_history:
            return None
        
        current_round = game.rounds_history[-1]
        
        if current_round.state != RoundState.EVALUATING:
            logger.error(f"Cannot evaluate, round state: {current_round.state}")
            return None
        
        if not current_round.buzzer_winner:
            logger.error("No buzzer winner to evaluate")
            return None
        
        # Calculate points
        points = 0
        if song_correct:
            points += 10
        if artist_correct:
            points += 5
        if movie_tv_correct:
            points += 5
        
        # Create score
        score = RoundScore(
            team_name=current_round.buzzer_winner,
            song_correct=song_correct,
            artist_correct=artist_correct,
            movie_tv_correct=movie_tv_correct,
            points_earned=points
        )
        
        current_round.scores[current_round.buzzer_winner] = score
        current_round.state = RoundState.COMPLETED
        current_round.ended_at = datetime.now()
        
        # Update team total scores
        if current_round.buzzer_winner not in game.team_scores:
            game.team_scores[current_round.buzzer_winner] = 0
        game.team_scores[current_round.buzzer_winner] += points
        
        logger.info(f"Round evaluated: {current_round.buzzer_winner} earned {points} points")
        return score
    
    def end_game(self, game_code: str) -> Optional[Dict]:
        """
        End the game and determine winner
        Returns final scores and winner
        """
        game = self.games.get(game_code)
        if not game:
            return None
        
        game.state = GameState.FINISHED
        game.finished_at = datetime.now()
        
        # Determine winner (highest score)
        winner = None
        max_score = -1
        
        for team_name, score in game.team_scores.items():
            if score > max_score:
                max_score = score
                winner = team_name
        
        result = {
            "game_code": game_code,
            "winner": winner,
            "scores": game.team_scores,
            "total_rounds": game.current_round
        }
        
        logger.info(f"Game {game_code} ended. Winner: {winner} with {max_score} points")
        return result
    
    def handle_timeout(self, game_code: str) -> bool:
        """Handle buzzer timeout (no one buzzed or no answer submitted)"""
        game = self.games.get(game_code)
        if not game or not game.rounds_history:
            return False
        
        current_round = game.rounds_history[-1]
        
        # If buzzer winner exists but didn't answer in time
        if current_round.buzzer_winner:
            score = RoundScore(
                team_name=current_round.buzzer_winner,
                buzzer_timeout=True,
                points_earned=-2
            )
            
            current_round.scores[current_round.buzzer_winner] = score
            
            # Apply penalty
            if current_round.buzzer_winner not in game.team_scores:
                game.team_scores[current_round.buzzer_winner] = 0
            game.team_scores[current_round.buzzer_winner] -= 2
        
        current_round.state = RoundState.COMPLETED
        current_round.ended_at = datetime.now()
        
        logger.info(f"Timeout in game {game_code}")
        return True
