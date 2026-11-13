import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../screens/ticket_detail_screen.dart';
import 'api_service.dart';

final GlobalKey<NavigatorState> developerNavigatorKey = GlobalKey<NavigatorState>();

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
        _handleNotificationTap(message.data);
      });

      // Handle message tap when app launched from terminated state
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        debugPrint('[PushOpened] App launched via notification: ${initialMessage.data}');
        _handleNotificationTap(initialMessage.data);
      }

      _initialized = true;
    } catch (e) {
      debugPrint('[PushInit] Warning: Push notification initialization deferred or failed: $e');
    }
  }

  void _handleNotificationTap(Map<String, dynamic> data) {
    final ticketId = data['ticket_id'] ?? data['ticketId'];
    if (ticketId != null && ticketId.toString().isNotEmpty) {
      final nav = developerNavigatorKey.currentState;
      if (nav != null) {
        nav.push(
          MaterialPageRoute(
            builder: (_) => TicketDetailScreen(ticketId: ticketId.toString()),
          ),
        );
      }
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

    final userEmail = (user.email ?? '').toLowerCase().trim();

    // 1. Prefer authenticated backend token-registration endpoint
    try {
      await ApiService().registerDeviceToken(
        fcmToken: token,
        appType: 'developer',
        devicePlatform: 'android',
      );
      debugPrint('[PushSync] Developer FCM token registered via backend API');
    } catch (e) {
      debugPrint('[PushSync] Backend API token registration warning: $e');
    }

    // 2. Direct Supabase sync using canonical schema as redundancy
    if (userEmail.isNotEmpty) {
      try {
        await client.from('user_device_tokens').upsert(
          {
            'user_id': user.id,
            'user_email': userEmail,
            'fcm_token': token,
            'app_type': 'developer',
            'device_platform': 'android',
            'is_active': true,
            'last_seen_at': DateTime.now().toUtc().toIso8601String(),
          },
          onConflict: 'fcm_token',
        );
        debugPrint('[PushSync] Successfully registered developer device token in Supabase user_device_tokens');
      } catch (e) {
        debugPrint('[PushSync] Error upserting developer device token to Supabase: $e');
      }
    }
  }

  Future<void> deactivateToken() async {
    final token = _currentToken;
    if (token == null) return;

    // 1. Deactivate via backend API
    try {
      await ApiService().deactivateDeviceToken(token);
    } catch (_) {}

    // 2. Deactivate in Supabase directly
    try {
      final client = Supabase.instance.client;
      await client
          .from('user_device_tokens')
          .update({'is_active': false, 'last_seen_at': DateTime.now().toUtc().toIso8601String()})
          .eq('fcm_token', token);
      debugPrint('[PushSync] Deactivated developer token on logout');
    } catch (e) {
      debugPrint('[PushSync] Error deactivating token in Supabase: $e');
    }
  }
}

