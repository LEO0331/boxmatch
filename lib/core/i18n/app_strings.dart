import 'package:flutter/widgets.dart';

import '../../app/app_scope.dart';
import '../preferences/app_locale_controller.dart';

enum AppStatusLabel { active, reserved, completed, expired, cancelled }

class AppStrings {
  const AppStrings._(this._language);

  final AppLanguage _language;

  static AppStrings of(BuildContext context) {
    final language = AppScope.of(context).localeController.language;
    return AppStrings._(language);
  }

  bool get _zh => _language == AppLanguage.zhTw;

  String get appTitle => _zh ? 'Boxmatch 展場惜食' : 'Boxmatch';
  String get navListings => _zh ? '清單' : 'Listings';
  String get navMap => _zh ? '地圖' : 'Map';
  String get navPost => _zh ? '張貼' : 'Post';

  String get listingsTitle => _zh ? '展場剩食媒合' : 'Exhibition Surplus Food';
  String get refresh => _zh ? '重新整理' : 'Refresh';
  String get privateDonor => _zh ? '匿名企業' : 'Private donor';
  String get noActiveListings => _zh
      ? '目前沒有可領取項目。\n可切到地圖查看，或由企業先發佈。'
      : 'No active listings right now.\nTry checking map view or post a new listing.';
  String get localDemoModeNotice => _zh
      ? '目前為本機示範模式。若要跨裝置即時同步，請完成 Firebase 設定。'
      : 'Running in local demo mode. Configure Firebase to persist live data across devices.';
  String get platformDisclaimer => _zh
      ? '平台聲明：Boxmatch 僅提供媒合，不保證食品安全。'
      : 'Platform note: Boxmatch is a matching service only and does not guarantee food safety.';

  String get mapTitle => _zh ? '場館地圖' : 'Venue Map';
  String mapSource(String providerName) => _zh
      ? '地圖來源：$providerName（已啟用自動備援）'
      : 'Map source: $providerName (auto fallback enabled)';
  String activeCount(int count) => _zh ? '$count 筆進行中' : '$count active';

  String get listingDetailTitle => _zh ? '物件詳情' : 'Listing details';
  String get myReservationsTitle => _zh ? '我的預約' : 'My Reservations';
  String get myReservationsCta => _zh ? '我的預約' : 'My reservations';
  String get noMyReservations => _zh ? '目前尚無預約紀錄。' : 'No reservations yet.';
  String get cancelReservation => _zh ? '取消預約' : 'Cancel reservation';
  String get reservationCancelled => _zh ? '預約已取消。' : 'Reservation cancelled.';
  String get listingNotFound => _zh ? '找不到此物件。' : 'Listing not found.';
  String get reserveOneItem => _zh ? '預約 1 份' : 'Reserve 1 item';
  String get beforeReserving => _zh ? '預約前請確認' : 'Before reserving';
  String get reserveDisclaimer => _zh
      ? '本平台僅提供捐贈者與領取者媒合，不保證食品安全。'
      : 'This app only matches donors and recipients. Boxmatch does not guarantee food safety.';
  String get publicPickupOnlyNotice => _zh
      ? '安全提醒：僅限公開展場或服務台交付，不接受私下移動地點。'
      : 'Safety note: pickup must happen at public venue/service desk only. Do not move to private locations.';
  String get reserveDisclaimerAccept =>
      _zh ? '我已了解並同意此聲明。' : 'I understand and accept this disclaimer.';
  String get cancel => _zh ? '取消' : 'Cancel';
  String get reserve => _zh ? '預約' : 'Reserve';

  String get enterprisePostTitle => _zh ? '建立物件' : 'Post listing';
  String get enterpriseEditTitle => _zh ? '編輯物件' : 'Edit listing';
  String get reservationSection => _zh ? '預約管理' : 'Reservations';
  String get noReservationsYet => _zh ? '目前尚無預約。' : 'No reservations yet.';

