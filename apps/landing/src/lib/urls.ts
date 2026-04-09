const configuredWebAppUrl = import.meta.env.VITE_WEB_APP_URL;

export const WEB_APP_URL = configuredWebAppUrl || "http://localhost:5173";