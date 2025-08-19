import express from "express";
import { z } from "zod";

// Simple link-based MVP backend
// - GET /post-detail?tiktok_url=...
// - GET /get-subtitles?tiktok_url=...&language_code=...
//
// Notes:
// - Uses TikTok oEmbed for basic metadata (description/title, author). Counts and timing data are not provided by oEmbed.
// - For shortened TikTok links (vm.tiktok.com / vt.tiktok.com), attempts to follow redirects to canonical URL.
// - Optional API key: set BACKEND_API_KEY to require Authorization: Bearer <key>.

const app = express();

const PORT = Number(process.env.PORT || 8787);
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";
const ASR_HTTP_URL = process.env.ASR_HTTP_URL || ""; // Optional: POST endpoint accepting { tiktok_url, language_code? }
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

function extractVideoIdFromUrlOrId(input: string): string | null {
  // If it's a pure numeric ID, return it
  if (/^\d{10,}$/.test(input)) return input;

  try {
    const url = new URL(input);
    // Format: https://www.tiktok.com/@username/video/1234567890123456789
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const videoIndex = pathSegments.findIndex((s) => s === "video");
    if (videoIndex >= 0 && pathSegments[videoIndex + 1]) {
      const idCandidate = pathSegments[videoIndex + 1];
      if (/^\d{10,}$/.test(idCandidate)) return idCandidate;
    }
  } catch {
    // Not a URL
  }
  return null;
}

async function resolveShortUrlIfNeeded(input: string): Promise<string> {
  try {
    const url = new URL(input);
    if (
      /(^|\.)vm\.tiktok\.com$/.test(url.hostname) ||
      /(^|\.)vt\.tiktok\.com$/.test(url.hostname)
    ) {
      // Follow redirects to get the canonical URL
      const resp = await fetch(url, { redirect: "follow" });
      return resp.url || input;
    }
    return input;
  } catch {
    return input;
  }
}

async function fetchOEmbed(targetUrl: string): Promise<{
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}> {
  const endpoint = new URL("https://www.tiktok.com/oembed");
  endpoint.searchParams.set("url", targetUrl);
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "Accept-Encoding": "gzip" },
  });
  if (!response.ok) {
    throw new Error(`oEmbed error: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as any;
}

app.get("/post-detail", async (req, res) => {
  if (!requireAuth(req, res)) return;
  const parse = PostDetailQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "Missing or invalid tiktok_url" });
    return;
  }

  const rawUrl = String(parse.data.tiktok_url);
  try {
    const resolvedUrl = await resolveShortUrlIfNeeded(rawUrl);
    const videoId =
      extractVideoIdFromUrlOrId(resolvedUrl) ||
      extractVideoIdFromUrlOrId(rawUrl) ||
      "";

    let description = "";
    let creator = "";
    try {
      const oembed = await fetchOEmbed(resolvedUrl);
      description = oembed.title || "";
      creator = oembed.author_name || "";
    } catch {
      // oEmbed failed; leave fields minimal
    }

    const hashtags = (description.match(/#[\w\d_]+/g) || []).slice(0, 20);

    res.json({
      success: true,
      details: {
        description,
        video_id: videoId,
        creator,
        hashtags,
        likes: "0",
        shares: "0",
        comments: "0",
        views: "0",
        bookmarks: "0",
        created_at: "",
        duration: 0,
        available_subtitles: [],
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
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

  // If an external ASR service is configured, forward the request
  if (ASR_HTTP_URL) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (ASR_HTTP_API_KEY) {
        headers["Authorization"] = `Bearer ${ASR_HTTP_API_KEY}`;
      }
      const resp = await fetch(ASR_HTTP_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ tiktok_url, language_code }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        throw new Error(`ASR error: ${resp.status} ${resp.statusText}`);
      }
      const data = (await resp.json()) as { subtitle_content?: string };
      res.json({ subtitle_content: data.subtitle_content || "" });
      return;
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  // Fallback: no ASR configured
  res.json({ subtitle_content: "" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Link-only backend listening on :${PORT}`);
});
