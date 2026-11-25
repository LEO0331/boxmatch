// These are claims from untrusted headers, never proof of a provider or a person.
const BOT_SIGNATURES = [
  ['Googlebot', 'search_engine_crawler', 'search'],
  ['Bingbot', 'search_engine_crawler', 'search'],
  ['DuckDuckBot', 'search_engine_crawler', 'search'],
  ['YandexBot', 'search_engine_crawler', 'search'],
  ['Baiduspider', 'search_engine_crawler', 'search'],
  ['GPTBot', 'ai_crawler', 'training'],
  ['OAI-SearchBot', 'ai_crawler', 'search'],
  ['ChatGPT-User', 'ai_crawler', 'user_triggered'],
  ['ClaudeBot', 'ai_crawler', 'training'],
  ['Claude-SearchBot', 'ai_crawler', 'search'],
  ['Claude-User', 'ai_crawler', 'user_triggered'],
  ['PerplexityBot', 'ai_crawler', 'search'],
  ['facebookexternalhit', 'social_media_crawler', 'link_preview'],
  ['Twitterbot', 'social_media_crawler', 'link_preview'],
  ['LinkedInBot', 'social_media_crawler', 'link_preview'],
  ['Discordbot', 'social_media_crawler', 'link_preview'],
  ['Slackbot-LinkExpanding', 'social_media_crawler', 'link_preview'],
  ['Slackbot', 'social_media_crawler', 'automation']
].map(([name, classification, purpose]) => ({
  name, classification, purpose,
  pattern: new RegExp(`(?:^|[^a-z0-9])${name}(?:[^a-z0-9]|$)`, 'i')
}));

function normalizeUserAgent(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return '';
  return value.trim();
}

function browserFamily(ua) {
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera\//i.test(ua)) return 'Opera';
  if (/Firefox\/|FxiOS\//i.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//i.test(ua)) return 'Chrome';
  if (/Version\/[\d.]+.*Safari\//i.test(ua)) return 'Safari';
  return null;
}

function osFamily(ua) {
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/CrOS/i.test(ua)) return 'Chrome OS';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return null;
}

function classifyTraffic(userAgent, { suspiciousPath = false } = {}) {
  const ua = normalizeUserAgent(userAgent);
  const bot = BOT_SIGNATURES.find(({ pattern }) => pattern.test(ua));
  const browser = browserFamily(ua);
  let type = 'unknown';
  let classification = 'unknown';
  if (bot) {
    type = 'crawler';
    classification = bot.classification;
  } else if (/\b(?:sqlmap|nikto|nuclei|masscan|nmap|zgrab)(?:\b|\/)/i.test(ua)) {
    type = 'api_client';
    classification = 'suspected_security_scanner';
  } else if (/\b(?:scrapy|scraper|spider)(?:\b|\/)/i.test(ua)) {
    type = 'crawler';
    classification = 'suspected_scraper';
  } else if (/\b(?:curl|wget|PostmanRuntime|Postman|python-requests|Go-http-client|HeadlessChrome|PhantomJS|Playwright|Puppeteer|Selenium)(?:\b|\/)/i.test(ua)) {
    type = 'api_client';
    classification = 'automated_api_client';
  } else if (browser && /Mozilla\//i.test(ua)) {
    type = 'browser';
    classification = 'likely_human';
  }
  if (suspiciousPath) classification = 'suspected_security_scanner';
  return {
    type, browser, os: osFamily(ua), claimedBot: bot?.name || null,
    botPurpose: bot?.purpose || null, classification
  };
}

module.exports = { classifyTraffic, normalizeUserAgent };
