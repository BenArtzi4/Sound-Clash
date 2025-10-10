# Admin Interface for Song Management - Complete Guide

## Branch Name
```
feature/admin-song-management
```

---

## What Was Built

### Admin Pages (5 Complete):
1. ✅ **Admin Dashboard** - Overview with stats and quick actions
2. ✅ **Song List** - Browse, search, filter, and manage all songs
3. ✅ **Add/Edit Song Form** - Create or update individual songs
4. ✅ **Bulk Import** - Import multiple songs from CSV file
5. ✅ **Genre Statistics** - View genre distribution and stats

### Features Implemented:
- ✅ Full CRUD operations (Create, Read, Update, Delete)
- ✅ Search and filter by genre
- ✅ Sort by title, artist, or date
- ✅ Pagination for large song lists
- ✅ YouTube ID validation
- ✅ YouTube video preview
- ✅ CSV bulk import with error handling
- ✅ Genre statistics and visualization
- ✅ Responsive design

---

## How to Access Admin Interface

### 1. Start the Application
```bash
cd frontend
npm run dev
```

### 2. Navigate to Admin
Open your browser to:
```
http://localhost:5173/admin
```

---

## How to Use Each Feature

### 📊 Admin Dashboard (`/admin`)

**Purpose:** Overview of your song library

**What you'll see:**
- Total song count
- Number of genres
- Most popular genre
- Quick action buttons
- Genre distribution chart

**Actions available:**
- Click **"View All Songs"** → Go to song list
- Click **"Add New Song"** → Add single song
- Click **"Bulk Import"** → Import from CSV
- Click **"Genre Stats"** → View detailed stats

---

### 📋 Song List (`/admin/songs`)

**Purpose:** Browse and manage all songs in database

**Features:**
1. **Search Bar** - Type song title or artist, press Enter
2. **Genre Filter** - Dropdown to filter by specific genre
3. **Sort Options** - Sort by title, artist, or date
4. **Sort Order** - Toggle ascending ↑ or descending ↓

**Each song shows:**
- Title
- Artist
- Genres (as colored tags)
- YouTube ID (clickable link)
- Duration
- Edit ✏️ and Delete 🗑️ buttons

**Actions:**
- Click **✏️ Edit** → Edit song details
- Click **🗑️ Delete** → Delete song (with confirmation)
- Click **YouTube ID** → Open video on YouTube
- Click **"➕ Add Song"** → Add new song

**Pagination:**
- Shows 20 songs per page
- Use "← Previous" and "Next →" buttons
- Shows current page number

---

### ➕ Add New Song (`/admin/songs/new`)

**Purpose:** Add a single song manually

**Form Fields:**

1. **Song Title*** (Required)
   - Enter the full song title
   - Example: "Bohemian Rhapsody"

2. **Artist*** (Required)
   - Enter artist or band name
   - Example: "Queen"

3. **YouTube ID*** (Required)
   - Enter the 11-character YouTube video ID
   - Example: `fJ9rUzIMcZQ`
   - **How to find:** YouTube URL is `youtube.com/watch?v=fJ9rUzIMcZQ`
   - The ID is the part after `v=`
   - System validates if ID exists
   - ✓ = Valid, ✗ = Invalid

4. **Duration** (Optional)
   - Duration in seconds
   - Leave empty to auto-detect
   - Example: `359` for 5 minutes 59 seconds

5. **Genres*** (Required - select at least one)
   - Check all genres that apply
   - Can select multiple genres
   - Available: rock, pop, electronic, hip-hop, soundtracks, mizrahit, israeli-rock-pop, israeli-cover, israeli-pop, israeli-rap-hip-hop

**YouTube Preview:**
- After entering valid YouTube ID, preview appears
- You can watch the video before saving

**Actions:**
- Click **"Add Song"** → Save to database
- Click **"Cancel"** → Go back without saving

---

### ✏️ Edit Song (`/admin/songs/:id/edit`)

**Purpose:** Update existing song details

**Same as Add Song, but:**
- Form is pre-filled with current song data
- Button says **"Update Song"** instead of "Add Song"
- Can modify any field
- YouTube preview shows current video

