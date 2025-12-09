export function isLineInAppBrowser(userAgent: string | undefined | string[]): boolean {
  if (!userAgent) {
    return false;
  }

  const normalizedUA = Array.isArray(userAgent) ? userAgent.join(" ") : userAgent;
  const ua = normalizedUA.toLowerCase();

  return ua.includes(" line/") || ua.includes(" line ");
}
