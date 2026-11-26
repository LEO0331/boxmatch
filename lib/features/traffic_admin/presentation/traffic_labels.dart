import 'traffic_platform.dart';

String trafficLabel(String key, bool zh) {
  const labels = {
    'available': ['Available', '可用'],
    'missing': ['Missing', '缺少'],
    'invalid': ['Invalid data', '無效資料'],
    'unsupported': ['Unsupported schema', '不支援的資料結構'],
    'requestIntelligence': ['Request intelligence', '請求情報'],
    'frontendTelemetry': ['Frontend telemetry', '前端觀測'],
    'geoEnrichment': ['Geographic enrichment', '地理資料解析'],
    'trafficAggregation': ['Traffic aggregation', '流量彙總'],
    'botVerification': ['Bot verification', '機器人驗證'],
    'trafficAdmin': ['Traffic administration', '流量管理介面'],
    'MISSING_DAYS': [
      'Some dates have no persisted observations.',
      '部分日期沒有已儲存的觀測資料。',
    ],
    'INVALID_DAYS': [
      'Some stored dates contain invalid observations.',
      '部分日期的已儲存觀測資料無效。',
    ],
    'UNSUPPORTED_SCHEMA': [
      'Some dates use an unsupported analytics schema.',
      '部分日期使用不支援的分析資料結構。',
    ],
    'COUNTER_OVERFLOW': [
      'A numeric limit was exceeded; some observations are unavailable.',
      '部分數值超出安全範圍，相關觀測資料不可用。',
    ],
    'MISSING_UPDATE_TIME': [
      'Some observations have no persisted update timestamp.',
      '部分觀測資料缺少儲存更新時間。',
    ],
    'likely_human': ['Likely human', '類似真人'],
    'search_engine_crawler': ['Search crawler', '搜尋引擎爬蟲'],
    'ai_crawler': ['AI crawler', 'AI 爬蟲'],
    'social_media_crawler': ['Social preview crawler', '社群預覽爬蟲'],
    'automated_api_client': ['Automated API client', '自動化 API 用戶端'],
    'suspected_scraper': ['Suspected scraper', '疑似擷取程式'],
    'suspected_security_scanner': ['Suspected scanner', '疑似掃描程式'],
    'unknown': ['Unknown', '未知'],
    'other': ['Other', '其他'],
    'organic_search': ['Organic search', '自然搜尋'],
    'social_referral': ['Social referral', '社群引薦'],
    'github_referral': ['GitHub referral', 'GitHub 引薦'],
    'ai_referral': ['AI referral', 'AI 平台引薦'],
    'campaign_referral': ['Campaign referral', '活動引薦'],
    'external_referral': ['External referral', '外部引薦'],
    'internal_navigation': ['Internal navigation', '站內導覽'],
    'direct_or_unknown': ['Direct or unknown', '直接或未知來源'],
    'search_referral': ['Search referral', '搜尋引薦'],
    'same_origin': ['Same origin', '相同來源'],
    'verified': ['Verified', '已驗證'],
    'unverified': ['Unverified', '未驗證'],
    'verification_failed': ['Verification failed', '驗證不符'],
    'verification_unavailable': ['Verification unavailable', '驗證不可用'],
    'not_applicable': ['Not applicable', '不適用'],
    'trusted': ['Trusted identity', '可信網路識別'],
    'proxy': ['Proxy identity', '代理網路識別'],
    'unresolved': ['Unresolved identity', '無法解析網路識別'],
    'resolved': ['Resolved', '已解析'],
    'not_found': ['Lookup had no match', '查無對應資料'],
    'unavailable': ['Unavailable', '不可用'],
    'disabled': ['Disabled', '未啟用'],
    'low': ['Low', '低'],
    'suspicious': ['Suspicious', '可疑'],
    'high': ['High', '高'],
    'home': ['Home', '首頁'],
    'listing_feed': ['Listing feed', '剩食列表'],
    'map': ['Map', '場館地圖'],
    'listing_detail': ['Listing detail', '剩食詳情'],
    'enterprise_post': ['Enterprise post', '企業發佈'],
    'enterprise_edit': ['Enterprise edit', '企業編輯'],
    'reservation': ['Reservation', '預約'],
    'my_reservations': ['My reservations', '我的預約'],
    'organic': ['Organic', '自然'],
    'social': ['Social', '社群'],
    'referral': ['Referral', '引薦'],
    'email': ['Email', '電子郵件'],
    'cpc': ['Paid search', '付費搜尋'],
    'paid_social': ['Paid social', '付費社群'],
  };
  return labels[key]?[zh ? 1 : 0] ?? key.replaceAll('_', ' ');
}

String trafficCountryLabel(String code, bool zh) =>
    code == 'unknown' || code == 'other'
    ? trafficLabel(code, zh)
    : '${countryName(code, zh)} ($code)';

String trafficAsnLabel(String key, bool zh) =>
    key == 'unknown' || key == 'other' ? trafficLabel(key, zh) : 'AS$key';
