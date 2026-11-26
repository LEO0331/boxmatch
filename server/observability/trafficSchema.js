const ENUMS = Object.freeze({
  classifications: ['likely_human', 'search_engine_crawler', 'ai_crawler', 'social_media_crawler', 'automated_api_client', 'suspected_scraper', 'suspected_security_scanner', 'unknown'],
  riskLevels: ['low', 'suspicious', 'high', 'unknown'],
  verificationStatuses: ['verified', 'unverified', 'verification_failed', 'verification_unavailable', 'not_applicable', 'unknown'],
  sourceChannels: ['search_referral', 'social_referral', 'github_referral', 'same_origin', 'external_referral', 'direct_or_unknown', 'unknown'],
  pages: ['home', 'listing_feed', 'map', 'listing_detail', 'enterprise_post', 'enterprise_edit', 'reservation', 'my_reservations', 'unknown'],
  channels: ['organic_search', 'social_referral', 'github_referral', 'ai_referral', 'campaign_referral', 'external_referral', 'internal_navigation', 'direct_or_unknown', 'unknown'],
  campaignSources: ['google', 'bing', 'duckduckgo', 'facebook', 'instagram', 'linkedin', 'reddit', 'github', 'chatgpt', 'perplexity', 'claude', 'other', 'unknown'],
  campaignMediums: ['organic', 'social', 'referral', 'email', 'cpc', 'paid_social', 'other', 'unknown'],
  browsers: ['Chrome', 'Edge', 'Firefox', 'Safari', 'Opera', 'unknown'],
  operatingSystems: ['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Chrome OS', 'unknown'],
  identityConfidence: ['trusted', 'proxy', 'unresolved', 'unknown'],
  geoStatuses: ['resolved', 'not_found', 'unavailable', 'disabled', 'unknown']
});

const API_SCALARS = ['totalRequests', 'success', 'clientErrors', 'serverErrors', 'aborted', 'rateLimited'];
const API_DIMENSIONS = ['classifications', 'riskLevels', 'verificationStatuses', 'sourceChannels', 'countries', 'asns', 'identityConfidence', 'geoStatuses'];
const WEBSITE_DIMENSIONS = ['pages', 'channels', 'campaignSources', 'campaignMediums', 'browsers', 'operatingSystems', 'countries', 'asns', 'identityConfidence', 'geoStatuses'];

module.exports = { ENUMS, API_COUNTERS: API_SCALARS, API_DIMENSIONS, WEBSITE_DIMENSIONS };
