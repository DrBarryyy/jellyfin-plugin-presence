# Jellyfin Presence Plugin

A Jellyfin plugin that adds a real-time user presence sidebar and media comments system to the web client.

## Features

### Presence Sidebar
- Real-time user status tracking (Online, Idle, Do Not Disturb, Offline)
- Collapsible sidebar showing all server users with avatars and status indicators
- Do Not Disturb toggle — click your own profile in the sidebar
- Auto-hides during video playback and fullscreen
- 30-second offline timeout, 120-second idle detection
- Server-Sent Events for instant updates across all clients

### Media Comments
- Leave timestamped comments on movies and episodes
- Click timestamps to seek to that point in playback
- Delete your own comments
- Next episode detection with quick-play card
- Split-screen layout: video on top, comments below
- Responsive — hides comments in landscape on mobile

## Architecture

```
Jellyfin Server
├── PresenceManager        ← Tracks user state in-memory (ConcurrentDictionary)
├── CommentStore           ← SQLite database for comment persistence
├── ScriptInjector         ← Injects JS into Jellyfin's index.html
├── PresenceController     ← REST API + SSE endpoint
└── CommentsController     ← Comment CRUD API
```

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/Presence/Heartbeat` | Yes | Client activity heartbeat |
| POST | `/api/Presence/Dnd` | Yes | Toggle Do Not Disturb |
| GET | `/api/Presence/Users` | Yes | Get all user presence info |
| GET | `/api/Presence/Events` | Yes | SSE stream for real-time updates |
| GET | `/api/Presence/Script` | No | Serves presence.js |
| GET | `/api/Presence/CommentsScript` | No | Serves comments.js |
| GET | `/api/Comments/{mediaId}` | Yes | Get comments for media |
| POST | `/api/Comments/{mediaId}` | Yes | Add comment |
| DELETE | `/api/Comments/{commentId}` | Yes | Delete own comment |

## Building

Requires .NET 9.0 SDK.

```bash
dotnet build
```

The built DLL goes into your Jellyfin plugins directory:
```
%LOCALAPPDATA%\jellyfin\plugins\Presence\
```

Restart Jellyfin after updating the plugin.

## Compatibility

- Jellyfin 10.11.x
- .NET 9.0
