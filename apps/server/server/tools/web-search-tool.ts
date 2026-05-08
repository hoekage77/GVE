/**
 * WebSearchTool — Search the web for current information.
 *
 * Uses Tavily API for high-quality search results.
 * Falls back to a basic DuckDuckGo HTML scrape if Tavily is unavailable.
 */

import { Tool } from "./Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_BASE_URL = "https://api.tavily.com";

@toolMetadata(
  "Web Search",
  "Search the web for up-to-date information, facts, documentation, and current events. Returns relevant results with sources.",
  { weight: 20, visible: true, usage_guide: "Use web_search for current information, statistics, or facts the LLM may not know. Always cite sources in your final answer." }
)
export class WebSearchTool extends Tool {
  @methodMetadata("Web Search", "Execute a web search query and return results with source URLs.")
  @openapiSchema({
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web using Tavily API. Returns search results with titles, URLs, snippets, and optional AI-generated summaries. Pass multiple queries as an array for concurrent batch search.",
      parameters: {
        type: "object",
        properties: {
          query: {
            oneOf: [
              { type: "string", description: "A single search query." },
              { type: "array", items: { type: "string" }, description: "Multiple queries to search concurrently (batch mode)." },
            ],
            description: "The search query or queries. Use batch mode for related topics.",
          },
          num_results: {
            type: "number",
            description: "Number of results to return per query (1-50).",
            default: 5,
          },
          search_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description: "Basic is fast; advanced crawls pages for deeper content.",
            default: "advanced",
          },
          include_answer: {
            type: "boolean",
            description: "Include an AI-generated answer summary.",
            default: true,
          },
        },
        required: ["query"],
      },
    },
  })
  async webSearch(args: {
    query: string | string[];
    num_results?: number;
    search_depth?: "basic" | "advanced";
    include_answer?: boolean;
  }) {
    const queries = Array.isArray(args.query) ? args.query : [args.query];
    const numResults = Math.min(50, Math.max(1, args.num_results ?? 5));
    const depth = args.search_depth ?? "advanced";
    const includeAnswer = args.include_answer ?? true;

    if (!TAVILY_API_KEY) {
      // Fallback: basic web search unavailable
      return this.failResponse(
        "Web search is not configured. Set TAVILY_API_KEY environment variable to enable web search."
      );
    }

    try {
      const results = await Promise.all(
        queries.map(async (q) => {
          const response = await fetch(`${TAVILY_BASE_URL}/search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              api_key: TAVILY_API_KEY,
              query: q,
              max_results: numResults,
              search_depth: depth,
              include_answer: includeAnswer,
              include_images: false,
            }),
          });

          if (!response.ok) {
            throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
          }

          const data = (await response.json()) as {
            query: string;
            answer?: string;
            results?: Array<{
              title: string;
              url: string;
              content: string;
              score?: number;
            }>;
          };

          return {
            query: data.query,
            answer: data.answer ?? null,
            results: (data.results ?? []).map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content,
              relevance: r.score ?? 0,
            })),
          };
        })
      );

      return this.successResponse({
        queries_count: queries.length,
        results,
      });
    } catch (err: any) {
      return this.failResponse(`Web search failed: ${err.message}`);
    }
  }

  @methodMetadata("Scrape Webpage", "Fetch and extract content from a specific URL.")
  @openapiSchema({
    type: "function",
    function: {
      name: "scrape_webpage",
      description: "Fetch a webpage and extract its text content. Use this after finding a relevant URL via web_search to get full details.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch and extract content from.",
          },
          max_length: {
            type: "number",
            description: "Maximum characters to return.",
            default: 8000,
          },
        },
        required: ["url"],
      },
    },
  })
  async scrapeWebpage(args: { url: string; max_length?: number }) {
    try {
      const response = await fetch(args.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; VisualRuntimeBot/1.0)",
        },
      });

      if (!response.ok) {
        return this.failResponse(`Failed to fetch ${args.url}: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();

      // Simple HTML-to-text extraction (no external deps needed)
      const text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();

      const maxLen = args.max_length ?? 8000;
      const truncated = text.length > maxLen ? text.slice(0, maxLen) + "\n...[truncated]" : text;

      return this.successResponse({
        url: args.url,
        title: this._extractTitle(html),
        content: truncated,
        content_length: text.length,
        truncated: text.length > maxLen,
      });
    } catch (err: any) {
      return this.failResponse(`Failed to scrape ${args.url}: ${err.message}`);
    }
  }

  private _extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match ? (match[1] ?? "").trim() : null;
  }
}
