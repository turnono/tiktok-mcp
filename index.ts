#!/usr/bin/env node

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const GET_SUBTITLE: Tool = {
  name: "tiktok_get_subtitle",
  description:
    "Get the subtitle (content) for a TikTok video url." +
    "This is used for getting the subtitle, content or context for a TikTok video." +
    "Supports TikTok video url (or video ID) as input and optionally language code from the tool post details" +
    "Returns the subtitle for the video in the requested language and format." +
    "If no language code is provided, the tool will return the subtitle of automatic speech recognition.",
  inputSchema: {
    type: "object",
    properties: {
      tiktok_url: {
        type: "string",
        description:
          "TikTok video URL, e.g., https://www.tiktok.com/@username/video/1234567890 or https://vm.tiktok.com/1234567890, or just the video ID like 7409731702890827041",
      },
      language_code: {
        type: "string",
        description:
          "Language code for the subtitle, e.g., en for English, es for Spanish, fr for French, etc.",
      },
    },
    required: ["tiktok_url"],
  },
};

const GET_POST_DETAILS: Tool = {
  name: "tiktok_get_post_details",
  description:
    "Get the details of a TikTok post." +
    "This is used for getting the details of a TikTok post." +
    "Supports TikTok video url (or video ID) as input." +
    "Returns the details of the video like" +
    " - Description" +
    " - Video ID" +
    " - Creator username" +
    " - Hashtags" +
    " - Number of likes, shares, comments, views and bookmarks" +
    " - Date of creation" +
    " - Duration of the video" +
    " - Available subtitles with language and source information",
  inputSchema: {
    type: "object",
    properties: {
      tiktok_url: {
        type: "string",
        description:
          "TikTok video URL, e.g., https://www.tiktok.com/@username/video/1234567890 or https://vm.tiktok.com/1234567890, or just the video ID like 7409731702890827041",
      },
    },
    required: ["tiktok_url"],
  },
};

const SEARCH: Tool = {
  name: "tiktok_search",
  description:
    "Search for TikTok videos based on a query." +
    "This is used for searching TikTok videos by keywords, hashtags, or other search terms." +
    "Supports search query as input and optional cursor and search_uid for pagination." +
    "Returns a list of videos matching the search criteria with their details including" +
    " - Description, video ID, creator, hashtags, engagement metrics, date of creation, duration of the video and available subtitles with language and source information" +
    " - Pagination metadata for continuing the search",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query for TikTok videos, e.g., 'funny cats', 'dance', 'cooking tutorial'",
      },
      cursor: {
        type: "string",
        description: "Pagination cursor for getting more results (optional)",
      },
      search_uid: {
        type: "string",
        description: "Search session identifier for pagination (optional)",
      },
    },
    required: ["query"],
  },
};

const ANALYZE_VIRALITY: Tool = {
  name: "tiktok_analyze_virality",
  description:
    "Analyze a TikTok video for virality signals. " +
    "Fetches post details and subtitles, computes engagement ratios, and heuristically assesses hooks, CTAs, hashtags, and description cues.",
  inputSchema: {
    type: "object",
    properties: {
      tiktok_url: {
        type: "string",
        description:
          "TikTok video URL or ID, e.g., https://www.tiktok.com/@username/video/123... or 7409731702890827041",
      },
      language_code: {
        type: "string",
        description:
          "Optional language code for subtitle analysis (e.g., en, es, fr). Defaults to ASR language.",
      },
    },
    required: ["tiktok_url"],
  },
};

