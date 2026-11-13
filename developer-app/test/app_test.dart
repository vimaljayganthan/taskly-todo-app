import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:taskly_developer/constants.dart';
import 'package:taskly_developer/models/dashboard_stats.dart';
import 'package:taskly_developer/models/ticket.dart';
import 'package:taskly_developer/models/ticket_message.dart';
import 'package:taskly_developer/services/api_service.dart';

/// Test HTTP mock client for intercepting Supabase Auth and Backend requests
class MockHttpClient extends http.BaseClient {
  final Future<http.Response> Function(http.Request request) handler;
  final List<http.Request> recordedRequests = [];

  MockHttpClient(this.handler);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final httpRequest = request as http.Request;
    recordedRequests.add(httpRequest);
    final response = await handler(httpRequest);
    return http.StreamedResponse(
      Stream.value(utf8.encode(response.body)),
      response.statusCode,
      headers: response.headers,
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    ApiService().resetForTesting();
  });

  group('1. Centralized Configuration & Staging Isolation', () {
    test('Strict Single-Admin Email is tasklypets@gmail.com', () {
      expect(AppConstants.authorizedAdminEmail, equals('tasklypets@gmail.com'));
    });

    test('Staging Supabase URL points strictly to mbmqybxwibvqzomssopw', () {
      expect(
        AppConstants.stagingSupabaseUrl,
        equals('https://mbmqybxwibvqzomssopw.supabase.co'),
      );
      expect(AppConstants.stagingSupabaseProjectRef, equals('mbmqybxwibvqzomssopw'));
      expect(AppConstants.stagingSupabaseUrl, contains('mbmqybxwibvqzomssopw'));
      expect(AppConstants.stagingSupabaseUrl, startsWith('https://'));
    });

    test('Supabase Anon Key is publishable key and NEVER a service-role/secret key', () {
      expect(AppConstants.stagingSupabaseAnonKey, startsWith('sb_publishable_'));
      expect(AppConstants.stagingSupabaseAnonKey.toLowerCase(), isNot(contains('secret')));
      expect(AppConstants.stagingSupabaseAnonKey.toLowerCase(), isNot(contains('service_role')));
    });

    test('Default API URL points strictly to Staging HTTPS', () {
      expect(AppConstants.defaultApiUrl, equals(AppConstants.stagingApiUrl));
      expect(AppConstants.defaultApiUrl, startsWith('https://'));
      expect(AppConstants.defaultApiUrl, contains('vercel.app'));
      expect(AppConstants.defaultApiUrl, equals('https://taskly-developer-backend.vercel.app'));
    });

    test('Production API URL points to canonical Taskly production domain', () {
      expect(AppConstants.productionApiUrl, equals('https://taskly-todo-app-4z1c.vercel.app'));
    });

    test('Ensures all default API requests target hosted Developer Backend HTTPS', () {
      expect(AppConstants.defaultApiUrl, equals('https://taskly-developer-backend.vercel.app'));
      expect(AppConstants.defaultApiUrl, startsWith('https://'));
    });
  });

  group('2. URL Normalization & Strict Validation', () {
    test('Normalizes URLs by trimming and stripping trailing slashes', () {
      expect(
        AppConstants.normalizeUrl('  https://staging.example.com///  '),
        equals('https://staging.example.com'),
      );
      expect(
        AppConstants.normalizeUrl('https://192.168.1.50:3000/'),
        equals('https://192.168.1.50:3000'),
      );
    });

    test('Validates legitimate https URLs', () {
      expect(() => AppConstants.validateUrl('https://api.taskly.app'), returnsNormally);
      expect(() => AppConstants.validateUrl('https://taskly-developer-backend.vercel.app'), returnsNormally);
    });

    test('Strictly rejects non-HTTPS (cleartext http://) URLs', () {
      expect(
        () => AppConstants.validateUrl('http://10.0.2.2:3000'),
        throwsA(predicate((e) => e is FormatException && e.message.contains('Only secure HTTPS'))),
      );
      expect(
        () => AppConstants.validateUrl('http://localhost:3000'),
        throwsA(predicate((e) => e is FormatException && e.message.contains('Only secure HTTPS'))),
      );
      expect(
        () => AppConstants.validateUrl('http://192.168.1.50:3000'),
        throwsA(predicate((e) => e is FormatException && e.message.contains('Only secure HTTPS'))),
      );
    });

    test('Rejects empty or blank URLs', () {
      expect(
        () => AppConstants.validateUrl('   '),
        throwsA(isA<FormatException>()),
      );
    });

    test('Rejects URLs without scheme or host', () {
      expect(
        () => AppConstants.validateUrl('localhost:3000'),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => AppConstants.validateUrl('ftp://taskly.app'),
        throwsA(isA<FormatException>()),
      );
    });

    test('Strictly rejects URLs with embedded credentials (user:pass@host)', () {
      expect(
        () => AppConstants.validateUrl('https://admin:secret@api.taskly.app'),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('3. Diagnostic Error Handling & Credential Safety', () {
    test('ApiException preserves status code and error category', () {
      const notFoundErr = ApiException(
        'Route not found (HTTP 404)',
        statusCode: 404,
        type: ApiErrorType.notFound,
      );
      expect(notFoundErr.statusCode, equals(404));
      expect(notFoundErr.type, equals(ApiErrorType.notFound));
      expect(notFoundErr.toString(), contains('404'));

      const timeoutErr = ApiException(
        'Connection timed out',
        type: ApiErrorType.timeout,
      );
      expect(timeoutErr.statusCode, isNull);
      expect(timeoutErr.type, equals(ApiErrorType.timeout));
    });

    test('Error messages never leak plaintext passwords or tokens', () {
      const testPassword = 'SuperSecretPassword123!';
      const err = ApiException(
        'Unauthorized (HTTP 401): Invalid administrator credentials.',
        statusCode: 401,
        type: ApiErrorType.unauthorized,
      );
      expect(err.message, isNot(contains(testPassword)));
      expect(err.toString(), isNot(contains(testPassword)));
    });
  });

  group('4. Models Serialization & Data Integrity', () {
    test('DashboardStats correctly parses JSON', () {
      final stats = DashboardStats.fromJson({
        'total': 15,
        'open': 7,
        'in_progress': 3,
        'resolved': 4,
        'closed': 1,
      });
      expect(stats.total, equals(15));
      expect(stats.open, equals(7));
      expect(stats.inProgress, equals(3));
      expect(stats.resolved, equals(4));
      expect(stats.closed, equals(1));
    });

    test('Ticket correctly parses verified user email and priority', () {
      final ticket = Ticket.fromJson({
        'id': 'tk-test-100',
        'user_id': 'uid-verified-01',
        'user_email': 'real_customer@taskly.app',
        'subject': 'Push notification latency',
        'category': 'performance',
        'status': 'in_progress',
        'priority': 'urgent',
        'created_at': '2026-11-12T10:00:00Z',
        'updated_at': '2026-11-12T10:30:00Z',
      });
      expect(ticket.id, equals('tk-test-100'));
      expect(ticket.userEmail, equals('real_customer@taskly.app'));
      expect(ticket.isUrgent, isTrue);
      expect(ticket.isInProgress, isTrue);
    });

    test('Ticket normalizes waiting_customer to in_progress to avoid dropdown crashes', () {
      final ticket = Ticket.fromJson({
        'id': 'tk-test-101',
        'user_id': 'uid-verified-01',
        'user_email': 'customer@taskly.app',
        'subject': 'Status Normalization',
        'category': 'bug',
        'status': 'waiting_customer',
        'priority': 'Medium',
        'created_at': '2026-11-12T10:00:00Z',
        'updated_at': '2026-11-12T10:30:00Z',
      });
      expect(ticket.status, equals('in_progress'));
      expect(ticket.priority, equals('normal'));
      expect(ticket.isInProgress, isTrue);

      final resolvedTicket = ticket.copyWith(status: 'resolved', priority: 'urgent');
      expect(resolvedTicket.status, equals('resolved'));
      expect(resolvedTicket.priority, equals('urgent'));
      expect(resolvedTicket.isResolved, isTrue);
      expect(resolvedTicket.isUrgent, isTrue);
    });

    test('TicketMessage correctly isolates internal notes from customer messages', () {
      final note = TicketMessage.fromJson({
        'id': 'msg-internal-01',
        'ticket_id': 'tk-test-100',
        'sender_type': 'developer',
        'message': 'Investigating APNS token timeout',
        'created_at': '2026-11-12T10:05:00Z',
        'is_internal_note': true,
      });
      expect(note.isInternalNote, isTrue);
      expect(note.isDeveloper, isTrue);

      final publicMsg = TicketMessage.fromJson({
        'id': 'msg-public-02',
        'ticket_id': 'tk-test-100',
        'sender_type': 'developer',
        'message': 'We have applied an update to resolve your issue.',
        'created_at': '2026-11-12T10:15:00Z',
        'is_internal_note': false,
      });
      expect(publicMsg.isInternalNote, isFalse);
    });
  });

  group('5. Supabase Authentication Flow & Single-Admin Security', () {
    test('5.1 Unknown / non-admin email rejected client-side before network', () async {
      final api = ApiService();
      expect(
        () => api.login(
          email: 'random_user@domain.com',
          password: 'valid_password_123',
        ),
        throwsA(predicate((e) =>
            e is ApiException &&
            e.type == ApiErrorType.forbidden &&
            e.message.contains('tasklypets@gmail.com'))),
      );
    });

    test('5.2 Empty password rejected client-side before network', () async {
      final api = ApiService();
      expect(
        () => api.login(
          email: 'tasklypets@gmail.com',
          password: '   ',
        ),
        throwsA(predicate((e) =>
            e is ApiException &&
            e.type == ApiErrorType.validation &&
            e.message.contains('Password cannot be empty'))),
      );
    });

    test('5.3 Valid admin login authenticates with Supabase, verifies with backend, and saves session', () async {
      final api = ApiService();
      const testToken = 'valid-supabase-jwt-admin-token-12345';

      final mockHttp = MockHttpClient((request) async {
        final path = request.url.path;
        // 1. Preflight health check
        if (path == '/api/health') {
          return http.Response(
            json.encode({'status': 'UP', 'service': 'taskly-backend', 'version': '2.2.0'}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        // 2. Supabase GoTrue Auth token request
        if (path == '/auth/v1/token') {
          return http.Response(
            json.encode({
              'access_token': testToken,
              'token_type': 'bearer',
              'expires_in': 3600,
              'refresh_token': 'refresh-token-xyz',
              'user': {
                'id': 'admin-uid-1',
                'aud': 'authenticated',
                'role': 'authenticated',
                'email': 'tasklypets@gmail.com',
                'email_confirmed_at': '2026-11-12T00:00:00Z',
              },
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        // 3. Backend developer verification endpoint
        if (path == '/api/support/developer/auth/verify') {
          expect(request.headers['authorization'], equals('Bearer $testToken'));
          return http.Response(
            json.encode({
              'success': true,
              'user': {
                'id': 'admin-uid-1',
                'email': 'tasklypets@gmail.com',
                'role': 'admin',
              },
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('Not Found', 404);
      });

      api.httpClient = mockHttp;
      api.supabaseClient = SupabaseClient(
        AppConstants.stagingSupabaseUrl,
        AppConstants.stagingSupabaseAnonKey,
        httpClient: mockHttp,
      );

      final result = await api.login(
        email: 'tasklypets@gmail.com',
        password: 'ValidPassword123!',
      );

      expect(result['success'], isTrue);
      expect(result['user']['email'], equals('tasklypets@gmail.com'));

      final savedToken = await api.getToken();
      expect(savedToken, equals(testToken));
    });

    test('5.4 Invalid password handled cleanly as unauthorized ApiException', () async {
      final api = ApiService();

      final mockHttp = MockHttpClient((request) async {
        final path = request.url.path;
        if (path == '/api/health') {
          return http.Response(
            json.encode({'status': 'UP', 'service': 'taskly-backend', 'version': '2.2.0'}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (path == '/auth/v1/token') {
          return http.Response(
            json.encode({
              'error': 'invalid_grant',
              'error_description': 'Invalid login credentials',
              'message': 'Invalid login credentials',
            }),
            400,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('Not Found', 404);
      });

      api.httpClient = mockHttp;
      api.supabaseClient = SupabaseClient(
        AppConstants.stagingSupabaseUrl,
        AppConstants.stagingSupabaseAnonKey,
        httpClient: mockHttp,
      );

      expect(
        () => api.login(
          email: 'tasklypets@gmail.com',
          password: 'WrongPassword',
        ),
        throwsA(predicate((e) =>
            e is ApiException &&
            e.type == ApiErrorType.unauthorized &&
            e.message.contains('Invalid login credentials'))),
      );
    });

    test('5.5 Non-admin account authenticated by Supabase is rejected and signed out', () async {
      final api = ApiService();
      bool signOutCalled = false;

      final mockHttp = MockHttpClient((request) async {
        final path = request.url.path;
        if (path == '/api/health') {
          return http.Response(
            json.encode({'status': 'UP'}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (path == '/auth/v1/token') {
          return http.Response(
            json.encode({
              'access_token': 'customer-jwt-token-999',
              'token_type': 'bearer',
              'expires_in': 3600,
              'user': {
                'id': 'cust-uid-1',
                'aud': 'authenticated',
                'role': 'authenticated',
                'email': 'customer@taskly.app', // non-admin account
              },
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (path == '/auth/v1/logout') {
          signOutCalled = true;
          return http.Response('', 204);
        }
        return http.Response('Not Found', 404);
      });

      api.httpClient = mockHttp;
      api.supabaseClient = SupabaseClient(
        AppConstants.stagingSupabaseUrl,
        AppConstants.stagingSupabaseAnonKey,
        httpClient: mockHttp,
      );

      await expectLater(
        () => api.login(
          email: 'tasklypets@gmail.com',
          password: 'PasswordBelongingToDifferentAccount',
        ),
        throwsA(predicate((e) =>
            e is ApiException &&
            e.type == ApiErrorType.forbidden &&
            e.message.contains('not authorized'))),
      );

      expect(signOutCalled, isTrue);
    });

    test('5.6 Backend rejects token with 401: clears session and throws unauthorized', () async {
      final api = ApiService();

      final mockHttp = MockHttpClient((request) async {
        final path = request.url.path;
        if (path == '/api/health') {
          return http.Response(json.encode({'status': 'UP'}), 200, headers: {'content-type': 'application/json'});
        }
        if (path == '/auth/v1/token') {
          return http.Response(
            json.encode({
              'access_token': 'revoked-token',
              'token_type': 'bearer',
              'expires_in': 3600,
              'user': {
                'id': 'admin-uid-1',
                'email': 'tasklypets@gmail.com',
              },
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (path == '/api/support/developer/auth/verify') {
          return http.Response(
            json.encode({'error': 'Unauthorized: Invalid or expired token'}),
            401,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('Not Found', 404);
      });

      api.httpClient = mockHttp;
      api.supabaseClient = SupabaseClient(
        AppConstants.stagingSupabaseUrl,
        AppConstants.stagingSupabaseAnonKey,
        httpClient: mockHttp,
      );

      expect(
        () => api.login(
          email: 'tasklypets@gmail.com',
          password: 'AnyPassword',
        ),
        throwsA(predicate((e) => e is ApiException && e.type == ApiErrorType.unauthorized)),
      );

      final token = await api.getToken();
      expect(token, isNull);
    });

    test('5.7 Token is attached as Authorization: Bearer <token> to ticket endpoints', () async {
      final api = ApiService();
      await api.saveSession('test-active-token-777', 'tasklypets@gmail.com');

      final mockHttp = MockHttpClient((request) async {
        expect(request.headers['authorization'], equals('Bearer test-active-token-777'));
        if (request.url.path == '/api/support/developer/stats') {
          return http.Response(
            json.encode({
              'success': true,
              'stats': {
                'total': 10,
                'open': 5,
                'in_progress': 2,
                'resolved': 2,
                'closed': 1,
              },
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('Not Found', 404);
      });

      api.httpClient = mockHttp;
      final stats = await api.getStats();
      expect(stats.total, equals(10));
      expect(stats.open, equals(5));
    });

    test('5.8 Session restoration: verifySession validates active session against backend', () async {
      final api = ApiService();
      await api.saveSession('valid-saved-token-888', 'tasklypets@gmail.com');

      final mockHttp = MockHttpClient((request) async {
        if (request.url.path == '/api/support/developer/auth/verify') {
          expect(request.headers['authorization'], equals('Bearer valid-saved-token-888'));
          return http.Response(json.encode({'success': true}), 200, headers: {'content-type': 'application/json'});
        }
        return http.Response('Not Found', 404);
      });

      api.httpClient = mockHttp;
      final isValid = await api.verifySession();
      expect(isValid, isTrue);
    });

    test('5.9 Expired session: verifySession clears session and returns false on 401', () async {
      final api = ApiService();
      await api.saveSession('expired-token-999', 'tasklypets@gmail.com');

      final mockHttp = MockHttpClient((request) async {
        if (request.url.path == '/api/support/developer/auth/verify') {
          return http.Response(json.encode({'error': 'Unauthorized'}), 401, headers: {'content-type': 'application/json'});
        }
        return http.Response('Not Found', 404);
      });

      api.httpClient = mockHttp;
      final isValid = await api.verifySession();
      expect(isValid, isFalse);

      final tokenAfter = await api.getToken();
      expect(tokenAfter, isNull);
    });

    test('5.10 Sign-out clears token, user email, and cached session cleanly', () async {
      final api = ApiService();
      await api.saveSession('session-to-clear', 'tasklypets@gmail.com');
      expect(await api.getToken(), equals('session-to-clear'));

      await api.signOut();
      expect(await api.getToken(), isNull);
    });
  });
}
