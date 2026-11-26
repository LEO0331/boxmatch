// Synthetic dashboard data only. No production identities or observations.
function trafficOverview(days = 7) {
  const end = new Date();
  const midnight = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const dailyTrends = Array.from({ length: days }, (_, index) => {
    const date = new Date(midnight - (days - index - 1) * 86400000).toISOString().slice(0, 10);
    const missing = index === 2;
    const apiRequests = 900 + index * 110;
    const clientErrors = 30 + index * 2;
    const serverErrors = 4 + index;
    const aborted = 2;
    return { date, available: !missing, status: missing ? 'missing' : 'available',
      pageViews: missing ? null : 140 + index * 25,
      apiRequests: missing ? null : apiRequests,
      apiSuccess: missing ? null : apiRequests - clientErrors - serverErrors - aborted,
      clientErrors: missing ? null : clientErrors, serverErrors: missing ? null : serverErrors,
      aborted: missing ? null : aborted, suspicious: missing ? null : 18 + index,
      highRisk: missing ? null : 5 + index };
  });
  const sum = (key) => dailyTrends.reduce((total, row) => total + (row[key] || 0), 0);
  const apiRequests = sum('apiRequests');
  const pageViews = sum('pageViews');
  const apiSuccess = sum('apiSuccess');
  const apiErrors = sum('clientErrors') + sum('serverErrors');
  const partition = (total, pairs) => {
    let assigned = 0;
    const result = {};
    for (const [name, fraction] of pairs) { result[name] = Math.floor(total * fraction); assigned += result[name]; }
    result.unknown = total - assigned;
    return result;
  };
  const countries = (total) => partition(total, [['TW', 0.56], ['US', 0.19], ['JP', 0.12], ['GB', 0.04], ['other', 0.03]]);
  const asns = (total) => partition(total, [['3462', 0.43], ['15169', 0.2], ['13335', 0.1], ['other', 0.08]]);
  const confidence = (total) => partition(total, [['trusted', 0.97], ['proxy', 0.02], ['unresolved', 0.005]]);
  const geoStatuses = (total) => partition(total, [['resolved', 0.96], ['unavailable', 0.02], ['not_found', 0.01], ['disabled', 0]]);
  const api = { totalRequests: apiRequests, success: apiSuccess, clientErrors: sum('clientErrors'),
    serverErrors: sum('serverErrors'), aborted: sum('aborted'), rateLimited: Math.floor(sum('clientErrors') * 0.2),
    classifications: partition(apiRequests, [['likely_human', 0.58], ['search_engine_crawler', 0.13], ['ai_crawler', 0.08],
      ['social_media_crawler', 0.03], ['automated_api_client', 0.09], ['suspected_scraper', 0.03], ['suspected_security_scanner', 0.02]]),
    riskLevels: { low: apiRequests - sum('suspicious') - sum('highRisk'), suspicious: sum('suspicious'), high: sum('highRisk'), unknown: 0 },
    verificationStatuses: partition(apiRequests, [['verified', 0.19], ['unverified', 0.08], ['verification_failed', 0.015],
      ['verification_unavailable', 0.035], ['not_applicable', 0.65]]),
    sourceChannels: partition(apiRequests, [['same_origin', 0.62], ['search_referral', 0.14], ['github_referral', 0.1], ['external_referral', 0.07]]),
    countries: countries(apiRequests), asns: asns(apiRequests), identityConfidence: confidence(apiRequests), geoStatuses: geoStatuses(apiRequests) };
  const website = { pageViews,
    pages: partition(pageViews, [['home', 0.39], ['map', 0.24], ['listing_detail', 0.22], ['enterprise_post', 0.09]]),
    channels: partition(pageViews, [['organic_search', 0.35], ['social_referral', 0.19], ['github_referral', 0.15],
      ['ai_referral', 0.08], ['campaign_referral', 0.07], ['external_referral', 0.05], ['internal_navigation', 0.03], ['direct_or_unknown', 0.06]]),
    campaignSources: partition(pageViews, [['google', 0.42], ['github', 0.2], ['chatgpt', 0.11], ['other', 0.12]]),
    campaignMediums: partition(pageViews, [['organic', 0.42], ['referral', 0.31], ['social', 0.13], ['other', 0.06]]),
    browsers: partition(pageViews, [['Chrome', 0.51], ['Safari', 0.27], ['Edge', 0.11], ['Firefox', 0.07]]),
    operatingSystems: partition(pageViews, [['Windows', 0.35], ['iOS', 0.24], ['Android', 0.21], ['macOS', 0.13], ['Linux', 0.04]]),
    countries: countries(pageViews), asns: asns(pageViews), identityConfidence: confidence(pageViews), geoStatuses: geoStatuses(pageViews) };
  const lastPersistedAt = new Date(Date.now() - 5 * 60000).toISOString();
  const apiKnownCountryRate = Math.round(10000 * (apiRequests - api.countries.unknown) / apiRequests) / 100;
  const websiteKnownCountryRate = Math.round(10000 * (pageViews - website.countries.unknown) / pageViews) / 100;
  return { schemaVersion: 1,
    period: { startDate: dailyTrends[0].date, endDate: dailyTrends.at(-1).date, timezone: 'UTC' },
    coverage: { requestedDays: days, availableDays: days - 1, missingDays: 1, invalidDays: 0, unsupportedDays: 0, lastPersistedAt },
    summary: { websitePageViews: pageViews, apiRequests, apiSuccess, apiSuccessRate: 100 * apiSuccess / apiRequests,
      apiErrors, apiErrorRate: 100 * apiErrors / apiRequests, suspiciousRequests: sum('suspicious'),
      highRiskRequests: sum('highRisk'), verifiedBotRequests: api.verificationStatuses.verified,
      apiKnownCountryRate, websiteKnownCountryRate },
    dailyTrends, api, website, network: { apiKnownCountryRate, websiteKnownCountryRate },
    dataQuality: { stale: false, currentDayPartial: true,
      flags: { requestIntelligence: true, botVerification: true, trafficAdmin: true,
        frontendTelemetry: true, geoEnrichment: true, trafficAggregation: true },
      issues: ['MISSING_DAYS', 'CURRENT_DAY_PARTIAL'] } };
}

function probeOverview(days = 7) {
  const overview = trafficOverview(days);
  const trends = overview.dailyTrends.map((day, index) => ({
    date: day.date,
    status: day.available && index > 0 ? 'available' : 'not_observed',
    count: day.available && index > 0 ? 3 : null
  }));
  const observedDays = trends.filter(day => day.status === 'available').length;
  const matched = observedDays * 3;
  return {
    ...overview,
    probes: {
      collectionEnabled: true, requestedDays: days, observedDays, invalidDays: 0,
      dailyTrends: trends,
      totals: {
        observedRequests: overview.api.totalRequests - overview.dailyTrends[0].apiRequests,
        matchedRequests: matched, correlatedRequests: matched,
        repeatRequests: observedDays * 2, multiCategoryRequests: observedDays,
        success2xx: 0,
        probeTargets: { environment: observedDays, git_metadata: observedDays, backup: observedDays },
        probeMethods: { GET: observedDays * 2, HEAD: observedDays },
        probeHours: { '08': matched }, probeStatuses: { '404': matched },
        classifications: { suspected_security_scanner: matched },
        riskLevels: { suspicious: matched }, verificationStatuses: { not_applicable: matched },
        countries: { TW: matched }, asns: { '3462': matched },
        identityConfidence: { trusted: matched }, geoStatuses: { resolved: matched }
      }
    }
  };
}
module.exports = { trafficOverview, probeOverview };