// Server implementation
const server = new Server(
  {
    name: "turnono/tiktok-mcp",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Backend configuration (backend-agnostic)
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL;
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";
const ENABLE_SEARCH = String(process.env.ENABLE_SEARCH || "");

if (!BACKEND_BASE_URL) {
  console.error("Error: BACKEND_BASE_URL environment variable is required");
  process.exit(1);
}

// Normalize base URL to preserve path segments when building endpoint URLs
function getNormalizedBaseUrl(baseUrl: string): URL {
  try {
    // Ensure trailing slash so relative paths append instead of replacing the last segment
    const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(normalized);
  } catch (error) {
    console.error(
      `Error: BACKEND_BASE_URL is not a valid URL: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

const BACKEND_BASE = getNormalizedBaseUrl(BACKEND_BASE_URL);

function buildBackendUrl(endpointPath: string): URL {
  // Remove any leading slashes on endpointPath to avoid resetting to host root
  const relative = endpointPath.replace(/^\/+/, "");
  return new URL(relative, BACKEND_BASE);
}

interface Subtitle {
  success?: boolean;
  subtitles?: Array<{
    language?: string;
    source?: string;
  }>;
  subtitle_content?: string;
}

interface PostDetails {
  success: boolean;
  details: {
    description: string;
    video_id: string;
    creator: string;
    hashtags: string[];
    likes: string;
    shares: string;
    comments: string;
    views: string;
    bookmarks: string;
    created_at: string;
    duration: number;
    available_subtitles: Array<{
      language?: string;
      source?: string;
    }>;
  };
}

interface SearchResult {
  success: boolean;
  videos: Array<{
    description: string;
    video_id: string;
    creator: string;
    hashtags: string[];
    likes: string;
    shares: string;
    comments: string;
    views: string;
    bookmarks: string;
    created_at: string;
    duration: number;
    available_subtitles: Array<{
      language?: string;
      source?: string;
    }>;
  }>;
  metadata: {
    cursor: string;
    has_more: boolean;
    search_uid: string;
  };
}

function safeParseNumber(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function computeEngagementMetrics(detailsBlock: string) {
  // Parse a few key fields from the text block returned by performGetPostDetails
  const getField = (label: string) => {
    const regex = new RegExp(`${label}:\\s*(.*)`);
    const match = detailsBlock.match(regex);
    return match ? match[1].trim() : "";
  };

  const likes = safeParseNumber(getField("Likes"));
  const shares = safeParseNumber(getField("Shares"));
  const comments = safeParseNumber(getField("Comments"));
  const views = safeParseNumber(getField("Views"));
  const durationSec = safeParseNumber(
    getField("Duration").replace(/[^0-9.]/g, "")
  );

  const engagement = likes + shares + comments;
  const engagementRate = views > 0 ? engagement / views : 0;
  const socialProof = shares + comments;

  return {
    likes,
    shares,
    comments,
    views,
    durationSec,
    engagement,
    engagementRate,
    socialProof,
  };
}

function analyzeTextSignals(description: string, subtitles: string) {
  const text = `${description}\n${subtitles}`.toLowerCase();
  const hooks = [
    "wait for it",
    "you won't believe",
    "here's why",
    "no one talks about",
    "the secret",
    "hack",
    "tip",
    "trick",
    "watch till the end",
    "part 1",
    "story time",
    "stop scrolling",
    "did you know",
    "breaking",
    "warning",
  ];
  const ctas = [
    "follow for more",
    "like and follow",
    "comment",
    "share this",
    "save this",
    "link in bio",
    "dm me",
  ];
  const retentionCues = [
    "first",
    "then",
    "next",
    "finally",
    "step",
    "tutorial",
    "recipe",
    "challenge",
  ];

  const hashtagCount = (description.match(/#[\w\d_]+/g) || []).length;
  const hookHits = hooks.filter((h) => text.includes(h));
  const ctaHits = ctas.filter((c) => text.includes(c));
  const retentionHits = retentionCues.filter((r) => text.includes(r));

  return { hashtagCount, hookHits, ctaHits, retentionHits };
}

function analyzeVirality(detailsText: string, subtitleText: string): string {
  const descMatch = detailsText.match(
    /Description:\s*([\s\S]*?)\n\s*Video ID:/
  );
  const description = descMatch ? descMatch[1].trim() : "";

  const metrics = computeEngagementMetrics(detailsText);
  const signals = analyzeTextSignals(description, subtitleText || "");

  const lines: string[] = [];
  lines.push("Virality Analysis");
  lines.push("");
  lines.push(
    `Engagement: ${metrics.engagement.toLocaleString()} (likes ${metrics.likes.toLocaleString()}, shares ${metrics.shares.toLocaleString()}, comments ${metrics.comments.toLocaleString()})`
  );
  lines.push(
    `Views: ${metrics.views.toLocaleString()} | Engagement rate: ${(
      metrics.engagementRate * 100
    ).toFixed(2)}%`
  );
  if (metrics.durationSec) {
    lines.push(`Duration: ${metrics.durationSec} sec`);
  }
  lines.push("");
  lines.push("Narrative Signals");
  lines.push(
    `- Hooks detected: ${
      signals.hookHits.length > 0 ? signals.hookHits.join(", ") : "none"
    }`
  );
  lines.push(
    `- CTAs detected: ${
      signals.ctaHits.length > 0 ? signals.ctaHits.join(", ") : "none"
    }`
  );
  lines.push(
    `- Structural cues: ${
      signals.retentionHits.length > 0
        ? signals.retentionHits.join(", ")
        : "none"
    }`
  );
  lines.push(`- Hashtag count in description: ${signals.hashtagCount}`);
  lines.push("");
  lines.push("Recommendations");
  if (signals.hookHits.length === 0)
    lines.push(
      "- Add a strong first-3-second hook (e.g., a bold claim or curiosity gap)."
    );
  if (signals.ctaHits.length === 0)
    lines.push(
      "- Add a lightweight CTA (comment a keyword, follow for part 2, save for later)."
    );
  if (signals.retentionHits.length === 0)
    lines.push(
      "- Improve structure with explicit steps or narrative beats to boost retention."
    );
  if (signals.hashtagCount < 3)
    lines.push("- Add 3–5 relevant, non-spammy hashtags to aid discovery.");
  if (metrics.engagementRate < 0.05 && metrics.views > 0)
    lines.push(
      "- Engagement rate is low; test alternative opening frames/captions and tighter pacing."
    );

  return lines.join("\n");
}

function isGetSubtitleArgs(
  args: unknown
): args is { tiktok_url: string; language_code: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "tiktok_url" in args &&
    typeof (args as { tiktok_url: string }).tiktok_url === "string"
  );
}

function isGetPostDetailsArgs(args: unknown): args is { tiktok_url: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "tiktok_url" in args &&
    typeof (args as { tiktok_url: string }).tiktok_url === "string"
  );
}

function isSearchArgs(
  args: unknown
): args is { query: string; cursor?: string; search_uid?: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "query" in args &&
    typeof (args as { query: string }).query === "string" &&
    ("cursor" in args
      ? typeof (args as { cursor?: string }).cursor === "string"
      : true) &&
    ("search_uid" in args
      ? typeof (args as { search_uid?: string }).search_uid === "string"
      : true)
  );
}

async function performSearch(
  query: string,
  cursor?: string,
  search_uid?: string
) {
  const url = buildBackendUrl("search");
  url.searchParams.set("query", query);

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  if (search_uid) {
    url.searchParams.set("search_uid", search_uid);
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
  };
  if (BACKEND_API_KEY) {
    headers["Authorization"] = `Bearer ${BACKEND_API_KEY}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Backend API error: ${response.status} ${
        response.statusText
      }\n${await response.text()}`
    );
  }

  const data = (await response.json()) as SearchResult;

  if (data.videos && data.videos.length > 0) {
    const videosList = data.videos
      .map((video, index) => {
        return `Video ${index + 1}:
Description: ${video.description || "N/A"}
Video ID: ${video.video_id || "N/A"}
Creator: ${video.creator || "N/A"}
Hashtags: ${Array.isArray(video.hashtags) ? video.hashtags.join(", ") : "N/A"}
Likes: ${video.likes || "0"}
Shares: ${video.shares || "0"}
Comments: ${video.comments || "0"}
Views: ${video.views || "0"}
Bookmarks: ${video.bookmarks || "0"}
Created at: ${video.created_at || "N/A"}
Duration: ${video.duration || 0} seconds
Available subtitles: ${
          video.available_subtitles
            ?.map(
              (sub) =>
                `${sub.language || "Unknown"} (${
                  sub.source || "Unknown source"
                })`
            )
            .join(", ") || "None"
        }`;
      })
      .join("\n\n");

    const metadata = `\nSearch Metadata:
Cursor: ${data.metadata?.cursor || "N/A"}
Has more results: ${data.metadata?.has_more ? "Yes" : "No"}
Search UID: ${data.metadata?.search_uid || "N/A"}`;

    return videosList + metadata;
  } else {
    return "No videos found for the search query";
  }
}

async function performGetSubtitle(tiktok_url: string, language_code: string) {
  const url = buildBackendUrl("get-subtitles");
  url.searchParams.set("tiktok_url", tiktok_url);
  if (language_code) url.searchParams.set("language_code", language_code);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
  };
  if (BACKEND_API_KEY) headers["Authorization"] = `Bearer ${BACKEND_API_KEY}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `Backend API error: ${response.status} ${
        response.statusText
      }\n${await response.text()}`
    );
  }
  const data = (await response.json()) as Subtitle;
  return data.subtitle_content || "No subtitle available";
}

async function performGetPostDetails(tiktok_url: string) {
  const url = buildBackendUrl("post-detail");
  url.searchParams.set("tiktok_url", tiktok_url);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
  };
  if (BACKEND_API_KEY) headers["Authorization"] = `Bearer ${BACKEND_API_KEY}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `Backend API error: ${response.status} ${
        response.statusText
      }\n${await response.text()}`
    );
  }
  const data = (await response.json()) as PostDetails;
  if (data.details) {
    const details = data.details;
    return `Description: ${details.description || "N/A"}
    Video ID: ${details.video_id || "N/A"}
    Creator: ${details.creator || "N/A"}
    Hashtags: ${
      Array.isArray(details.hashtags) ? details.hashtags.join(", ") : "N/A"
    }
    Likes: ${details.likes || "0"}
    Shares: ${details.shares || "0"}
    Comments: ${details.comments || "0"}
    Views: ${details.views || "0"}
    Bookmarks: ${details.bookmarks || "0"}
    Created at: ${details.created_at || "N/A"}
    Duration: ${details.duration || 0} seconds
    Available subtitles: ${
      details.available_subtitles
        ?.map(
          (sub) =>
            `${sub.language || "Unknown"} (${sub.source || "Unknown source"})`
        )
        .join(", ") || "None"
    }`;
  }
  return "No details available";
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [GET_SUBTITLE, GET_POST_DETAILS, ANALYZE_VIRALITY];
  const searchEnabled = /^(1|true|yes)$/i.test(ENABLE_SEARCH.trim());
  if (searchEnabled) {
    tools.splice(2, 0, SEARCH); // Keep a sensible order when enabled
  }
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("No arguments provided");
    }

    switch (name) {
      case "tiktok_get_subtitle": {
        if (!isGetSubtitleArgs(args)) {
          throw new Error("Invalid arguments for tiktok_get_subtitle");
        }
        const { tiktok_url, language_code } = args;

        const results = await performGetSubtitle(tiktok_url, language_code);
        return {
          content: [{ type: "text", text: results }],
          isError: false,
        };
      }

      case "tiktok_get_post_details": {
        if (!isGetPostDetailsArgs(args)) {
          throw new Error("Invalid arguments for tiktok_get_post_details");
        }
        const { tiktok_url } = args;

        const results = await performGetPostDetails(tiktok_url);
        return {
          content: [{ type: "text", text: results }],
          isError: false,
        };
      }

      case "tiktok_search": {
        const searchEnabled = /^(1|true|yes)$/i.test(ENABLE_SEARCH.trim());
        if (!searchEnabled) {
          return {
            content: [
              {
                type: "text",
                text: "tiktok_search is disabled. Enable it by setting ENABLE_SEARCH=true in the environment.",
              },
            ],
            isError: true,
          };
        }
        if (!isSearchArgs(args)) {
          throw new Error("Invalid arguments for tiktok_search");
        }
        const { query, cursor, search_uid } = args;

        const results = await performSearch(query, cursor, search_uid);
        return {
          content: [{ type: "text", text: results }],
          isError: false,
        };
      }

      case "tiktok_analyze_virality": {
        if (!isGetSubtitleArgs(args) && !isGetPostDetailsArgs(args)) {
          throw new Error("Invalid arguments for tiktok_analyze_virality");
        }
        const { tiktok_url } = args as { tiktok_url: string };
        const language_code =
          (args as { language_code?: string }).language_code ?? "";

        const [detailsText, subtitleText] = await Promise.all([
          performGetPostDetails(tiktok_url),
          performGetSubtitle(tiktok_url, language_code),
        ]);

        const analysis = analyzeVirality(detailsText, subtitleText);
        return {
          content: [{ type: "text", text: analysis }],
          isError: false,
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TikTok MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
