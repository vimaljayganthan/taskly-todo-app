import 'package:flutter/material.dart';

enum BackendEnvironment {
  staging,
  custom,
}

class AppConstants {
  static const String appName = 'Taskly Developer';
  static const String authorizedAdminEmail = 'tasklypets@gmail.com';

  // Supabase Staging configuration (Publishable / Anon key ONLY - NEVER service-role key)
  static const String stagingSupabaseUrl = 'https://mbmqybxwibvqzomssopw.supabase.co';
  static const String stagingSupabaseProjectRef = 'mbmqybxwibvqzomssopw';
  static const String stagingSupabaseAnonKey =
      'sb_publishable_dvYwVMvEpRB4KPQEx1DUpg_0BC9JwGj';

  // API server URLs
  // Hosted backend: Dedicated permanent Taskly Developer Backend Vercel deployment
  static const String stagingApiUrl = 'https://taskly-developer-backend.vercel.app';
  static const String productionApiUrl = 'https://taskly-todo-app-4z1c.vercel.app';

  // Default API server URL for developer app: Strictly defaults to hosted Developer Backend HTTPS
  static const String defaultApiUrl = stagingApiUrl;

  // Centralized URL Normalization
  static String normalizeUrl(String raw) {
    var cleaned = raw.trim();
    while (cleaned.endsWith('/')) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }
    return cleaned;
  }

  // Centralized URL Validation
  static void validateUrl(String url) {
    final cleaned = url.trim();
    if (cleaned.isEmpty) {
      throw const FormatException('Server URL cannot be empty.');
    }
    final uri = Uri.tryParse(cleaned);
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
      throw const FormatException(
        'Invalid URL format. Must include scheme (https://) and host.',
      );
    }
    if (uri.scheme != 'https') {
      throw const FormatException(
        'Invalid URL scheme. Only secure HTTPS (https://) URLs are permitted.',
      );
    }
    if (uri.userInfo.isNotEmpty) {
      throw const FormatException('Credentials inside server URL are strictly prohibited.');
    }
  }

  // Brand Palette (Light, professional developer dashboard)
  static const Color primaryColor = Color(0xFF2563EB); // Taskly Royal Blue
  static const Color primaryDark = Color(0xFF1D4ED8);
  static const Color accentColor = Color(0xFF10B981); // Emerald Green
  static const Color backgroundColor = Color(0xFFF8FAFC); // Crisp slate light
  static const Color cardColor = Colors.white;
  static const Color textColor = Color(0xFF0F172A);
  static const Color textMuted = Color(0xFF64748B);
  static const Color borderColor = Color(0xFFE2E8F0);

  // Status Colors
  static const Color statusOpen = Color(0xFF3B82F6); // Blue
  static const Color statusInProgress = Color(0xFFF59E0B); // Amber
  static const Color statusWaiting = Color(0xFF8B5CF6); // Purple
  static const Color statusResolved = Color(0xFF10B981); // Green
  static const Color statusClosed = Color(0xFF6B7280); // Grey

  // Internal Note Color
  static const Color internalNoteBg = Color(0xFFFEF3C7); // Warm amber
  static const Color internalNoteBorder = Color(0xFFF59E0B);
  static const Color internalNoteText = Color(0xFF92400E);
}
