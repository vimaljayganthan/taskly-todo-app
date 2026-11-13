import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
    debugPrint('[PushBackground] Handling background message: ${message.messageId}');
  } catch (e) {
    debugPrint('[PushBackground] Error in background handler: $e');
  }
}

class DeveloperPushNotificationService {
  static final DeveloperPushNotificationService _instance =
      DeveloperPushNotificationService._internal();

  factory DeveloperPushNotificationService() => _instance;

  DeveloperPushNotificationService._internal();

  bool _initialized = false;
  String? _currentToken;

  String? get currentToken => _currentToken;

  Future<void> initialize() async {
    if (_initialized) return;

    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

      final messaging = FirebaseMessaging.instance;

      // Request permissions (especially critical on Android 13+ / POST_NOTIFICATIONS)
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );

      debugPrint('[PushInit] Notification permission status: ${settings.authorizationStatus}');

      // Fetch FCM Device Token
      final token = await messaging.getToken();
      if (token != null) {
        _currentToken = token;
        debugPrint('[PushInit] Obtained developer device token: ${token.substring(0, 15)}...');
        await syncTokenToSupabase(token);
      }

      // Listen for token refresh
      messaging.onTokenRefresh.listen((newToken) async {
        debugPrint('[PushInit] Token refreshed: ${newToken.substring(0, 15)}...');
        _currentToken = newToken;
        await syncTokenToSupabase(newToken);
      });

      // Foreground message listener
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        debugPrint('[PushForeground] Received notification: ${message.notification?.title} - ${message.notification?.body}');
      });

      // Handle message tap when app was in background
      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        debugPrint('[PushOpened] User tapped notification: ${message.data}');
      });

      _initialized = true;
    } catch (e) {
      debugPrint('[PushInit] Warning: Push notification initialization deferred or failed: $e');
    }
  }

  Future<void> syncTokenToSupabase([String? tokenToSync]) async {
    final token = tokenToSync ?? _currentToken;
    if (token == null || token.isEmpty) return;

    final client = Supabase.instance.client;
    final user = client.auth.currentUser;
    if (user == null) {
      debugPrint('[PushSync] Deferring token sync: No authenticated developer session');
      return;
    }

    try {
      await client.from('user_device_tokens').upsert(
        {
          'user_id': user.id,
          'device_token': token,
          'app_type': 'developer',
          'platform': 'android',
          'is_active': true,
          'last_seen_at': DateTime.now().toUtc().toIso8601String(),
        },
        onConflict: 'device_token',
      );
      debugPrint('[PushSync] Successfully registered developer device token in Supabase');
    } catch (e) {
      debugPrint('[PushSync] Error upserting developer device token: $e');
    }
  }

  Future<void> deactivateToken() async {
    final token = _currentToken;
    if (token == null) return;

    try {
      final client = Supabase.instance.client;
      await client
          .from('user_device_tokens')
          .update({'is_active': false, 'last_seen_at': DateTime.now().toUtc().toIso8601String()})
          .eq('device_token', token);
      debugPrint('[PushSync] Deactivated developer token on logout');
    } catch (e) {
      debugPrint('[PushSync] Error deactivating token: $e');
    }
  }
}

