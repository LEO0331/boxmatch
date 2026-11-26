String countryName(String code, bool isZhTw) {
  const names = {
    'TW': ['Taiwan', '臺灣'],
    'US': ['United States', '美國'],
    'JP': ['Japan', '日本'],
    'GB': ['United Kingdom', '英國'],
    'DE': ['Germany', '德國'],
    'FR': ['France', '法國'],
    'CA': ['Canada', '加拿大'],
    'AU': ['Australia', '澳洲'],
    'SG': ['Singapore', '新加坡'],
    'HK': ['Hong Kong', '香港'],
    'KR': ['South Korea', '南韓'],
  };
  return names[code]?[isZhTw ? 1 : 0] ?? code;
}

bool downloadCsv(String filename, String content) => false;
