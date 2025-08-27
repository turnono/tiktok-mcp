import express from "express";
import { z } from "zod";

// Backend scaffold
// - GET /post-detail?tiktok_url=...
// - GET /get-subtitles?tiktok_url=...&language_code=...
//
// Notes:
// - Implement these endpoints against official TikTok APIs and your ASR provider.
// - Optional API key: set BACKEND_API_KEY to require Authorization: Bearer <key>.

const app = express();

const PORT = Number(process.env.PORT || 8787);
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";
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

app.get("/post-detail", async (req, res) => {
  if (!requireAuth(req, res)) return;
  const parse = PostDetailQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "Missing or invalid tiktok_url" });
    return;
  }
  // Not implemented: integrate with official TikTok APIs and return normalized details
  res.status(501).json({ error: "Not Implemented: Connect to TikTok APIs for post details." });
});

app.get("/get-subtitles", async (req, res) => {
  if (!requireAuth(req, res)) return;
  const parse = SubtitleQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "Missing or invalid tiktok_url" });
    return;
  }

  // Not implemented: connect to your ASR/transcript provider and return { subtitle_content }
  res.status(501).json({ error: "Not Implemented: Provide subtitles via your ASR service." });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend scaffold listening on :${PORT}`);
});