  String get reservationConfirmed => _zh ? '預約成功' : 'Reservation confirmed';
  String get reservationNotFound => _zh ? '找不到此預約。' : 'Reservation not found.';
  String get offlineIdentityMode =>
      _zh ? '使用離線身份模式' : 'Using offline identity mode';
  String get reportSafetyConcern => _zh ? '回報風險事件' : 'Report safety concern';
  String get reportRiskSelectReasonTitle =>
      _zh ? '請選擇回報原因' : 'Select a reason';
  String get riskReasonPrivateLocation => _zh
      ? '要求改到私下地點面交'
      : 'Asked to move pickup to a private location';
  String get riskReasonSuspiciousBehavior =>
      _zh ? '現場行為可疑 / 騷擾' : 'Suspicious behavior / harassment';
  String get riskReasonNoShow =>
      _zh ? '公開取餐點無人交付' : 'No handoff at the public pickup point';
  String get riskReasonUnsafeCondition =>
      _zh ? '食物狀態疑似不安全' : 'Food condition appears unsafe';
  String get riskReasonOther => _zh ? '其他風險' : 'Other risk';
  String get abuseReported => _zh ? '已送出風險回報。' : 'Safety report submitted.';
  String get verifiedEnterprise => _zh ? '已驗證企業' : 'Verified enterprise';
  String get trustedQualityEnterprise => _zh ? '交付品質穩定' : 'Trusted handoff quality';
  String get highImpactEnterprise => _zh ? '高量捐贈企業' : 'High-impact donor';
  String get flexiblePickupEnterprise => _zh ? '彈性取餐時段' : 'Flexible pickup window';
  String get stableShelfLifeEnterprise => _zh ? '保存時效較穩定' : 'Stable shelf-life setup';
  String get pendingConfirm => _zh ? '待確認' : 'Pending';
  String get confirmedFilter => _zh ? '已確認' : 'Confirmed';
  String get showPickupCodeHelp => _zh
      ? '請在取餐時向企業出示這組 4 位數代碼。'
      : 'Show this 4-digit code to the enterprise at pickup.';
  String get frequentEnterprise => _zh ? '常態捐贈企業' : 'Frequent enterprise';
  String get privacyFaqTitle => _zh ? '隱私與常見問題' : 'Privacy & FAQ';
  String get privacyNotice => _zh
      ? '隱私提醒：平台僅顯示必要媒合資訊，不公開個人聯絡方式。'
      : 'Privacy note: Boxmatch only shows minimum matching info and does not expose personal contacts.';
  String get faqNotice => _zh
      ? 'FAQ：若遇到臨時改地點或可疑行為，請在預約頁按「回報風險事件」。'
      : 'FAQ: if pickup location is changed privately or suspicious behavior occurs, use "Report safety concern".';

  String get retry => _zh ? '重試' : 'Retry';
  String get genericLoadErrorTitle => _zh ? '讀取失敗' : 'Unable to load';
  String get genericLoadErrorBody => _zh
      ? '目前資料暫時無法載入，請稍後再試。'
      : 'We cannot load data right now. Please try again.';

  String statusLabel(AppStatusLabel status) {
    switch (status) {
      case AppStatusLabel.active:
        return _zh ? '可預約' : 'Active';
      case AppStatusLabel.reserved:
        return _zh ? '已預約' : 'Reserved';
      case AppStatusLabel.completed:
        return _zh ? '已完成' : 'Completed';
      case AppStatusLabel.expired:
        return _zh ? '已逾期' : 'Expired';
      case AppStatusLabel.cancelled:
        return _zh ? '已取消' : 'Cancelled';
    }
  }

  String? enterpriseBadgeLabel(String badgeId) {
    switch (badgeId) {
      case 'verified':
        return verifiedEnterprise;
      case 'quality_trusted':
        return trustedQualityEnterprise;
      case 'high_impact':
        return highImpactEnterprise;
      case 'flexible_pickup':
        return flexiblePickupEnterprise;
      case 'stable_shelf_life':
        return stableShelfLifeEnterprise;
      default:
        return null;
    }
  }
}
