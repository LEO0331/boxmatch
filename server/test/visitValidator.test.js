const { validateVisit, normalizeReferrer } = require('../observability/visitValidator');

const base = { schemaVersion: 1, eventType: 'page_view', page: 'home' };

test('minimal visit has no fabricated acquisition or visitor identity', () => {
  expect(validateVisit(base)).toEqual({ visit: { page: 'home', referrerDomain: null,
    campaignSource: null, campaignMedium: null, acquisitionChannel: 'direct_or_unknown' } });
});

test.each([
  ['www.google.com', 'organic_search'], ['bing.com', 'organic_search'],
  ['duckduckgo.com', 'organic_search'], ['facebook.com', 'social_referral'],
  ['instagram.com', 'social_referral'], ['linkedin.com', 'social_referral'],
  ['reddit.com', 'social_referral'], ['github.com', 'github_referral'],
  ['chatgpt.com', 'ai_referral'], ['chat.openai.com', 'ai_referral'],
  ['perplexity.ai', 'ai_referral'], ['claude.ai', 'ai_referral'],
  ['gemini.google.com', 'ai_referral'], ['other.example.org', 'external_referral'],
  ['google.com.attacker.example', 'external_referral']
])('classifies website acquisition from %s independently of API Origin', (referrerDomain, channel) => {
  expect(validateVisit({ ...base, referrerDomain }).visit.acquisitionChannel).toBe(channel);
});

test('same website referrers are internal navigation only from configured hosts', () => {
  expect(validateVisit({ ...base, referrerDomain: 'leo0331.github.io' },
    { ownHosts: ['leo0331.github.io'] }).visit.acquisitionChannel).toBe('internal_navigation');
  expect(validateVisit({ ...base, referrerDomain: 'leo0331.github.io' }).visit.acquisitionChannel).toBe('external_referral');
});

test('campaign values stay finite and explicit campaign attribution does not overwrite referrer', () => {
  expect(validateVisit({ ...base, referrerDomain: 'github.com', campaignSource: ' GOOGLE ', campaignMedium: 'organic' }).visit)
    .toEqual({ page: 'home', referrerDomain: 'github.com', campaignSource: 'google', campaignMedium: 'organic', acquisitionChannel: 'organic_search' });
  expect(validateVisit({ ...base, campaignSource: 'facebook', campaignMedium: 'social' }).visit.acquisitionChannel).toBe('social_referral');
  const unknown = validateVisit({ ...base, campaignSource: 'PERSONAL_IDENTIFIER', campaignMedium: 'CUSTOM_CAMPAIGN' });
  expect(unknown.visit).toMatchObject({ campaignSource: 'other', campaignMedium: 'other', acquisitionChannel: 'campaign_referral' });
  expect(JSON.stringify(unknown)).not.toMatch(/PERSONAL_IDENTIFIER|CUSTOM_CAMPAIGN/);
});

test.each([
  null, [], 'page_view', {}, { ...base, schemaVersion: 2 }, { ...base, eventType: 'visitor' },
  { ...base, page: 'about' }, { ...base, page: '/listing/SECRET_ID' },
  { ...base, extra: 'SECRET_TOKEN' }, { ...base, country: 'TW' },
  { ...base, referrerDomain: ['google.com'] }, { ...base, referrerDomain: 'a'.repeat(254) },
  { ...base, campaignSource: {} }, { ...base, campaignSource: 'a'.repeat(65) },
  { ...base, campaignMedium: 'organic\nSECRET' }, { ...base, campaignMedium: false }
])('rejects invalid schemas without returning their contents: %j', (payload) => {
  expect(validateVisit(payload)).toEqual({ error: 'INVALID_VISIT' });
});

test.each(['https://google.com/path?token=SECRET', 'google.com/path', 'user@google.com',
  'google.com:443', '127.0.0.1', '0x7f000001', '[::1]', '::1', 'google..com',
  '-google.com', 'google.com\nSECRET', 'google.com?token=SECRET'])('rejects non-hostname referrer %s', (referrerDomain) => {
  expect(normalizeReferrer(referrerDomain)).toBeNull();
  expect(validateVisit({ ...base, referrerDomain })).toEqual({ error: 'INVALID_VISIT' });
});

test('normalizes hostname casing and a DNS root dot', () => {
  expect(validateVisit({ ...base, referrerDomain: 'WWW.Google.COM.' }).visit.referrerDomain).toBe('www.google.com');
});