---

### 📥 Bulk Import (`/admin/songs/import`)

**Purpose:** Import many songs at once from CSV file

**Step-by-Step:**

1. **Download Template** (Optional)
   - Click **"📥 Download CSV Template"**
   - Opens a sample CSV file
   - Shows correct format

2. **Prepare Your CSV File**
   - Format: `title,artist,duration_seconds,youtube_id,genres`
   - Example row: `Bohemian Rhapsody,Queen,359,fJ9rUzIMcZQ,rock`
   - For multiple genres: `rock,pop` (comma-separated)
   - Save as `.csv` file

3. **Upload CSV**
   - Click **"📁 Choose CSV file"**
   - Select your `.csv` file
   - File content appears in preview box

4. **Review Preview**
   - Check that CSV looks correct
   - Shows number of lines
   - Can edit directly in preview box

5. **Import**
   - Click **"📥 Import Songs"**
   - Wait for processing
   - Results appear below

**Import Results:**
- ✓ **Success count** - How many songs imported
- ✗ **Errors** - List of any problems
- If errors, fix CSV and try again
- Click **"View Song Library →"** to see imported songs

**CSV Rules:**
- First line must be header: `title,artist,duration_seconds,youtube_id,genres`
- Each song on new line
- All genres must be valid (from the 10 available)
- YouTube IDs must be 11 characters
- Duration is optional

---

### 🎭 Genre Statistics (`/admin/genres`)

**Purpose:** See how songs are distributed across genres

