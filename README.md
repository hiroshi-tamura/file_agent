# File Agent

High-speed file operation API server with system tray

## Overview

File Agent is an API server that provides fast access to the local file system from web browsers.
It runs in the system tray and offers secure file operations with token authentication.

## Features

- ✅ **File Search** - Fast search with pattern matching including subfolders
- ✅ **File Deletion** - Delete files and folders
- ✅ **File Creation** - Create new files and folders
- ✅ **File Movement** - Move files and folders
- ✅ **File Copy** - Copy files and folders (recursive support)
- ✅ **File Reading** - Read text file contents
- ✅ **Directory Listing** - Get folder contents
- ✅ **File Writing** - Write to text files
- ✅ **Binary File Support** - Read/write binary files with Base64 encoding
- ✅ **Web File Manager** - Explorer-like web interface
- ✅ **Audio Player** - Waveform display and playback controls
- ✅ **System Tray** - Right-click menu for settings, restart, and exit
- ✅ **Settings Dialog** - GUI settings screen (auto-restart after save)

## Installation

1. Download `file_agent.exe` from the releases page
2. Place in any folder
3. Place `icon.ico` in the same folder (optional)
4. Run the executable

## Configuration

Settings are managed in the `file_agent.ini` file (same location as executable):

```ini
[Settings]
port=8767
token=your-secure-token
```

### Configuration Methods

1. **GUI Settings Dialog**: Right-click system tray icon → Settings
2. **Manual Edit**: Edit `file_agent.ini` directly, then restart

## API Specification

### Authentication

All API requests require a `token` parameter. Tokens are verified using SHA256 hashing.

### Endpoints

#### 1. Health Check
```http
GET /api/health
```

#### 2. File Reading
```http
POST /api/read
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.txt",
  "token": "your-token"
}
```

#### 3. Binary File Reading
```http
POST /api/read_binary
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.bin",
  "token": "your-token"
}
```

#### 4. File Writing
```http
POST /api/write
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.txt",
  "content": "File content",
  "token": "your-token"
}
```

#### 5. Binary File Writing
```http
POST /api/write_binary
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.bin",
  "content": "base64-encoded-data",
  "token": "your-token"
}
```

#### 6. File Deletion
```http
POST /api/delete
Content-Type: application/json

{
  "path": "C:\\path\\to\\file.txt",
  "token": "your-token"
}
```

#### 7. File Search
```http
POST /api/search
Content-Type: application/json

{
  "directory": "C:\\search\\dir",
  "pattern": "*.txt",
  "token": "your-token"
}
```

#### 8. Directory Listing
```http
GET /api/list?path=C:\\directory&token=your-token
```

#### 9. File/Folder Creation
```http
POST /api/create
Content-Type: application/json

{
  "path": "C:\\path\\to\\new\\file.txt",
  "is_directory": false,
  "token": "your-token"
}
```

#### 10. File Movement
```http
POST /api/move
Content-Type: application/json

{
  "source": "C:\\path\\to\\source.txt",
  "destination": "C:\\path\\to\\destination.txt",
  "token": "your-token"
}
```

#### 11. File Copy
```http
POST /api/copy
Content-Type: application/json

{
  "source": "C:\\path\\to\\source.txt",
  "destination": "C:\\path\\to\\copy.txt",
  "token": "your-token"
}
```

### Response Format

All APIs return responses in the following format:

```json
{
  "success": true,
  "data": "result data",
  "error": null
}
```

On error:
```json
{
  "success": false,
  "data": null,
  "error": "error message"
}
```

## Web File Manager

Access `http://localhost:8767/sample/` in your browser for a full-featured file manager:

- Windows Explorer-like interface
- Drive selection and folder tree
- Multiple view modes (list, grid, detail)
- Fast search with caching
- Audio player with waveform display
- Virtual scrolling for large directories

## JavaScript Usage Examples

```javascript
const API_BASE = 'http://localhost:8767/api';
const API_TOKEN = 'your-token';

// File reading
async function readFile(path) {
    const response = await fetch(`${API_BASE}/read`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path, token: API_TOKEN})
    });
    const data = await response.json();
    
    if (data.success) {
        console.log('File content:', data.data);
    } else {
        console.error('Error:', data.error);
    }
}

// Binary file reading
async function readBinaryFile(path) {
    const response = await fetch(`${API_BASE}/read_binary`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path, token: API_TOKEN})
    });
    const data = await response.json();
    
    if (data.success) {
        // data.data contains base64-encoded binary data
        const binaryData = atob(data.data);
        console.log('Binary file loaded');
    } else {
        console.error('Error:', data.error);
    }
}

// File search
async function searchFiles(directory, pattern) {
    const response = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({directory, pattern, token: API_TOKEN})
    });
    const data = await response.json();
    
    if (data.success) {
        console.log('Search results:', data.data);
    } else {
        console.error('Error:', data.error);
    }
}

// Directory listing
async function listDirectory(path) {
    const response = await fetch(`${API_BASE}/list?path=${encodeURIComponent(path)}&token=${encodeURIComponent(API_TOKEN)}`);
    const data = await response.json();
    
    if (data.success) {
        console.log('File list:', data.data);
    } else {
        console.error('Error:', data.error);
    }
}
```

## Security

- SHA256 token authentication
- CORS configuration
- Localhost-only access

## Technical Specifications

- **Language**: Rust
- **Web Framework**: Warp
- **Async Runtime**: Tokio
- **System Tray**: systray
- **GUI**: native-windows-gui (Windows)
- **Binary Encoding**: Base64

## System Requirements

- Windows 10/11 (64bit)
- Free space: 10MB+
- Memory: 50MB+

## License

MIT License

## Changelog

### v1.1.0
- Added binary file read/write functionality
- Added web-based file manager with Explorer-like UI
- Added audio player with waveform display
- Added fast search and caching
- Added virtual scrolling for large directories

### v1.0.0
- Initial release
- Basic file operation API implementation
- System tray support
- Settings dialog implementation