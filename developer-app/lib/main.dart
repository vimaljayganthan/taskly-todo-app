import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'constants.dart';
import 'screens/dashboard_screen.dart';
import 'screens/login_screen.dart';
import 'services/api_service.dart';
import 'services/push_notification_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Supabase.initialize(
      url: AppConstants.stagingSupabaseUrl,
      anonKey: AppConstants.stagingSupabaseAnonKey,
    );
  } catch (e) {
    debugPrint('Supabase initialization warning: $e');
  }

  await DeveloperPushNotificationService().initialize();

  final hasSession = await ApiService().verifySession();
  if (hasSession) {
    await DeveloperPushNotificationService().syncTokenToSupabase();
  }

  runApp(TasklyDeveloperApp(hasSession: hasSession));
}

class TasklyDeveloperApp extends StatelessWidget {
  final bool hasSession;

  const TasklyDeveloperApp({super.key, required this.hasSession});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConstants.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        scaffoldBackgroundColor: AppConstants.backgroundColor,
        primaryColor: AppConstants.primaryColor,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppConstants.primaryColor,
          brightness: Brightness.light,
          surface: Colors.white,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: AppConstants.textColor,
          elevation: 0,
        ),
        cardTheme: CardThemeData(
          color: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppConstants.borderColor),
          ),
        ),
      ),
      home: hasSession ? const DashboardScreen() : const LoginScreen(),
    );
  }
}

