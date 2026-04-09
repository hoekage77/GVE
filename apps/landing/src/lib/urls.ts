// Runtime detection: if we're on dosco.live, go to app.dosco.live; otherwise use localhost.
function getWebAppUrl(): string {
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "dosco.live" || hostname === "www.dosco.live") {
      return "https://app.dosco.live";
    }
  }

  // Build-time fallback for dev/preview environments
  const configuredWebAppUrl = import.meta.env.VITE_WEB_APP_URL;
  return configuredWebAppUrl || "http://localhost:5173";
}

export const WEB_APP_URL = getWebAppUrl();