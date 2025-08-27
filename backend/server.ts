import "dotenv/config";
import express from "express";
import { z } from "zod";

// Backend implementation
// - GET /post-detail?tiktok_url=...
// - GET /get-subtitles?tiktok_url=...&language_code=...
//
// Notes:
// - Uses TikTok Research API for video details when TIKTOK_ACCESS_TOKEN is set.
// - For subtitles, forwards to your ASR HTTP endpoint if ASR_HTTP_URL is set.
// - Optional API key: set BACKEND_API_KEY to require Authorization: Bearer <key>.

const app = express();

const PORT = Number(process.env.PORT || 8787);
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || ""; // Optional: protect backend
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || ""; // TikTok Research API token
const ASR_HTTP_URL = process.env.ASR_HTTP_URL || ""; // Optional: your ASR endpoint
const ASR_HTTP_API_KEY = process.env.ASR_HTTP_API_KEY || ""; // Optional bearer for ASR service

function requireAuth(req: express.Request, res: express.Response): boolean {
  if (!BACKEND_API_KEY) return true;
  const auth = req.get("authorization") || req.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Authorization header" });
    return false;
  }
  const token = auth.slice("Bearer ".length).trim();
  if (token !== BACKEND_API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return false;
  }
  return true;
}

const PostDetailQuery = z.object({ tiktok_url: z.string().min(1) });
const SubtitleQuery = z.object({
  tiktok_url: z.string().min(1),
  language_code: z.string().optional(),
});

// (Deliberately leaving out any scraping or oEmbed shortcuts.)

function extractVideoIdFromUrlOrId(input: string): string | null {
  if (/^\d{10,}$/.test(input)) return input;
  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "video");
    if (idx >= 0 && parts[idx + 1] && /^\d{10,}$/.test(parts[idx + 1])) {
      return parts[idx + 1];
    }
  } catch {}
  return null;
}

async function fetchVideoDetailsViaResearchApi(videoId: string) {
  if (!TIKTOK_ACCESS_TOKEN) {
    return { status: 501, error: "TIKTOK_ACCESS_TOKEN is not configured" };
  }
  const endpoint = new URL(
    "https://open.tiktokapis.com/v2/research/video/query/"
  );
  const body = {
    query: `video_id: \"${videoId}\"`,
    fields: [
      "video_id",
      "description",
      "create_time",
      "duration",
      "author_id",
      "digg_count",
      "comment_count",
      "share_count",
      "play_count",
      "collect_count",
      "hashtag_names",
    ],
    max_count: 1,
  } as Record<string, unknown>;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TIKTOK_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return {
      status: 502,
      error: `TikTok API error: ${resp.status} ${resp.statusText}\n${text}`,
    };
  }
  const data = (await resp.json()) as any;
  const items = data?.data?.videos || data?.videos || [];
  const v = Array.isArray(items) ? items[0] : undefined;
  if (!v) {
    return { status: 404, error: "Video not found" };
  }
  const description = v.description || "";
  const hashtags = Array.isArray(v.hashtag_names)
    ? v.hashtag_names.map((h: string) => (h.startsWith("#") ? h : `#${h}`))
    : [];
  const details = {
    description,
    video_id: v.video_id || videoId,
    creator: v.author_id ? String(v.author_id) : "",
    hashtags,
    likes: String(v.digg_count ?? 0),
    shares: String(v.share_count ?? 0),
    comments: String(v.comment_count ?? 0),
    views: String(v.play_count ?? 0),
    bookmarks: String(v.collect_count ?? 0),
    created_at: v.create_time
      ? new Date(Number(v.create_time) * 1000).toISOString()
      : "",
    duration: Number(v.duration ?? 0),
    available_subtitles: [],
  };
  return { status: 200, details };
}

app.get("/post-detail", async (req, res) => {
  if (!requireAuth(req, res)) return;
  const parse = PostDetailQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "Missing or invalid tiktok_url" });
    return;
  }
  const rawUrl = String(parse.data.tiktok_url);
  const videoId = extractVideoIdFromUrlOrId(rawUrl);
  if (!videoId) {
    res
      .status(400)
      .json({ error: "Unable to extract video_id from tiktok_url" });
    return;
  }
  try {
    const result = await fetchVideoDetailsViaResearchApi(videoId);
    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ success: true, details: result.details });
  } catch (error) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/get-subtitles", async (req, res) => {
  if (!requireAuth(req, res)) return;
  const parse = SubtitleQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "Missing or invalid tiktok_url" });
    return;
  }
  const { tiktok_url, language_code } = parse.data;
  if (!ASR_HTTP_URL) {
    res.status(501).json({
      error: "ASR is not configured. Set ASR_HTTP_URL to enable subtitles.",
    });
    return;
  }
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (ASR_HTTP_API_KEY)
      headers["Authorization"] = `Bearer ${ASR_HTTP_API_KEY}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const resp = await fetch(ASR_HTTP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ tiktok_url, language_code }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const text = await resp.text();
      res.status(502).json({
        error: `ASR error: ${resp.status} ${resp.statusText}\n${text}`,
      });
      return;
    }
    const data = (await resp.json()) as { subtitle_content?: string };
    res.json({ subtitle_content: data.subtitle_content || "" });
  } catch (error) {
    res
      .status(502)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on :${PORT}`);
});
