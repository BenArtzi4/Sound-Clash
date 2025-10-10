import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../services/adminAPI';
import Logo from '../../components/common/Logo';
import '../../styles/pages/admin-bulk-import.css';

const AdminBulkImport: React.FC = () => {
  const navigate = useNavigate();
  const [csvContent, setCsvContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: string[] } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setCsvContent(event.target?.result as string);
      setResult(null);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvContent.trim()) {
      alert('Please upload a CSV file first');
      return;
    }

    try {
      setLoading(true);
      setResult(null);
      const response = await adminAPI.bulkImport(csvContent);
      setResult(response);
    } catch (error: any) {
      console.error('Error importing:', error);
      setResult({
        success: 0,
        errors: [error.response?.data?.detail || 'Import failed']
      });
    } finally {
      setLoading(false);
    }
  };

  const csvTemplate = `title,artist,duration_seconds,youtube_id,genres
Bohemian Rhapsody,Queen,359,fJ9rUzIMcZQ,rock
Billie Jean,Michael Jackson,295,Zi_XLOBDo_Y,pop
Lose Yourself,Eminem,323,_Yhyp-_hX2s,hip-hop`;

  const downloadTemplate = () => {
    const blob = new Blob([csvTemplate], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'songs_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="admin-bulk-import-page">
      <header className="admin-header">
        <div className="header-content">
          <Logo size="medium" />
          <h1>Bulk Import Songs</h1>
          <button className="btn-back" onClick={() => navigate('/admin')}>
            ← Dashboard
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-container">
          <div className="import-card">
            <h2>Import Songs from CSV</h2>
            <p className="import-description">
              Upload a CSV file with song data to import multiple songs at once.
            </p>

            {/* Template Download */}
            <div className="template-section">
              <h3>Need a template?</h3>
              <button className="btn-template" onClick={downloadTemplate}>
                📥 Download CSV Template
              </button>
              <p className="template-info">
                CSV format: <code>title,artist,duration_seconds,youtube_id,genres</code>
              </p>
            </div>

            {/* File Upload */}
            <div className="upload-section">
              <h3>Upload CSV File</h3>
              <div className="file-input-wrapper">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  id="csv-file"
                />
                <label htmlFor="csv-file" className="file-label">
                  {csvContent ? '✓ File loaded' : '📁 Choose CSV file'}
                </label>
              </div>
            </div>

            {/* CSV Preview */}
            {csvContent && (
              <div className="preview-section">
                <h3>File Preview</h3>
                <textarea
                  value={csvContent}
                  onChange={(e) => setCsvContent(e.target.value)}
                  rows={10}
                  className="csv-preview"
                  placeholder="CSV content will appear here..."
                />
                <p className="preview-info">
                  Lines: {csvContent.split('\n').length}
                </p>
              </div>
            )}

            {/* Import Button */}
            {csvContent && (
              <div className="import-actions">
                <button
                  className="btn-import"
                  onClick={handleImport}
                  disabled={loading}
                >
                  {loading ? 'Importing...' : '📥 Import Songs'}
                </button>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className={`result-section ${result.errors.length > 0 ? 'has-errors' : 'success'}`}>
                <h3>Import Results</h3>
                <div className="result-summary">
                  <p className="success-count">
                    ✓ Successfully imported: <strong>{result.success}</strong> songs
                  </p>
                  {result.errors.length > 0 && (
                    <div className="error-list">
                      <p className="error-count">
                        ✗ Errors: <strong>{result.errors.length}</strong>
                      </p>
                      <ul>
                        {result.errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <button
                  className="btn-view-songs"
                  onClick={() => navigate('/admin/songs')}
                >
                  View Song Library →
                </button>
              </div>
            )}

            {/* Instructions */}
            <div className="instructions-section">
              <h3>📋 Instructions</h3>
              <ol>
                <li>Download the CSV template or prepare your own</li>
                <li>Fill in song details: title, artist, duration, YouTube ID, genres</li>
                <li>Genres should be comma-separated (e.g., "rock,pop")</li>
                <li>Upload the CSV file using the button above</li>
                <li>Review the preview and click "Import Songs"</li>
              </ol>
              
              <h4>Available Genres:</h4>
              <div className="available-genres">
                {adminAPI.getAvailableGenres().map(genre => (
                  <span key={genre} className="genre-badge">{genre}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminBulkImport;
