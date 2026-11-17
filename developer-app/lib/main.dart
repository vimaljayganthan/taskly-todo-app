import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'constants.dart';
import 'screens/dashboard_screen.dart';
import 'screens/login_screen.dart';
import 'services/api_service.dart';

final GlobalKey<NavigatorState> developerNavigatorKey = GlobalKey<NavigatorState>();

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

  // Fast, local-only session check (< 10ms, zero network latency)
  final hasSession = await ApiService().hasValidCachedSession();

  // Render the initial UI frame immediately (< 50ms)
  runApp(TasklyDeveloperApp(hasSession: hasSession));

  // Asynchronous non-blocking background initialization
  if (hasSession) {
    ApiService().verifySession().catchError((e) {
      debugPrint('[BackgroundInit] Warning verifying session: $e');
      return false;
    });
  }
}

class TasklyDeveloperApp extends StatelessWidget {
  final bool hasSession;

  const TasklyDeveloperApp({super.key, required this.hasSession});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: developerNavigatorKey,
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

