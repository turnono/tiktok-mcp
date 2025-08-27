# <img src="https://cdn.worldvectorlogo.com/logos/tiktok-icon-2.svg" height="32"> TikTok MCP

![image (12)](https://github.com/user-attachments/assets/006f9983-b9dd-447c-87c6-ee27a414fd4c)

The TikTok MCP integrates TikTok access into Claude AI and other apps via your own backend. This TikTok MCP allows you to

- analyze TikTok videos to determine virality factors
- get content from TikTok videos
- chat with TikTok videos

## Available Tools

### tiktok_get_subtitle

**Description:**  
Get the subtitle (content) for a TikTok video url. This is used for getting the subtitle, content or context for a TikTok video. If no language code is provided, the tool will return the subtitle of automatic speech recognition.

**Input Parameters:**

- `tiktok_url` (required): TikTok video URL, e.g., https://www.tiktok.com/@username/video/1234567890 or https://vm.tiktok.com/1234567890
- `language_code` (optional): Language code for the subtitle, e.g., en for English, es for Spanish, fr for French, etc.

### tiktok_get_post_details

**Description:**  
Get the details of a TikTok post. Returns the details of the video like:

- Description
- Video ID
- Creator username
- Hashtags
- Number of likes, shares, comments, views and bookmarks
- Date of creation
- Duration of the video
- Available subtitles with language and source information

**Input Parameters:**

- `tiktok_url` (required): TikTok video URL, e.g., https://www.tiktok.com/@username/video/1234567890 or https://vm.tiktok.com/1234567890, or just the video ID like 7409731702890827041

### tiktok_search

**Description:**  
Search for TikTok videos based on a query. Returns a list of videos matching the search criteria with their details including description, video ID, creator, hashtags, engagement metrics, date of creation, duration and available subtitles, plus pagination metadata for continuing the search.

**Input Parameters:**

- `query` (required): Search query for TikTok videos, e.g., 'funny cats', 'dance', 'cooking tutorial'
- `cursor` (optional): Pagination cursor for getting more results
- `search_uid` (optional): Search session identifier for pagination

### tiktok_analyze_virality

**Description:**  
Analyze a TikTok video for virality signals. Fetches post details and subtitles, computes engagement ratios, and heuristically assesses hooks, CTAs, hashtags, and description cues. Returns a concise analysis and recommendations.

**Input Parameters:**

- `tiktok_url` (required): TikTok video URL (or ID)
- `language_code` (optional): Language code for subtitle analysis (e.g., en)

## Requirements

For this TikTok MCP, you need

- NodeJS v18 or higher (https://nodejs.org/)
- Git (https://git-scm.com/)
- A backend that exposes endpoints compatible with this MCP (see Backend API below)

## Setup

1. Clone the repository

```
git clone https://github.com/Seym0n/tiktok-mcp.git
```

2. Install dependencies

```
npm install
```

3. Build project

```
npm run build
```

This creates the file `build\index.js`

## Backend API

Your backend should expose the following HTTP endpoints:

- `GET /post-detail?tiktok_url=...` → returns post details with fields: description, video_id, creator, hashtags, likes, shares, comments, views, bookmarks, created_at, duration, available_subtitles (array of {language, source})
- `GET /get-subtitles?tiktok_url=...&language_code=...` → returns { subtitle_content: string }
- `GET /search?query=...&cursor=...&search_uid=...` → returns { videos: [...], metadata: { cursor, has_more, search_uid } }

Auth: If your backend requires an API key, return it via `Authorization: Bearer <key>`.

## Using in Claude AI

Add the following entry to `mcpServers`:

```
"tiktok-mcp": {
  "command": "node",
  "args": [
    "/absolute/path/to/build/index.js"
  ],
  "env": {
    "BACKEND_BASE_URL": "https://your-backend.example.com/api/mcp/",
    "BACKEND_API_KEY": "YOUR_OPTIONAL_API_KEY",
    "ENABLE_SEARCH": "false"
  }
}
```

and replace path with the `path` to TikTok MCP and `XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` with TIkNeuron API Key

so that `mcpServers` will look like this:

```
{
  "mcpServers": {
    "tiktok-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/build/index.js"
      ],
      "env": {
        "BACKEND_BASE_URL": "https://your-backend.example.com/api/mcp/",
        "BACKEND_API_KEY": "YOUR_OPTIONAL_API_KEY",
        "ENABLE_SEARCH": "false"
      }
    }
  }
}
```

## Optional: Local link-only backend

This repo includes a minimal backend for link-based analysis only (no search). It exposes:

- `GET /post-detail?tiktok_url=...`
- `GET /get-subtitles?tiktok_url=...&language_code=...`
- `GET /health`

Run it locally:

```
npm install
npm run build
npm run start:backend
```

Environment variables for the backend:

- `PORT` (optional): Port to listen on. Default `8787`.
- `BACKEND_API_KEY` (optional): If set, requests must include `Authorization: Bearer <key>`.
- `ASR_HTTP_URL` (optional): If set, `/get-subtitles` will POST `{ tiktok_url, language_code? }` to this URL and return `{ subtitle_content }` from the response.
- `ASR_HTTP_API_KEY` (optional): If set, sent as `Authorization: Bearer <ASR_HTTP_API_KEY>` to the ASR service.

Point your MCP server to the local backend by setting:

```
"BACKEND_BASE_URL": "http://127.0.0.1:8787/",
"ENABLE_SEARCH": "false"
```

Quick tests:

```
curl -sS http://127.0.0.1:8787/health
curl -sS "http://127.0.0.1:8787/post-detail?tiktok_url=https://www.tiktok.com/@scout2015/video/6718335390845095173"
curl -sS "http://127.0.0.1:8787/get-subtitles?tiktok_url=https://www.tiktok.com/@scout2015/video/6718335390845095173"
```

## Deploy on Smithery

Use these settings when creating the MCP server on Smithery ([docs](https://smithery.ai/docs)):

- Build command: `npm ci && npm run build`
- Start command: `node build/index.js`
- Runtime: Node.js 18+
- Transport: STDIO
- Environment Variables:
  - `BACKEND_BASE_URL`: e.g., `https://api.example.com/mcp/` (trailing slash recommended)
  - `ENABLE_SEARCH`: `false` for link-only MVP (set `true` only when your backend implements `/search`)
  - `BACKEND_API_KEY` (optional)
  - `ASR_HTTP_URL`, `ASR_HTTP_API_KEY` (optional; for your subtitle provider on the backend only)

Alternatively, deploy via Docker:

```
docker build -t tiktok-mcp:latest .
docker run --rm -e BACKEND_BASE_URL="https://api.example.com/mcp/" -e ENABLE_SEARCH=false tiktok-mcp:latest
```

> Note: A reachable backend is required. This MCP does not scrape or use oEmbed in production.
