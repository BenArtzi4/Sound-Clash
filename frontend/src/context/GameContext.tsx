import React, { createContext, useContext, useReducer, ReactNode } from 'react';

// Types for our game state
export interface GameState {
  gameCode: string | null;
  teamName: string | null;
  isManager: boolean;
  gameStatus: 'waiting' | 'active' | 'ended';
  teams: string[];
  error: string | null;
  loading: boolean;
}

// Action types for state updates
export type GameAction =
  | { type: 'SET_GAME_CODE'; payload: string }
  | { type: 'SET_TEAM_NAME'; payload: string }
  | { type: 'SET_IS_MANAGER'; payload: boolean }
  | { type: 'SET_GAME_STATUS'; payload: 'waiting' | 'active' | 'ended' }
  | { type: 'SET_TEAMS'; payload: string[] }
  | { type: 'ADD_TEAM'; payload: string }
  | { type: 'REMOVE_TEAM'; payload: string }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'RESET_GAME' };

// Initial state
const initialState: GameState = {
  gameCode: null,
  teamName: null,
  isManager: false,
  gameStatus: 'waiting',
  teams: [],
  error: null,
  loading: false,
};

// Reducer function
function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_GAME_CODE':
      return { ...state, gameCode: action.payload };
    case 'SET_TEAM_NAME':
      return { ...state, teamName: action.payload };
    case 'SET_IS_MANAGER':
      return { ...state, isManager: action.payload };
    case 'SET_GAME_STATUS':
      return { ...state, gameStatus: action.payload };
    case 'SET_TEAMS':
      return { ...state, teams: action.payload };
    case 'ADD_TEAM':
      return { ...state, teams: [...state.teams, action.payload] };
    case 'REMOVE_TEAM':
      return { 
        ...state, 
        teams: state.teams.filter(team => team !== action.payload) 
      };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'RESET_GAME':
      return initialState;
    default:
      return state;
  }
}

// Context type
interface GameContextType {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  // Helper functions
  joinGame: (gameCode: string, teamName: string) => void;
  createGame: (gameCode: string) => void;
  leaveGame: () => void;
}

// Create context
const GameContext = createContext<GameContextType | undefined>(undefined);

// Provider component
interface GameProviderProps {
  children: ReactNode;
}

export function GameProvider({ children }: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  // Helper function to join a game
  const joinGame = (gameCode: string, teamName: string) => {
    dispatch({ type: 'SET_GAME_CODE', payload: gameCode });
    dispatch({ type: 'SET_TEAM_NAME', payload: teamName });
    dispatch({ type: 'SET_IS_MANAGER', payload: false });
    
    // Save to localStorage for persistence
    localStorage.setItem('sound-clash-game', JSON.stringify({
      gameCode,
      teamName,
      isManager: false,
    }));
  };

  // Helper function to create a game (as manager)
  const createGame = (gameCode: string) => {
    dispatch({ type: 'SET_GAME_CODE', payload: gameCode });
    dispatch({ type: 'SET_IS_MANAGER', payload: true });
    dispatch({ type: 'SET_TEAM_NAME', payload: null }); // Managers don't have team names
    
    // Save to localStorage for persistence
    localStorage.setItem('sound-clash-game', JSON.stringify({
      gameCode,
      teamName: null,
      isManager: true,
    }));
  };

  // Helper function to leave/reset game
  const leaveGame = () => {
    dispatch({ type: 'RESET_GAME' });
    localStorage.removeItem('sound-clash-game');
  };

  const value: GameContextType = {
    state,
    dispatch,
    joinGame,
    createGame,
    leaveGame,
  };

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
}

// Custom hook to use game context
export function useGame() {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}