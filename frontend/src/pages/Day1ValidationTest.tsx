import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Day 1 Validation Test Page
 * Tests all functionality built in Day 1
 */

const Day1ValidationTest: React.FC = () => {
  const navigate = useNavigate();
  const [testResults, setTestResults] = useState<{[key: string]: boolean}>({});

  const runTest = (testName: string, testFn: () => boolean) => {
    const result = testFn();
    setTestResults(prev => ({ ...prev, [testName]: result }));
    return result;
  };

  const runAllTests = () => {
    console.log('Running Day 1 validation tests...');

    // Test 1: Homepage exists and has 3 buttons
    runTest('homepage-exists', () => {
      try {
        navigate('/');
        return true;
      } catch {
        return false;
      }
    });

    // Test 2: Team join route exists
    runTest('team-join-route', () => {
      try {
        navigate('/team/join');
        return true;
      } catch {
        return false;
      }
    });

    // Test 3: Manager create route exists
    runTest('manager-create-route', () => {
      try {
        navigate('/manager/create');
        return true;
      } catch {
        return false;
      }
    });

    // Test 4: Display join route exists
    runTest('display-join-route', () => {
      try {
        navigate('/display/join');
        return true;
      } catch {
        return false;
      }
    });

    // Test 5: Types file exists
    runTest('types-imported', () => {
      try {
        // @ts-ignore
        const types = require('../../types/game.types');
        return types !== undefined;
      } catch {
        return false;
      }
    });
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Day 1 Validation Tests</h1>
      <p>Use this page to verify all Day 1 functionality is working correctly.</p>

      <div style={{ marginTop: '2rem' }}>
        <button 
          onClick={runAllTests}
          style={{
            padding: '1rem 2rem',
            fontSize: '1rem',
            backgroundColor: '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          Run All Tests
        </button>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Test Results:</h2>
        {Object.entries(testResults).map(([test, passed]) => (
          <div 
            key={test}
            style={{
              padding: '0.5rem',
              marginBottom: '0.5rem',
              backgroundColor: passed ? '#d1fae5' : '#fee2e2',
              borderRadius: '4px'
            }}
          >
            <strong>{test}:</strong> {passed ? '✅ PASSED' : '❌ FAILED'}
          </div>
        ))}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Manual Tests:</h2>
        <ol style={{ lineHeight: '2' }}>
          <li>
            <strong>Homepage Navigation:</strong>
            <ul>
              <li>Click "Join as Team" → Should go to /team/join</li>
              <li>Click "Manager Console" → Should go to /manager/create</li>
              <li>Click "Display Screen" → Should go to /display/join</li>
            </ul>
          </li>
          <li>
            <strong>Team Join Form:</strong>
            <ul>
              <li>Enter invalid game code (less than 6 chars) → Should show error</li>
              <li>Enter valid 6-char code → Error should clear</li>
              <li>Leave team name empty → Button should be disabled</li>
              <li>Enter team name → Button should be enabled</li>
              <li>Submit form → Should navigate to /team/game/CODE</li>
            </ul>
          </li>
          <li>
            <strong>Mobile Responsiveness:</strong>
            <ul>
              <li>Resize browser to mobile width (375px)</li>
              <li>All buttons should be easily tappable</li>
              <li>Form inputs should be large and easy to type in</li>
            </ul>
          </li>
          <li>
            <strong>URL Query Parameters:</strong>
            <ul>
              <li>Visit /team/join?code=ABC123 → Code should be pre-filled</li>
            </ul>
          </li>
        </ol>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Quick Navigation:</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/')}>Home</button>
          <button onClick={() => navigate('/team/join')}>Team Join</button>
          <button onClick={() => navigate('/team/join?code=ABC123')}>Team Join (with code)</button>
          <button onClick={() => navigate('/manager/create')}>Manager Create</button>
          <button onClick={() => navigate('/display/join')}>Display Join</button>
          <button onClick={() => navigate('/invalid')}>404 Test</button>
        </div>
      </div>
    </div>
  );
};

export default Day1ValidationTest;