**What you'll see:**
- Total song count
- List of all 10 genres ranked by popularity
- Each genre shows:
  - Rank (#1, #2, etc.)
  - Genre name
  - Song count
  - Percentage of total
  - Visual bar chart

**Information box:**
- Explanation of each genre
- What types of songs belong to each

---

## Backend Requirements

### API Endpoints Needed:

The admin interface expects these endpoints from `song-management` service:

```
GET    /api/songs              # List songs (with pagination, search, filters)
GET    /api/songs/{id}         # Get single song
POST   /api/songs              # Create new song
PUT    /api/songs/{id}         # Update song
DELETE /api/songs/{id}         # Delete song
GET    /api/genres/stats       # Get genre statistics
POST   /api/songs/bulk-import  # Bulk import from CSV
GET    /api/songs/validate-youtube/{id}  # Validate YouTube ID
```

### Expected Response Formats:

**GET /api/songs:**
```json
{
  "songs": [
    {
      "id": 1,
      "title": "Bohemian Rhapsody",
      "artist": "Queen",
      "youtube_id": "fJ9rUzIMcZQ",
      "duration_seconds": 359,
      "genres": ["rock"],
      "is_active": true,
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 127,
  "page": 1,
  "per_page": 20,
  "total_pages": 7
}
```

**GET /api/genres/stats:**
```json
[
  {
    "genre": "rock",
    "count": 11
  },
  {
    "genre": "pop",
    "count": 15
  }
]
```

---

## Testing Guide

### Test 1: View Dashboard
1. Navigate to `/admin`
2. ✅ Check: Stats cards show correct numbers
3. ✅ Check: Genre distribution chart displays
4. ✅ Check: All 4 action buttons work

### Test 2: Browse Songs
1. Navigate to `/admin/songs`
2. ✅ Check: Songs list displays with pagination
3. ✅ Check: Search box works (type and press Enter)
4. ✅ Check: Genre filter dropdown works
5. ✅ Check: Sort options work
6. ✅ Check: Pagination buttons work

### Test 3: Add New Song
1. Navigate to `/admin/songs/new`
2. Fill in all fields:
   - Title: "Test Song"
   - Artist: "Test Artist"
   - YouTube ID: "dQw4w9WgXcQ" (Rick Roll - known valid ID)
   - Duration: 212
   - Select genres: rock, pop
3. ✅ Check: YouTube preview loads
4. Click "Add Song"
5. ✅ Check: Redirects to song list
6. ✅ Check: New song appears in list

### Test 4: Edit Song
1. In song list, click ✏️ edit on any song
2. ✅ Check: Form loads with song data
3. Change title to "Updated Title"
4. Click "Update Song"
5. ✅ Check: Changes saved
6. ✅ Check: Returns to song list

### Test 5: Delete Song
1. In song list, click 🗑️ delete on test song
2. ✅ Check: Confirmation dialog appears
3. Click "OK"
4. ✅ Check: Song removed from list

### Test 6: Bulk Import
1. Navigate to `/admin/songs/import`
2. Click "Download CSV Template"
3. ✅ Check: CSV file downloads
4. Create test CSV:
```csv
title,artist,duration_seconds,youtube_id,genres
Test Song 1,Test Artist 1,200,dQw4w9WgXcQ,rock
Test Song 2,Test Artist 2,180,dQw4w9WgXcQ,"pop,electronic"
```
5. Upload CSV file
6. ✅ Check: Preview shows content
7. Click "Import Songs"
8. ✅ Check: Success message shows
9. ✅ Check: Songs appear in song list

### Test 7: Genre Stats
1. Navigate to `/admin/genres`
2. ✅ Check: All 10 genres listed
3. ✅ Check: Song counts displayed
4. ✅ Check: Percentages calculated correctly
5. ✅ Check: Bar charts show proportions

---

## Environment Variables

Set in `frontend/.env`:

```env
VITE_SONG_MANAGEMENT_URL=http://localhost:8000
```

If backend is on different port/host, update accordingly.

---

## Files Created

### Pages (5):
```
frontend/src/pages/admin/
├── AdminDashboard.tsx      # Main admin dashboard
├── AdminSongList.tsx       # Song list with search/filter
├── AdminSongForm.tsx       # Add/edit song form
├── AdminBulkImport.tsx     # CSV bulk import
└── AdminGenres.tsx         # Genre statistics
```

### Services (1):
```
frontend/src/services/
└── adminAPI.ts             # API client for admin operations
```

### Styles (5):
```
frontend/src/styles/pages/
├── admin-dashboard.css
├── admin-songs.css
├── admin-song-form.css
├── admin-bulk-import.css
└── admin-genres.css
```

### Updated:
```
frontend/src/App.tsx        # Added admin routes
```

---

## URL Structure

```
/admin                      # Dashboard
/admin/songs                # Song list
/admin/songs/new            # Add new song
/admin/songs/:id/edit       # Edit song
/admin/songs/import         # Bulk import
/admin/genres               # Genre stats
```

---

## Quick Start Checklist

- [ ] Create new branch: `feature/admin-song-management`
- [ ] Install dependencies: `npm install` (axios already installed)
- [ ] Start frontend: `npm run dev`
- [ ] Start backend song-management service (on port 8000)
- [ ] Navigate to `http://localhost:5173/admin`
- [ ] Test dashboard loads
- [ ] Test viewing song list
- [ ] Test adding a song
- [ ] Test editing a song
- [ ] Test deleting a song
- [ ] Test bulk import with CSV
- [ ] Test genre statistics

---

## Common Issues & Solutions

### Issue: "Network Error" when loading songs
**Solution:** Make sure backend song-management service is running on port 8000

### Issue: YouTube ID validation fails
**Solution:** Check that YouTube ID is exactly 11 characters and video exists

### Issue: Bulk import errors
**Solution:** 
- Check CSV format matches template
- Ensure all genres are valid
- Check for missing required fields

### Issue: Songs don't appear after adding
**Solution:** Refresh page or click "View All Songs" button

---

## Next Steps

After implementing admin interface:

1. **Add Authentication** (Future)
   - Protect admin routes with password
   - Add login page
   - Use JWT tokens

2. **Add More Features** (Future)
   - Export songs to CSV
   - Duplicate detection
   - Song categories
   - Playlist management

3. **Backend Integration** (Priority)
   - Ensure all API endpoints exist
   - Test with real database
   - Handle edge cases

---

**Status:** ✅ Admin Interface Complete  
**Branch:** feature/admin-song-management  
**Ready for:** Testing and backend integration
