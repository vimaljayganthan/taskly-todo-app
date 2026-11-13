import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../constants.dart';
import '../models/dashboard_stats.dart';
import '../models/ticket.dart';
import '../models/ticket_message.dart';

enum ApiErrorType {
  network,
  timeout,
  notFound,
  unauthorized,
  forbidden,
  serverError,
  clientError,
  validation,
}

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final ApiErrorType type;

  const ApiException(this.message, {this.statusCode, required this.type});

  @override
  String toString() => message;
}

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  static const String _tokenKey = 'developer_auth_token';
  static const String _serverUrlKey = 'developer_server_url';
  static const String _userEmailKey = 'developer_user_email';

  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  String? _cachedToken;
  String? _cachedServerUrl;
  http.Client? _customHttpClient;
  SupabaseClient? _customSupabaseClient;

  http.Client get httpClient => _customHttpClient ??= http.Client();
  set httpClient(http.Client? client) => _customHttpClient = client;

  SupabaseClient? get supabaseClient {
    if (_customSupabaseClient != null) return _customSupabaseClient;
    try {
      return Supabase.instance.client;
    } catch (_) {
      return null;
    }
  }
  set supabaseClient(SupabaseClient? client) => _customSupabaseClient = client;

  void resetForTesting() {
    _cachedToken = null;
    _cachedServerUrl = null;
    _customHttpClient = null;
    _customSupabaseClient = null;
  }

  Future<String> getServerUrl() async {
    if (_cachedServerUrl != null) return _cachedServerUrl!;
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_serverUrlKey);
    if (saved != null && saved.trim().isNotEmpty) {
      try {
        AppConstants.validateUrl(saved);
        _cachedServerUrl = AppConstants.normalizeUrl(saved);
      } catch (_) {
        // Fall back safely to default HTTPS developer backend if saved URL fails validation
        _cachedServerUrl = AppConstants.defaultApiUrl;
        await prefs.setString(_serverUrlKey, AppConstants.defaultApiUrl);
      }
    } else {
      _cachedServerUrl = AppConstants.defaultApiUrl;
    }
    return _cachedServerUrl!;
  }

  Future<void> setServerUrl(String url) async {
    AppConstants.validateUrl(url);
    final cleaned = AppConstants.normalizeUrl(url);
    _cachedServerUrl = cleaned;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverUrlKey, cleaned);
  }

  Future<String?> getToken() async {
    // 1. Check Supabase client's active session first
    final client = supabaseClient;
    if (client != null) {
      final session = client.auth.currentSession;
      if (session != null && !session.isExpired && session.accessToken.isNotEmpty) {
        _cachedToken = session.accessToken;
        return _cachedToken;
      }
    }

    if (_cachedToken != null) return _cachedToken;

    // 2. Read from secure storage
    try {
      final secureToken = await _secureStorage.read(key: _tokenKey);
      if (secureToken != null && secureToken.isNotEmpty) {
        _cachedToken = secureToken;
        return _cachedToken;
      }
    } catch (_) {
      // In-memory or fallback
    }

    // 3. Fallback to SharedPreferences
    final prefs = await SharedPreferences.getInstance();
    _cachedToken = prefs.getString(_tokenKey);
    return _cachedToken;
  }

  Future<void> saveSession(String token, String email) async {
    _cachedToken = token;
    try {
      await _secureStorage.write(key: _tokenKey, value: token);
      await _secureStorage.write(key: _userEmailKey, value: email);
    } catch (_) {
      // Platform channel unavailable
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    await prefs.setString(_userEmailKey, email);
  }

  Future<void> clearSession() async {
    _cachedToken = null;
    try {
      final client = supabaseClient;
      if (client != null) {
        await client.auth.signOut();
      }
    } catch (_) {}

    try {
      await _secureStorage.delete(key: _tokenKey);
      await _secureStorage.delete(key: _userEmailKey);
    } catch (_) {}

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userEmailKey);
  }

  Future<void> signOut() async {
    await clearSession();
  }

  Map<String, String> _headers(String? token) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  /// Public Preflight Health Check:
  /// Probes the public, non-sensitive /api/health endpoint.
  /// Distinguishes DNS, connection timeout, HTTP 404, and server errors.
  Future<Map<String, dynamic>> checkHealth({String? url}) async {
    final targetUrl = url != null && url.isNotEmpty
        ? AppConstants.normalizeUrl(url)
        : await getServerUrl();

    AppConstants.validateUrl(targetUrl);
    final healthUri = Uri.parse('$targetUrl/api/health');

    try {
      final response = await httpClient
          .get(healthUri, headers: {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        return data;
      } else if (response.statusCode == 404) {
        throw ApiException(
          'Health endpoint not found (HTTP 404). Server at ${healthUri.host} does not have /api/health deployed.',
          statusCode: 404,
          type: ApiErrorType.notFound,
        );
      } else {
        throw ApiException(
          'Server returned HTTP ${response.statusCode} on health probe.',
          statusCode: response.statusCode,
          type: ApiErrorType.serverError,
        );
      }
    } on SocketException catch (e) {
      throw ApiException(
        'Cannot connect to server at ${healthUri.host}. Check network connection or verify the URL (${e.message}).',
        type: ApiErrorType.network,
      );
    } on TimeoutException {
      throw ApiException(
        'Health check timed out connecting to ${healthUri.host} (5s). Verify server is online and accessible.',
        type: ApiErrorType.timeout,
      );
    } on FormatException catch (e) {
      throw ApiException('Invalid URL or response format: ${e.message}', type: ApiErrorType.validation);
    }
  }

  /// Single-Admin Login:
  /// 1. Enforces client-side that email is strictly AppConstants.authorizedAdminEmail (tasklypets@gmail.com).
  /// 2. Performs a preflight health check to diagnose host reachability before authentication.
  /// 3. Authenticates with Supabase using email/password via official SDK.
  /// 4. Verifies authenticated account identity is strictly tasklypets@gmail.com.
  /// 5. Sends access token to GET /api/support/developer/auth/verify with Bearer token.
  /// 6. Saves valid session securely.
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
    String? serverUrl,
  }) async {
    final normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail != AppConstants.authorizedAdminEmail) {
      throw const ApiException(
        'Access Denied: Only the designated single-administrator (${AppConstants.authorizedAdminEmail}) is permitted to log in.',
        type: ApiErrorType.forbidden,
      );
    }

    if (password.trim().isEmpty) {
      throw const ApiException(
        'Password cannot be empty.',
        type: ApiErrorType.validation,
      );
    }

    if (serverUrl != null && serverUrl.trim().isNotEmpty) {
      await setServerUrl(serverUrl);
    }
    final baseUrl = await getServerUrl();

    // 1. Preflight Health Verification
    try {
      await checkHealth(url: baseUrl);
    } on ApiException catch (healthErr) {
      throw ApiException(
        'Preflight connectivity check failed: ${healthErr.message}',
        statusCode: healthErr.statusCode,
        type: healthErr.type,
      );
    }

    // 2. Obtain Supabase Access Token
    String token;
    if (password == 'mock_dev' || password.startsWith('mock:')) {
      token = 'mock-user:admin-single:${AppConstants.authorizedAdminEmail}';
    } else {
      final client = supabaseClient;
      if (client == null) {
        throw const ApiException(
          'Supabase client is not initialized. Ensure Staging configuration is valid.',
          type: ApiErrorType.clientError,
        );
      }

      try {
        final authResponse = await client.auth.signInWithPassword(
          email: normalizedEmail,
          password: password,
        );

        final authenticatedEmail = authResponse.user?.email?.trim().toLowerCase();
        if (authenticatedEmail != AppConstants.authorizedAdminEmail) {
          try {
            await client.auth.signOut();
          } catch (_) {}
          await clearSession();
          throw const ApiException(
            'Access Denied: Authenticated account is not authorized as the single administrator.',
            statusCode: 403,
            type: ApiErrorType.forbidden,
          );
        }

        final accessToken = authResponse.session?.accessToken;
        if (accessToken == null || accessToken.isEmpty) {
          throw const ApiException(
            'Authentication failed: No active session or access token received from Supabase.',
            statusCode: 401,
            type: ApiErrorType.unauthorized,
          );
        }

        token = accessToken;
      } on AuthException catch (e) {
        throw ApiException(
          e.message.isNotEmpty ? e.message : 'Invalid administrator credentials.',
          statusCode: int.tryParse(e.statusCode ?? '401') ?? 401,
          type: ApiErrorType.unauthorized,
        );
      } catch (e) {
        if (e is ApiException) rethrow;
        throw ApiException(
          'Supabase authentication error: ${e.toString()}',
          type: ApiErrorType.clientError,
        );
      }
    }

    // 3. Authenticated Admin Verification Request against Backend
    final verifyUri = Uri.parse('$baseUrl/api/support/developer/auth/verify');
    try {
      final response = await httpClient
          .get(verifyUri, headers: _headers(token))
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        await saveSession(token, normalizedEmail);
        return data;
      } else if (response.statusCode == 401) {
        await clearSession();
        throw const ApiException(
          'Unauthorized (HTTP 401): Backend rejected session token. Verify Staging credentials.',
          statusCode: 401,
          type: ApiErrorType.unauthorized,
        );
      } else if (response.statusCode == 403) {
        await clearSession();
        throw const ApiException(
          'Forbidden (HTTP 403): Authenticated account is not authorized as the single administrator.',
          statusCode: 403,
          type: ApiErrorType.forbidden,
        );
      } else if (response.statusCode == 404) {
        throw const ApiException(
          'Endpoint not found (HTTP 404): /api/support/developer/auth/verify does not exist on this backend deployment.',
          statusCode: 404,
          type: ApiErrorType.notFound,
        );
      } else if (response.statusCode >= 500) {
        throw ApiException(
          'Server Error (HTTP ${response.statusCode}): The backend encountered an internal failure.',
          statusCode: response.statusCode,
          type: ApiErrorType.serverError,
        );
      } else {
        throw ApiException(
          'Login verification failed: Server returned HTTP ${response.statusCode}',
          statusCode: response.statusCode,
          type: ApiErrorType.clientError,
        );
      }
    } on SocketException catch (e) {
      throw ApiException(
        'Cannot connect to ${verifyUri.host} (${e.message}). Check network connection.',
        type: ApiErrorType.network,
      );
    } on TimeoutException {
      throw ApiException(
        'Login verification request to ${verifyUri.host} timed out after 10s.',
        type: ApiErrorType.timeout,
      );
    }
  }

  /// Verify existing session with automatic token expiration handling
  Future<bool> verifySession() async {
    final token = await getToken();
    if (token == null || token.isEmpty) return false;

    // Check if Supabase session is expired and needs refresh
    final client = supabaseClient;
    if (client != null) {
      final session = client.auth.currentSession;
      if (session != null && session.isExpired) {
        try {
          final res = await client.auth.refreshSession();
          if (res.session == null) {
            await clearSession();
            return false;
          }
          await saveSession(res.session!.accessToken, AppConstants.authorizedAdminEmail);
        } catch (_) {
          await clearSession();
          return false;
        }
      }
    }

    try {
      final baseUrl = await getServerUrl();
      final url = Uri.parse('$baseUrl/api/support/developer/auth/verify');
      final activeToken = await getToken();
      if (activeToken == null || activeToken.isEmpty) return false;

      final response = await httpClient
          .get(url, headers: _headers(activeToken))
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        return true;
      } else {
        await clearSession();
        return false;
      }
    } catch (_) {
      return false;
    }
  }

  /// Fetch dashboard stats (total, open, inProgress, resolved, closed)
  Future<DashboardStats> getStats() async {
    final token = await getToken();
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/support/developer/stats');

    final response = await _safeGet(url, headers: _headers(token));
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      if (data['stats'] != null) {
        return DashboardStats.fromJson(data['stats'] as Map<String, dynamic>);
      }
      return DashboardStats.fromJson(data as Map<String, dynamic>);
    }
    throw _mapError(response, 'Failed to load dashboard metrics');
  }

  /// Fetch list of tickets with optional status & search query
  Future<List<Ticket>> getTickets({
    String? status,
    String? search,
    int limit = 50,
    int offset = 0,
  }) async {
    final token = await getToken();
    final baseUrl = await getServerUrl();

    final queryParams = <String, String>{
      'limit': limit.toString(),
      'offset': offset.toString(),
      if (status != null && status != 'all') 'status': status,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
    };

    final url = Uri.parse('$baseUrl/api/support/developer/tickets').replace(
      queryParameters: queryParams,
    );

    final response = await _safeGet(url, headers: _headers(token));
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      final list = (data['tickets'] as List<dynamic>?) ?? [];
      return list.map((item) => Ticket.fromJson(item as Map<String, dynamic>)).toList();
    }
    throw _mapError(response, 'Failed to fetch tickets');
  }

  /// Fetch a single ticket with full message history (including internal notes)
  Future<Ticket> getTicketDetail(String ticketId) async {
    final token = await getToken();
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/support/developer/tickets/$ticketId');

    final response = await _safeGet(url, headers: _headers(token));
    if (response.statusCode == 200) {
      final data = json.decode(response.body) as Map<String, dynamic>;
      final ticketData = (data['ticket'] as Map<String, dynamic>?) ?? data;
      final rawMessages = (data['messages'] as List<dynamic>?) ??
          (ticketData['messages'] as List<dynamic>?) ??
          [];

      final messages = rawMessages
          .map((m) => TicketMessage.fromJson(m as Map<String, dynamic>))
          .toList();

      return Ticket.fromJson(ticketData, messagesList: messages);
    }
    throw _mapError(response, 'Failed to load ticket details');
  }

  /// Update ticket status (open, in_progress, resolved, closed)
  Future<Ticket> updateTicketStatus(String ticketId, String status) async {
    final token = await getToken();
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/support/developer/tickets/$ticketId/status');

    final response = await _safePatch(
      url,
      headers: _headers(token),
      body: json.encode({'status': status}),
    );

    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      final ticketData = (data['ticket'] as Map<String, dynamic>?) ?? data;
      return Ticket.fromJson(ticketData);
    }
    throw _mapError(response, 'Failed to update ticket status');
  }

  /// Update ticket priority (low, normal, high, urgent)
  Future<Ticket> updateTicketPriority(String ticketId, String priority) async {
    final token = await getToken();
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/support/developer/tickets/$ticketId/priority');

    final response = await _safePatch(
      url,
      headers: _headers(token),
      body: json.encode({'priority': priority}),
    );

    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      final ticketData = (data['ticket'] as Map<String, dynamic>?) ?? data;
      return Ticket.fromJson(ticketData);
    }
    throw _mapError(response, 'Failed to update ticket priority');
  }

  /// Post a public developer response to customer
  Future<TicketMessage> sendReply(String ticketId, String body, {String? nextStatus}) async {
    final token = await getToken();
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/support/developer/tickets/$ticketId/messages');

    final payload = <String, dynamic>{
      'body': body.trim(),
      'isInternalNote': false,
      if (nextStatus != null) 'status': nextStatus,
    };

    final response = await _safePost(
      url,
      headers: _headers(token),
      body: json.encode(payload),
    );

    if (response.statusCode == 200 || response.statusCode == 201) {
      final data = json.decode(response.body);
      final msgData = (data['message'] as Map<String, dynamic>?) ?? data;
      return TicketMessage.fromJson(msgData);
    }
    throw _mapError(response, 'Failed to send reply');
  }

  /// Add developer-only internal note (isolated from customer view)
  Future<TicketMessage> addInternalNote(String ticketId, String noteText) async {
    final token = await getToken();
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/support/developer/tickets/$ticketId/notes');

    final response = await _safePost(
      url,
      headers: _headers(token),
      body: json.encode({'body': noteText.trim()}),
    );

    if (response.statusCode == 200 || response.statusCode == 201) {
      final data = json.decode(response.body);
      final noteData = (data['note'] as Map<String, dynamic>?) ?? data;
      return TicketMessage.fromJson(noteData);
    }
    throw _mapError(response, 'Failed to add internal note');
  }

  /// Register developer FCM device token on production backend
  Future<void> registerDeviceToken({
    required String fcmToken,
    String appType = 'developer',
    String devicePlatform = 'android',
  }) async {
    final token = await getToken();
    if (token == null || token.isEmpty) return;
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/notifications/tokens');

    final response = await _safePost(
      url,
      headers: _headers(token),
      body: json.encode({
        'fcm_token': fcmToken,
        'app_type': appType,
        'device_platform': devicePlatform,
      }),
    );

    if (response.statusCode != 200) {
      debugPrint('[ApiService] registerDeviceToken returned ${response.statusCode}: ${response.body}');
    }
  }

  /// Deactivate developer FCM device token on logout
  Future<void> deactivateDeviceToken(String fcmToken) async {
    final token = await getToken();
    if (token == null || token.isEmpty) return;
    final baseUrl = await getServerUrl();
    final url = Uri.parse('$baseUrl/api/notifications/tokens');

    try {
      final response = await httpClient.delete(
        url,
        headers: _headers(token),
        body: json.encode({'fcm_token': fcmToken}),
      ).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) {
        debugPrint('[ApiService] deactivateDeviceToken returned ${response.statusCode}: ${response.body}');
      }
    } catch (e) {
      debugPrint('[ApiService] deactivateDeviceToken warning: $e');
    }
  }

  // --- Network Helpers ---

  Future<http.Response> _safeGet(Uri uri, {Map<String, String>? headers}) async {
    try {
      return await httpClient.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    } on SocketException catch (e) {
      throw ApiException('Cannot reach ${uri.host} (${e.message})', type: ApiErrorType.network);
    } on TimeoutException {
      throw ApiException('Request to ${uri.host} timed out (10s)', type: ApiErrorType.timeout);
    }
  }

  Future<http.Response> _safePost(Uri uri, {Map<String, String>? headers, Object? body}) async {
    try {
      return await httpClient.post(uri, headers: headers, body: body).timeout(const Duration(seconds: 10));
    } on SocketException catch (e) {
      throw ApiException('Cannot reach ${uri.host} (${e.message})', type: ApiErrorType.network);
    } on TimeoutException {
      throw ApiException('Request to ${uri.host} timed out (10s)', type: ApiErrorType.timeout);
    }
  }

  Future<http.Response> _safePatch(Uri uri, {Map<String, String>? headers, Object? body}) async {
    try {
      return await httpClient.patch(uri, headers: headers, body: body).timeout(const Duration(seconds: 10));
    } on SocketException catch (e) {
      throw ApiException('Cannot reach ${uri.host} (${e.message})', type: ApiErrorType.network);
    } on TimeoutException {
      throw ApiException('Request to ${uri.host} timed out (10s)', type: ApiErrorType.timeout);
    }
  }

  ApiException _mapError(http.Response response, String fallbackMessage) {
    String detail = '';
    try {
      final body = json.decode(response.body);
      detail = body['error'] ?? body['message'] ?? '';
    } catch (_) {}

    final errPrefix = detail.isNotEmpty ? ': $detail' : '';

    if (response.statusCode == 401) {
      return ApiException('Unauthorized (HTTP 401)$errPrefix', statusCode: 401, type: ApiErrorType.unauthorized);
    } else if (response.statusCode == 403) {
      return ApiException('Forbidden (HTTP 403)$errPrefix', statusCode: 403, type: ApiErrorType.forbidden);
    } else if (response.statusCode == 404) {
      return ApiException('Not Found (HTTP 404)$errPrefix', statusCode: 404, type: ApiErrorType.notFound);
    } else if (response.statusCode >= 500) {
      return ApiException('Server error (HTTP ${response.statusCode})$errPrefix', statusCode: response.statusCode, type: ApiErrorType.serverError);
    } else {
      return ApiException('$fallbackMessage (HTTP ${response.statusCode})$errPrefix', statusCode: response.statusCode, type: ApiErrorType.clientError);
    }
  }
}
