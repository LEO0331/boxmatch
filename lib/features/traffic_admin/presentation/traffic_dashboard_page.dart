import 'package:flutter/material.dart';

import '../models/traffic_overview.dart';
import 'traffic_labels.dart';
import 'traffic_widgets.dart';

class TrafficDashboardPage extends StatelessWidget {
  const TrafficDashboardPage({
    required this.overview,
    required this.isZhTw,
    required this.days,
    required this.loading,
    required this.exporting,
    required this.refreshAllowed,
    required this.onDaysChanged,
    required this.onRefresh,
    required this.onExport,
    required this.onSignOut,
    this.fixtureLabel,
    this.error,
    super.key,
  });

  final TrafficOverview overview;
  final bool isZhTw;
  final int days;
  final bool loading, exporting, refreshAllowed;
  final ValueChanged<int> onDaysChanged;
  final VoidCallback onRefresh, onExport, onSignOut;
  final String? fixtureLabel, error;

  String t(String en, String zh) => isZhTw ? zh : en;
  Map<String, dynamic> dimension(Map<String, dynamic> stream, String name) =>
      stream[name] is Map ? Map<String, dynamic>.from(stream[name] as Map) : {};

  @override
  Widget build(BuildContext context) {
    final coverage = overview.coverage;
    final summary = overview.summary;
    final hasData = coverage.availableDays > 0;
    final advertisedPeriods = overview.dataQuality['supportedPeriods'];
    final periods = [7, 30, 90]
        .where((value) => advertisedPeriods is! List || advertisedPeriods.contains(value))
        .toList();
    if (!periods.contains(days)) periods.add(days);
    periods.sort();
    final persisted = coverage.lastPersistedAt?.toUtc().toIso8601String();
    return Scaffold(
      body: SafeArea(
        child: SelectionArea(
          child: SingleChildScrollView(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1320),
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (fixtureLabel != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Text(
                            fixtureLabel!,
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              color: Color(0xff8a4b00),
                            ),
                          ),
                        ),
                      Text(
                        t('Traffic Intelligence Dashboard', '流量情報儀表板'),
                        style: Theme.of(context).textTheme.headlineMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        t(
                          'Persisted daily aggregates · UTC · observation only',
                          '已儲存的每日彙總 · UTC · 僅供觀測',
                        ),
                      ),
                      const SizedBox(height: 20),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          SizedBox(
                            width: 175,
                            child: DropdownButtonFormField<int>(
                              key: const ValueKey('traffic-period'),
                              initialValue: days,
                              decoration: InputDecoration(
                                labelText: t('Date range (UTC)', '日期範圍（UTC）'),
                              ),
                              items: [
                                for (final value in periods)
                                  DropdownMenuItem(
                                    value: value,
                                    child: Text(t('$value days', '$value 天')),
                                  ),
                              ],
                              onChanged: loading || exporting
                                  ? null
                                  : (value) {
                                      if (value != null) onDaysChanged(value);
                                    },
                            ),
                          ),
                          OutlinedButton(
                            key: const ValueKey('traffic-refresh'),
                            onPressed: refreshAllowed && !loading && !exporting
                                ? onRefresh
                                : null,
                            child: Text(t('Refresh', '重新整理')),
                          ),
                          OutlinedButton(
                            key: const ValueKey('traffic-export'),
                            onPressed: exporting || loading ? null : onExport,
                            child: Text(
                              exporting
                                  ? t('Exporting…', '匯出中…')
                                  : t('Export CSV', '匯出 CSV'),
                            ),
                          ),
                          TextButton(
                            key: const ValueKey('traffic-sign-out'),
                            onPressed: onSignOut,
                            child: Text(t('Sign out', '登出')),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Text(
                        '${overview.period.startDate} – ${overview.period.endDate} UTC',
                      ),
                      Text(
                        t(
                          'Persisted days: ${coverage.availableDays}/${coverage.requestedDays} · Missing: ${coverage.missingDays}',
                          '已儲存天數：${coverage.availableDays}/${coverage.requestedDays} · 缺少：${coverage.missingDays}',
                        ),
                      ),
                      Text(
                        t(
                          'Last persisted: ${persisted ?? 'Unavailable'}',
                          '最後儲存：${persisted ?? '不可用'}',
                        ),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (!refreshAllowed)
                        Text(
                          t(
                            'Manual refresh has a 30-second cooldown.',
                            '手動重新整理間隔為 30 秒。',
                          ),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      if (loading)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: LinearProgressIndicator(),
                        ),
                      if (error != null) _notice(context, error!, true),
                      if (!hasData)
                        _notice(
                          context,
                          t(
                            'No persisted analytics are available for this period. Missing observations are not zero traffic.',
                            '此期間沒有可用的已儲存分析資料。缺少觀測資料不代表流量為零。',
                          ),
                          false,
                        ),
                      if (coverage.availableDays < coverage.requestedDays &&
                          hasData)
                        _notice(
                          context,
                          t(
                            'Partial coverage: totals include available valid days only. Gaps in charts are unavailable observations.',
                            '資料不完整：總數僅包含有效天數。圖表斷線表示觀測資料不可用。',
                          ),
                          false,
                        ),
                      if (overview.dataQuality['stale'] == true)
                        _notice(
                          context,
                          t(
                            'Persisted data is stale. These values are not live monitoring.',
                            '已儲存資料可能過舊，並非即時監控。',
                          ),
                          false,
                        ),
                      const SizedBox(height: 20),
                      TrafficColumns(
                        children: [
                          _metric(
                            context,
                            t('Website page views', '網站頁面瀏覽'),
                            summary['websitePageViews'],
                          ),
                          _metric(
                            context,
                            t('API requests', 'API 請求'),
                            summary['apiRequests'],
                          ),
                          _metric(
                            context,
                            t('API success rate', 'API 成功率'),
                            summary['apiSuccessRate'],
                            percent: true,
                          ),
                          _metric(
                            context,
                            t('API error rate', 'API 錯誤率'),
                            summary['apiErrorRate'],
                            percent: true,
                          ),
                          _metric(
                            context,
                            t('Suspicious / high risk', '可疑／高風險觀測'),
                            summary['suspiciousRequests'] is num &&
                                    summary['highRiskRequests'] is num
                                ? (summary['suspiciousRequests'] as num) +
                                      (summary['highRiskRequests'] as num)
                                : null,
                          ),
                          _metric(
                            context,
                            t('Verified bot requests', '已驗證機器人請求'),
                            summary['verifiedBotRequests'],
                          ),
                        ],
                      ),
                      const SizedBox(height: 30),
                      TrafficSection(
                        title: t('Traffic trends', '流量趨勢'),
                        note: t(
                          'Website and API streams have separate denominators. Missing days stay unavailable.',
                          '網站與 API 使用不同的分母；缺少的日期仍標示為不可用。',
                        ),
                        child: Column(
                          children: [
                            LayoutBuilder(
                              builder: (context, constraints) {
                                final charts = [
                                  TrafficTrend(
                                    title: t('Website page views', '網站頁面瀏覽'),
                                    dates: overview.dailyTrends
                                        .map((day) => day.date)
                                        .toList(),
                                    isZhTw: isZhTw,
                                    series: [
                                      TrafficSeries(
                                        t('Page views', '頁面瀏覽'),
                                        const Color(0xff176543),
                                        overview.dailyTrends
                                            .map((day) => day.pageViews)
                                            .toList(),
                                      ),
                                    ],
                                  ),
                                  TrafficTrend(
                                    title: t(
                                      'API requests and observations',
                                      'API 請求與觀測',
                                    ),
                                    dates: overview.dailyTrends
                                        .map((day) => day.date)
                                        .toList(),
                                    isZhTw: isZhTw,
                                    series: [
                                      TrafficSeries(
                                        t('Requests', '請求'),
                                        const Color(0xff245e9b),
                                        overview.dailyTrends
                                            .map((day) => day.apiRequests)
                                            .toList(),
                                      ),
                                      TrafficSeries(
                                        t('Success', '成功'),
                                        const Color(0xff176543),
                                        overview.dailyTrends
                                            .map((day) => day.apiSuccess)
                                            .toList(),
                                      ),
                                      TrafficSeries(
                                        t('Errors', '錯誤'),
                                        const Color(0xffad3d36),
                                        overview.dailyTrends
                                            .map(
                                              (day) =>
                                                  day.clientErrors == null ||
                                                      day.serverErrors == null
                                                  ? null
                                                  : day.clientErrors! +
                                                        day.serverErrors!,
                                            )
                                            .toList(),
                                      ),
                                      TrafficSeries(
                                        t('Suspicious / high', '可疑／高'),
                                        const Color(0xff8d5b0c),
                                        overview.dailyTrends
                                            .map(
                                              (day) =>
                                                  day.suspicious == null ||
                                                      day.highRisk == null
                                                  ? null
                                                  : day.suspicious! +
                                                        day.highRisk!,
                                            )
                                            .toList(),
                                      ),
                                    ],
                                  ),
                                ];
                                if (constraints.maxWidth < 850) {
                                  return Column(
                                    children: [
                                      charts[0],
                                      const SizedBox(height: 16),
                                      charts[1],
                                    ],
                                  );
                                }
                                return Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(child: charts[0]),
                                    const SizedBox(width: 16),
                                    Expanded(child: charts[1]),
                                  ],
                                );
                              },
                            ),
                            ExpansionTile(
                              title: Text(
                                t('Daily values and availability', '每日數值與可用性'),
                              ),
                              children: [
                                SingleChildScrollView(
                                  scrollDirection: Axis.horizontal,
                                  child: DataTable(
                                    columns: [
                                      for (final label in [
                                        t('UTC day', 'UTC 日期'),
                                        t('Status', '狀態'),
                                        t('Page views', '頁面瀏覽'),
                                        t('API requests', 'API 請求'),
                                        t('Errors', '錯誤'),
                                        t('Risk observations', '風險觀測'),
                                      ])
                                        DataColumn(label: Text(label)),
                                    ],
                                    rows: [
                                      for (final day in overview.dailyTrends)
                                        DataRow(
                                          cells: [
                                            DataCell(Text(day.date)),
                                            DataCell(
                                              Text(
                                                trafficLabel(
                                                  day.status,
                                                  isZhTw,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                trafficNumber(
                                                  day.pageViews,
                                                  isZhTw,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                trafficNumber(
                                                  day.apiRequests,
                                                  isZhTw,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                trafficNumber(
                                                  day.clientErrors == null ||
                                                          day.serverErrors ==
                                                              null
                                                      ? null
                                                      : day.clientErrors! +
                                                            day.serverErrors!,
                                                  isZhTw,
                                                ),
                                              ),
                                            ),
                                            DataCell(
                                              Text(
                                                trafficNumber(
                                                  day.suspicious == null ||
                                                          day.highRisk == null
                                                      ? null
                                                      : day.suspicious! +
                                                            day.highRisk!,
                                                  isZhTw,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      if (overview.probes != null)
                        _probeSection(context, overview.probes!),
                      TrafficSection(
                        title: t('Website acquisition', '網站流量來源'),
                        note: t(
                          'Referrers can be missing or spoofed. AI referrals are not AI crawler activity.',
                          '引薦來源可能缺少或遭偽造；AI 引薦不代表 AI 爬蟲。',
                        ),
                        child: TrafficColumns(
                          children: [
                            _distribution(
                              t('Acquisition channels', '取得管道'),
                              overview.website,
                              'channels',
                            ),
                            _distribution(
                              t('Campaign sources', '活動來源'),
                              overview.website,
                              'campaignSources',
                            ),
                            _distribution(
                              t('Campaign mediums', '活動媒介'),
                              overview.website,
                              'campaignMediums',
                            ),
                            _distribution(
                              t('Page categories', '頁面分類'),
                              overview.website,
                              'pages',
                            ),
                          ],
                        ),
                      ),
                      TrafficSection(
                        title: t('API client intelligence', 'API 用戶端情報'),
                        note: t(
                          'Browser-like traffic is not proven human. Verification states are request counts, not a verification success rate.',
                          '類似瀏覽器的流量不代表真人。驗證狀態是請求數，並非驗證成功率。',
                        ),
                        child: TrafficColumns(
                          children: [
                            _distribution(
                              t('Client classifications', '用戶端分類'),
                              overview.api,
                              'classifications',
                            ),
                            _distribution(
                              t('Bot verification', '機器人驗證'),
                              overview.api,
                              'verificationStatuses',
                            ),
                            _distribution(
                              t('API request sources', 'API 請求來源'),
                              overview.api,
                              'sourceChannels',
                            ),
                          ],
                        ),
                      ),
                      TrafficSection(
                        title: t('Geographic intelligence', '地理情報'),
                        note: t(
                          'Approximate network location, not a visitor address. ASN ownership does not establish malicious intent. GeoLite2 data attribution: MaxMind (maxmind.com).',
                          '此為概略網路位置，並非訪客地址。ASN 歸屬不代表惡意行為。GeoLite2 資料來源：MaxMind（maxmind.com）。',
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t(
                                'Known country coverage · API ${trafficPercent(summary['apiKnownCountryRate'] as num?)} · Website ${trafficPercent(summary['websiteKnownCountryRate'] as num?)}',
                                '已知國家涵蓋率 · API ${trafficPercent(summary['apiKnownCountryRate'] as num?)} · 網站 ${trafficPercent(summary['websiteKnownCountryRate'] as num?)}',
                              ),
                            ),
                            const SizedBox(height: 12),
                            TrafficColumns(
                              children: [
                                _distribution(
                                  t('API countries', 'API 國家'),
                                  overview.api,
                                  'countries',
                                  countries: true,
                                ),
                                _distribution(
                                  t('Website countries', '網站國家'),
                                  overview.website,
                                  'countries',
                                  countries: true,
                                ),
                                _distribution(
                                  t('API autonomous systems', 'API 自治系統'),
                                  overview.api,
                                  'asns',
                                  asns: true,
                                ),
                                _distribution(
                                  t('Website autonomous systems', '網站自治系統'),
                                  overview.website,
                                  'asns',
                                  asns: true,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      TrafficSection(
                        title: t('Security observations', '安全觀測'),
                        note: t(
                          'Heuristic observations, not confirmed incidents. Rate-limited requests are a subset of client errors.',
                          '此為啟發式觀測，並非已確認事件。受限流請求是用戶端錯誤的子集。',
                        ),
                        child: TrafficColumns(
                          children: [
                            _distribution(
                              t('API risk levels', 'API 風險等級'),
                              overview.api,
                              'riskLevels',
                            ),
                            TrafficPanel(
                              title: t('Request outcomes', '請求結果'),
                              child: Column(
                                children: [
                                  for (final item in [
                                    (
                                      'clientErrors',
                                      t('Client errors', '用戶端錯誤'),
                                    ),
                                    (
                                      'serverErrors',
                                      t('Server errors', '伺服器錯誤'),
                                    ),
                                    ('aborted', t('Aborted', '中斷')),
                                    ('rateLimited', t('Rate limited', '受限流')),
                                  ])
                                    Padding(
                                      padding: const EdgeInsets.only(
                                        bottom: 10,
                                      ),
                                      child: Row(
                                        children: [
                                          Expanded(child: Text(item.$2)),
                                          Text(
                                            trafficNumber(
                                              hasData
                                                  ? overview.api[item.$1]
                                                        as num?
                                                  : null,
                                              isZhTw,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      TrafficSection(
                        title: t('Browsers and operating systems', '瀏覽器與作業系統'),
                        child: TrafficColumns(
                          children: [
                            _distribution(
                              t('Website browsers', '網站瀏覽器'),
                              overview.website,
                              'browsers',
                            ),
                            _distribution(
                              t('Website operating systems', '網站作業系統'),
                              overview.website,
                              'operatingSystems',
                            ),
                          ],
                        ),
                      ),
                      TrafficSection(
                        title: t('Data quality', '資料品質'),
                        note: t(
                          'Data may be lost during restarts or crashes. Static-only crawling and direct Firestore reads are outside complete monitoring.',
                          '重新啟動或當機可能遺失資料；靜態頁面爬取與直接 Firestore 讀取不在完整監控範圍。',
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t(
                                'Invalid days: ${coverage.invalidDays} · Unsupported schema days: ${coverage.unsupportedDays}',
                                '無效天數：${coverage.invalidDays} · 不支援的結構天數：${coverage.unsupportedDays}',
                              ),
                            ),
                            Text(
                              t(
                                'Current UTC day may be incomplete: ${overview.dataQuality['currentDayPartial'] == true
                                    ? 'Yes'
                                    : overview.dataQuality['currentDayPartial'] == false
                                    ? 'No'
                                    : 'Unavailable'}',
                                '目前 UTC 日期可能尚未完整：${overview.dataQuality['currentDayPartial'] == true
                                    ? '是'
                                    : overview.dataQuality['currentDayPartial'] == false
                                    ? '否'
                                    : '不可用'}',
                              ),
                            ),
                            if (overview.dataQuality['issues'] is List)
                              for (final issue
                                  in (overview.dataQuality['issues'] as List)
                                      .whereType<String>())
                                Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Text(trafficLabel(issue, isZhTw)),
                                ),
                            const SizedBox(height: 12),
                            TrafficColumns(
                              children: [
                                _distribution(
                                  t('API network confidence', 'API 網路可信度'),
                                  overview.api,
                                  'identityConfidence',
                                ),
                                _distribution(
                                  t('Website network confidence', '網站網路可信度'),
                                  overview.website,
                                  'identityConfidence',
                                ),
                                _distribution(
                                  t('API geographic resolution', 'API 地理解析'),
                                  overview.api,
                                  'geoStatuses',
                                ),
                                _distribution(
                                  t('Website geographic resolution', '網站地理解析'),
                                  overview.website,
                                  'geoStatuses',
                                ),
                              ],
                            ),
                            const SizedBox(height: 14),
                            TrafficPanel(
                              title: t(
                                'Configured collection features',
                                '資料收集設定',
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (overview.dataQuality['flags'] is! Map ||
                                      (overview.dataQuality['flags'] as Map)
                                          .isEmpty)
                                    Text(
                                      t(
                                        'Feature status unavailable',
                                        '功能狀態不可用',
                                      ),
                                    ),
                                  if (overview.dataQuality['flags'] is Map)
                                    for (final entry
                                        in (overview.dataQuality['flags']
                                                as Map)
                                            .entries)
                                      Text(
                                        '${trafficLabel(entry.key.toString(), isZhTw)}: ${entry.value == true ? t('Enabled', '已啟用') : t('Disabled', '未啟用')}',
                                      ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 18),
                            Text(
                              t(
                                'Page views are not unique visitors. Independent dimensions cannot be combined into country-by-crawler filters.',
                                '頁面瀏覽不是不重複訪客數。獨立維度無法組合成依國家篩選爬蟲的交叉分析。',
                              ),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _probeSection(BuildContext context, TrafficProbeOverview probes) {
    final totals = probes.totals;
    String category(String key) => switch (key) {
      'environment' => t('Environment files', '環境設定檔'),
      'git_metadata' => t('Git metadata', 'Git 中繼資料'),
      'wordpress' => t('WordPress', 'WordPress'),
      'backup' => t('Backup files', '備份檔案'),
      'path_traversal' => t('Path traversal', '路徑遍歷'),
      'admin_tools' => t('Administration tools', '管理工具'),
      'configuration' => t('Configuration', '組態設定'),
      'credentials' => t('Credential files', '憑證檔案'),
      'other_sensitive' => t('Other sensitive paths', '其他敏感路徑'),
      'aborted' => t('Aborted', '連線中止'),
      'other4xx' => t('Other 4xx', '其他 4xx'),
      _ => trafficLabel(key, isZhTw),
    };
    return TrafficSection(
      title: t('Security Probe Intelligence', '安全探測情報'),
      note: t(
        'Observation only. Matched requests are signals, not confirmed attacks or people. Only traffic reaching Express is observed.',
        '僅供觀測；符合規則的請求是訊號，不代表已確認的攻擊或人數。僅觀測實際到達 Express 的流量。',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(probes.enabled
              ? t('Collection enabled', '已啟用收集')
              : t('Collection disabled; historical observations only', '收集已停用；僅顯示歷史觀測')),
          Text(t(
            'Observed days: ${probes.observedDays}/${overview.coverage.requestedDays} · Invalid: ${probes.invalidDays}. Days may be partial.',
            '有觀測的日期：${probes.observedDays}/${overview.coverage.requestedDays} · 無效：${probes.invalidDays}。日期可能僅有部分觀測。',
          )),
          const SizedBox(height: 12),
          if (totals == null)
            Text(t('No probe observations available; missing does not mean zero.',
                '無可用探測觀測；缺少資料不代表零次。'))
          else ...[
            TrafficColumns(children: [
              _metric(context, t('Requests observed', '已觀測請求'), totals['observedRequests']),
              _metric(context, t('Matched probes', '符合規則的探測'), totals['matchedRequests']),
              _metric(context, t('Correlatable probes', '可關聯探測'), totals['correlatedRequests']),
              _metric(context, t('Repeat probe requests', '重複探測請求'), totals['repeatRequests']),
              _metric(context, t('Multi-category requests', '跨類型探測請求'), totals['multiCategoryRequests']),
              _metric(context, t('Probe 2xx responses', '探測 2xx 回應'), totals['success2xx']),
            ]),
            Text(t(
              'Repeat and multi-category counts use a 60-second, process-local trusted fingerprint window; they are request counts, not unique sources. Review 2xx responses; they do not prove disclosure.',
              '重複及跨類型計數採單程序 60 秒可信指紋視窗，為請求次數而非來源數。應檢查 2xx 回應，但不代表資料外洩。',
            )),
            TrafficTrend(
              title: t('Daily matched probes', '每日探測次數'),
              dates: overview.dailyTrends.map((day) => day.date).toList(),
              isZhTw: isZhTw,
              series: [TrafficSeries(t('Matched probes', '探測次數'),
                  const Color(0xff8d5b0c), probes.counts)],
            ),
            TrafficColumns(children: [
              for (final item in [
                ('probeTargets', t('Probe targets', '探測目標')),
                ('probeMethods', t('HTTP methods', 'HTTP 方法')),
                ('probeHours', t('Hour of day (UTC)', '時段（UTC）')),
                ('probeStatuses', t('Response outcomes', '回應結果')),
                ('classifications', t('Probe client classifications', '探測用戶端分類')),
                ('riskLevels', t('Probe risk levels', '探測風險等級')),
                ('verificationStatuses', t('Probe bot verification', '探測機器人驗證')),
                ('countries', t('Probe countries', '探測網路國別')),
                ('asns', t('Probe ASNs', '探測網路 ASN')),
                ('identityConfidence', t('Probe identity confidence', '探測來源可信度')),
                ('geoStatuses', t('Probe geography coverage', '探測地理覆蓋')),
              ])
                TrafficDistribution(
                  title: item.$2,
                  values: dimension(totals, item.$1),
                  isZhTw: isZhTw,
                  label: category,
                ),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _metric(
    BuildContext context,
    String label,
    dynamic value, {
    bool percent = false,
  }) => TrafficPanel(
    title: label,
    child: Text(
      percent
          ? trafficPercent(value is num ? value : null)
          : trafficNumber(value is num ? value : null, isZhTw),
      style: Theme.of(
        context,
      ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w600),
    ),
  );

  Widget _notice(BuildContext context, String message, bool danger) =>
      Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(14),
        width: double.infinity,
        decoration: BoxDecoration(
          color: danger ? const Color(0xffffedeb) : const Color(0xfffff4de),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(message),
      );

  Widget _distribution(
    String title,
    Map<String, dynamic> stream,
    String name, {
    bool countries = false,
    bool asns = false,
  }) => TrafficDistribution(
    title: title,
    values: overview.coverage.availableDays > 0
        ? dimension(stream, name)
        : const {},
    isZhTw: isZhTw,
    label: (key) => countries
        ? trafficCountryLabel(key, isZhTw)
        : asns
        ? trafficAsnLabel(key, isZhTw)
        : trafficLabel(key, isZhTw),
  );
}
