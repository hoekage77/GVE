/**
 * BrowserTool — Lightweight browser automation via fetch.
 *
 * Provides basic page navigation, content extraction, and form interaction
 * without requiring Playwright (which can be added later for full automation).
 */

import { Tool } from "./Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";

@toolMetadata(
  "Browser",
  "Navigate websites, extract page content, and interact with web pages. Use this to read documentation, gather data from specific sites, or verify live information.",
  { weight: 25, visible: true }
)
export class BrowserTool extends Tool {
  @methodMetadata("Navigate", "Navigate to a URL and extract the page content.")
  @openapiSchema({
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate to a URL and return the page title, text content, and links. Use this to read documentation or specific web pages.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to navigate to.",
          },
          wait_for: {
            type: "string",
            description: "Optional: wait for this selector to appear (not implemented in fetch mode).",
          },
        },
        required: ["url"],
      },
    },
  })
  async navigate(args: { url: string; wait_for?: string }) {
    try {
      const response = await fetch(args.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; VisualRuntimeBot/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        return this.failResponse(`Navigation failed: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const text = this._htmlToText(html);
      const title = this._extractTitle(html);
      const links = this._extractLinks(html, args.url);

      return this.successResponse({
        url: args.url,
        final_url: response.url,
        title,
        text_content: text.slice(0, 12000),
        text_truncated: text.length > 12000,
        links: links.slice(0, 20),
        status: response.status,
      });
    } catch (err: any) {
      return this.failResponse(`Browser navigation failed: ${err.message}`);
    }
  }

  @methodMetadata("Extract Links", "Extract all links from a page.")
  @openapiSchema({
    type: "function",
    function: {
      name: "extract_links",
      description: "Extract all hyperlinks from a given URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to extract links from.",
          },
        },
        required: ["url"],
      },
    },
  })
  async extractLinks(args: { url: string }) {
    try {
      const response = await fetch(args.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; VisualRuntimeBot/1.0)",
        },
      });

      if (!response.ok) {
        return this.failResponse(`Failed to fetch ${args.url}: ${response.status}`);
      }

      const html = await response.text();
      const links = this._extractLinks(html, args.url);

      return this.successResponse({
        url: args.url,
        links,
        count: links.length,
      });
    } catch (err: any) {
      return this.failResponse(`Failed to extract links: ${err.message}`);
    }
  }

  private _htmlToText(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  private _extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match ? (match[1] ?? "").trim() : null;
  }

  private _extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
    const links: Array<{ text: string; url: string }> = [];
    const seen = new Set<string>();

    const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const href = (match[1] ?? "").trim();
      const text = (match[2] ?? "").trim();

      // Skip anchors, javascript, mailto
      if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
        continue;
      }

      // Resolve relative URLs
      let resolved: string;
      try {
        resolved = new URL(href, baseUrl).href;
      } catch {
        continue;
      }

      if (!seen.has(resolved)) {
        seen.add(resolved);
        links.push({ text: text || resolved, url: resolved });
      }
    }

    return links;
  }
}
