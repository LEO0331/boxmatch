const { extractSource } = require('./requestContext');

const PAGES = Object.freeze(['home', 'listing_feed', 'map', 'listing_detail',
  'enterprise_post', 'enterprise_edit', 'reservation', 'my_reservations', 'unknown']);
const CAMPAIGN_SOURCES = Object.freeze(['google', 'bing', 'duckduckgo', 'facebook',
  'instagram', 'linkedin', 'reddit', 'github', 'chatgpt', 'perplexity', 'claude', 'other']);
const CAMPAIGN_MEDIUMS = Object.freeze(['organic', 'social', 'referral', 'email', 'cpc', 'paid_social', 'other']);
const FIELDS = new Set(['schemaVersion', 'eventType', 'page', 'referrerDomain', 'campaignSource', 'campaignMedium']);

function normalizeCampaign(value, allowed) {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? (allowed.includes(normalized) ? normalized : 'other') : null;
}

function normalizeReferrer(value) {
  if (value == null || value === '') return null;
  // Reuse Phase 1's source-host sanitation; only a bare hostname is accepted here.
  if (typeof value !== 'string' || value.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(value)) return null;
  return extractSource({ headers: { referer: `https://${value}` } }).referrerDomain;
}

function belongsTo(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function acquisitionChannel(visit, ownHosts) {
  if (visit.campaignSource || visit.campaignMedium) {
    if (visit.campaignMedium === 'organic' && ['google', 'bing', 'duckduckgo'].includes(visit.campaignSource)) return 'organic_search';
    if (visit.campaignMedium === 'social' && ['facebook', 'instagram', 'linkedin', 'reddit'].includes(visit.campaignSource)) return 'social_referral';
    return 'campaign_referral';
  }
  const host = visit.referrerDomain;
  if (!host) return 'direct_or_unknown';
  if (ownHosts.some((own) => normalizeReferrer(own) === host)) return 'internal_navigation';
  if (['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com']
    .some((domain) => belongsTo(host, domain))) return 'ai_referral';
  const source = extractSource({ headers: { referer: `https://${host}` } }).channel;
  return source === 'search_referral' ? 'organic_search' : source;
}

function validateVisit(payload, { ownHosts = [] } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some((field) => !FIELDS.has(field)) ||
      payload.schemaVersion !== 1 || payload.eventType !== 'page_view' || !PAGES.includes(payload.page)) {
    return { error: 'INVALID_VISIT' };
  }
  for (const field of ['campaignSource', 'campaignMedium']) {
    const value = payload[field];
    if (value != null && (typeof value !== 'string' || value.length > 64 || /[\x00-\x1f\x7f]/.test(value))) {
      return { error: 'INVALID_VISIT' };
    }
  }
  if (payload.referrerDomain != null && (typeof payload.referrerDomain !== 'string' ||
      payload.referrerDomain.length > 253 || (payload.referrerDomain !== '' && !normalizeReferrer(payload.referrerDomain)))) {
    return { error: 'INVALID_VISIT' };
  }
  const visit = {
    page: payload.page,
    referrerDomain: normalizeReferrer(payload.referrerDomain),
    campaignSource: normalizeCampaign(payload.campaignSource, CAMPAIGN_SOURCES),
    campaignMedium: normalizeCampaign(payload.campaignMedium, CAMPAIGN_MEDIUMS)
  };
  visit.acquisitionChannel = acquisitionChannel(visit, Array.isArray(ownHosts) ? ownHosts.slice(0, 32) : []);
  return { visit };
}

module.exports = { validateVisit, normalizeReferrer, PAGES, CAMPAIGN_SOURCES, CAMPAIGN_MEDIUMS };
