/**
 * Taskly Daily Routine Summary Scheduler (Backend Service)
 *
 * Responsibilities:
 * 1. Background scheduled execution according to each user's configured local time and timezone.
 * 2. Automated reconciliation of missed days when the server or user becomes available.
 * 3. Deterministic ticking mechanism (processTick) for automated testing and scheduled jobs.
 * 4. Idempotent report generation without duplicating or overwriting existing historical reports.
 * 5. Production Supabase customer account discovery and multi-user processing.
 * 6. Graceful fallback to local storage in non-production / offline mode.
 */

const crypto = require('crypto');
const SmartListStore = require('../storage/smartListStore');
const HabitStreakService = require('./habitStreakService');
const {
  getLocalYmdInTimezone,
  getLocalTimeInTimezone,
  addDays,
  toYmdString
} = HabitStreakService;

// Discontinued Developer / Staging Supabase project reference (strictly forbidden)
const FORBIDDEN_STAGING_SUPABASE_ID = 'mbmqybxwibvqzomssopw';

class DailyReportScheduler {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.tickIntervalMs = 60000; // 1 minute default
    this.testClient = null;
  }

  /**
   * Set or reset mock Supabase client for unit testing.
   */
  setTestClient(mockClient) {
    this.testClient = mockClient || null;
  }

  /**
   * Resolve an administrative Supabase client for multi-user account discovery and report generation.
   * Enforces security block against discontinued staging Supabase (mbmqybxwibvqzomssopw).
   */
  getSupabaseAdminClient() {
    if (this.testClient) {
      return this.testClient;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CUSTOMER_SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return null;
    }

    const cleanedUrl = supabaseUrl.trim();
    if (cleanedUrl.includes(FORBIDDEN_STAGING_SUPABASE_ID)) {
      throw new Error(
        `[DailyReportScheduler Security Violation] Attempted connection to discontinued developer/staging Supabase instance: ${FORBIDDEN_STAGING_SUPABASE_ID}`
      );
    }

    try {
      const { createClient } = require('@supabase/supabase-js');
      return createClient(cleanedUrl, serviceRoleKey, {
        auth: { persistSession: false }
      });
    } catch (err) {
      console.error('[DailyReportScheduler] Failed to initialize Supabase client:', err.message);
      return null;
    }
  }

  /**
   * Run a single reconciliation and generation tick.
   * If an administrative Supabase client is available (or testClient is set), processes
   * customer accounts directly against Supabase. Otherwise falls back to local SmartListStore.
   */
  async processTick({ now = new Date(), userId = null, forceToday = false } = {}) {
    try {
      const supabase = this.getSupabaseAdminClient();
      if (supabase) {
        return await this.processTickSupabase({ supabase, now, userId, forceToday });
      }
      return await this.processTickLocal({ now, userId, forceToday });
    } catch (err) {
      console.error('[DailyReportScheduler] Tick error:', err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Production Supabase execution: discovers customer accounts from Supabase, loads settings,
   * evaluates timezone thresholds, and reconciles reports idempotently.
   */
  async processTickSupabase({ supabase, now = new Date(), userId = null, forceToday = false }) {
    let userList = [];

    if (userId) {
      userList = [userId];
    } else {
      const discoveredUserIds = new Set();

      // 1. Discover registered users from auth.admin if available
      try {
        if (supabase.auth && supabase.auth.admin && typeof supabase.auth.admin.listUsers === 'function') {
          const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
          if (authData && Array.isArray(authData.users)) {
            authData.users.forEach(u => {
              if (u && u.id) discoveredUserIds.add(u.id);
            });
          }
        }
      } catch (authErr) {
        console.warn('[DailyReportScheduler] auth.admin.listUsers notice:', authErr.message);
      }

      // 2. Discover accounts with saved routine settings
      try {
        const { data: settingsRows } = await supabase.from('smart_routine_settings').select('user_id');
        if (Array.isArray(settingsRows)) {
          settingsRows.forEach(r => {
            if (r && r.user_id) discoveredUserIds.add(r.user_id);
          });
        }
      } catch (_) {}

      // 3. Discover accounts with existing smart routines
      try {
        const { data: routineRows } = await supabase.from('smart_routines').select('user_id');
        if (Array.isArray(routineRows)) {
          routineRows.forEach(r => {
            if (r && r.user_id) discoveredUserIds.add(r.user_id);
          });
        }
      } catch (_) {}

      // 4. Discover accounts with tasks (todos)
      try {
        const { data: todoRows } = await supabase.from('todos').select('user_id');
        if (Array.isArray(todoRows)) {
          todoRows.forEach(r => {
            if (r && r.user_id) discoveredUserIds.add(r.user_id);
          });
        }
      } catch (_) {}

      userList = Array.from(discoveredUserIds).filter(Boolean);
    }

    const results = [];

    for (const targetUserId of userList) {
      // 1. Load user settings
      let settings = {
        daily_summary_enabled: true,
        daily_summary_time: '22:00',
        timezone: 'UTC'
      };

      try {
        const { data: settingsData } = await supabase
          .from('smart_routine_settings')
          .select('*')
          .eq('user_id', targetUserId)
          .limit(1);

        if (Array.isArray(settingsData) && settingsData[0]) {
          settings = { ...settings, ...settingsData[0] };
        }
      } catch (_) {}

      const isEnabled = settings.daily_summary_enabled !== false && settings.dailySummaryEnabled !== false;
      if (!isEnabled) {
        continue;
      }

      const tz = settings.timezone || 'UTC';
      const targetReportTime = settings.daily_summary_time || settings.dailySummaryTime || '22:00';
      const localYmd = getLocalYmdInTimezone(now, tz);
      const localHm = getLocalTimeInTimezone(now, tz);

      // 2. Fetch routines for this user
      let routines = [];
      try {
        const { data: routineRows } = await supabase
          .from('smart_routines')
          .select('*')
          .eq('user_id', targetUserId);
        if (Array.isArray(routineRows)) {
          routines = routineRows.filter(r => !r.deleted_at && !r.deletedAt);
        }
      } catch (_) {}

      // 3. Fetch existing reports to ensure idempotency (never duplicate or overwrite)
      let existingReports = [];
      try {
        const { data: reportRows } = await supabase
          .from('smart_routine_reports')
          .select('*')
          .eq('user_id', targetUserId)
          .order('date', { ascending: true });
        if (Array.isArray(reportRows)) {
          existingReports = reportRows;
        }
      } catch (_) {}

      const existingDates = new Set(existingReports.map(r => r.date));

      // 4. Determine reconciliation date bounds
      let startDate = localYmd;
      if (existingReports.length > 0) {
        const minReportDate = existingReports[0].date;
        if (minReportDate < startDate) startDate = minReportDate;
      }
      if (routines.length > 0) {
        const minRoutineDate = routines.reduce((earliest, r) => {
          const d = (r.created_at || r.createdAt || '').slice(0, 10);
          return (d && d < earliest) ? d : earliest;
        }, localYmd);
        if (minRoutineDate < startDate) startDate = minRoutineDate;
      }

      // Restrict lookback to reasonable window (e.g. 30 days) to prevent unbounded backfills
      const lookbackLimit = addDays(localYmd, -30);
      if (startDate < lookbackLimit) {
        startDate = lookbackLimit;
      }

      const isPastSummaryTime = localHm >= targetReportTime;
      const maxEndDate = (isPastSummaryTime || forceToday) ? localYmd : addDays(localYmd, -1);

      const userReconciledReports = [];
      let cursor = startDate;

      while (cursor <= maxEndDate) {
        if (!existingDates.has(cursor)) {
          // Fetch completions for this date
          let completions = [];
          try {
            const { data: completionRows } = await supabase
              .from('smart_routine_completions')
              .select('*')
              .eq('user_id', targetUserId)
              .eq('date', cursor);
            if (Array.isArray(completionRows)) {
              completions = completionRows;
            }
          } catch (_) {}

          const compMap = new Map();
          completions.forEach(c => {
            const rId = c.routine_id || c.routineId;
            if (rId) compMap.set(rId, c);
          });

          // Filter eligible routines for date cursor
          const eligibleRoutines = routines.filter(r => {
            const createdYmd = (r.created_at || r.createdAt || '').slice(0, 10);
            if (createdYmd && createdYmd > cursor) {
              const comp = compMap.get(r.id);
              if (!comp) return false;
            }
            const startYmd = r.start_date || r.startDate;
            if (startYmd && toYmdString(startYmd) > cursor) return false;
            const endYmd = r.end_date || r.endDate;
            if (endYmd && toYmdString(endYmd) < cursor) return false;
            return true;
          });

          let totalCount = eligibleRoutines.length;
          let completedRoutines = [];
          let incompleteRoutines = [];
          let cancelledCount = 0;

          eligibleRoutines.forEach(r => {
            const c = compMap.get(r.id);
            const isCompleted = c && (c.completed === true || c.status === 'completed');
            const isCancelled = c && (c.status === 'cancelled' || c.status === 'removed');

            if (isCompleted) {
              completedRoutines.push(r.title);
            } else if (isCancelled) {
              cancelledCount++;
            } else {
              incompleteRoutines.push(r.title);
            }
          });

          const eligibleCount = Math.max(0, totalCount - cancelledCount);
          const completedCount = completedRoutines.length;
          const incompleteCount = incompleteRoutines.length;
          const completionRate = eligibleCount > 0 ? Math.round((completedCount / eligibleCount) * 100) : 0;

          let status = 'Not Started';
          let statusBadge = 'Not Started';

          if (totalCount === 0) {
            status = 'Not Started';
            statusBadge = 'No Routines';
          } else if (eligibleCount > 0 && completedCount === eligibleCount) {
            status = 'Fully Completed';
            statusBadge = 'Exceptional';
          } else if (completionRate >= 80) {
            status = 'Partially Completed';
            statusBadge = 'Great Job';
          } else if (completionRate >= 50) {
            status = 'Partially Completed';
            statusBadge = 'Good Progress';
          } else if (completedCount > 0) {
            status = 'Partially Completed';
            statusBadge = 'Needs Focus';
          } else {
            status = 'Not Started';
            statusBadge = 'Not Started';
          }

          const reportId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
          const reportPayload = {
            id: reportId,
            user_id: targetUserId,
            date: cursor,
            total_routines: totalCount,
            completed_count: completedCount,
            incomplete_count: incompleteCount,
            completion_rate: completionRate,
            status: status,
            status_badge: statusBadge,
            completed_routines: completedRoutines,
            incomplete_routines: incompleteRoutines,
            carry_forward_decision: 'pending',
            created_at: new Date().toISOString()
          };

          try {
            const { error: upsertErr } = await supabase
              .from('smart_routine_reports')
              .upsert(reportPayload, { onConflict: 'user_id,date', ignoreDuplicates: true });

            if (!upsertErr) {
              existingDates.add(cursor);
              userReconciledReports.push(reportPayload);
            }
          } catch (insertErr) {
            console.error(`[DailyReportScheduler] Error upserting report for user ${targetUserId} date ${cursor}:`, insertErr.message);
          }
        }
        cursor = addDays(cursor, 1);
      }

      // Enforce strict 10-day rolling history limit in Supabase (Build 16)
      try {
        const { data: allUserReports } = await supabase
          .from('smart_routine_reports')
          .select('id, date')
          .eq('user_id', targetUserId)
          .order('date', { ascending: false });

        if (Array.isArray(allUserReports) && allUserReports.length > 10) {
          const pruneIds = allUserReports.slice(10).map(r => r.id);
          await supabase
            .from('smart_routine_reports')
            .delete()
            .in('id', pruneIds)
            .eq('user_id', targetUserId);
        }
      } catch (retentionErr) {
        console.warn(`[DailyReportScheduler] Supabase 10-day retention pruning error for user ${targetUserId}:`, retentionErr.message);
      }

      results.push({
        userId: targetUserId,
        reconciledCount: userReconciledReports.length,
        reports: userReconciledReports
      });
    }

    const totalReconciled = results.reduce((acc, r) => acc + (r.reconciledCount || 0), 0);

    return {
      success: true,
      processedUsersCount: userList.length,
      reconciledReports: totalReconciled,
      results
    };
  }

  /**
   * Local development and offline fallback execution using SmartListStore.
   */
  async processTickLocal({ now = new Date(), userId = null, forceToday = false }) {
    const data = await SmartListStore.getAllDataForAudit();
    const allUserIds = new Set([
      ...Object.keys(data.settings || {}),
      ...(data.routines || []).map(r => r.userId || r.user_id).filter(Boolean),
      ...(data.reports || []).map(r => r.userId || r.user_id).filter(Boolean)
    ]);

    if (userId) {
      allUserIds.add(userId);
    }

    const userList = userId ? [userId] : Array.from(allUserIds);
    const results = [];

    for (const targetUserId of userList) {
      const settings = await SmartListStore.getSettings(targetUserId);
      if (settings.dailySummaryEnabled === false) {
        continue;
      }

      const tz = settings.timezone || 'UTC';
      const targetReportTime = settings.dailySummaryTime || '22:00';
      const localYmd = getLocalYmdInTimezone(now, tz);
      const localHm = getLocalTimeInTimezone(now, tz);

      const res = await SmartListStore.reconcileDailyReports(targetUserId, {
        now,
        localDate: localYmd,
        currentTime: localHm,
        timezone: tz,
        reportTime: targetReportTime,
        forceToday
      });

      results.push(res);
      await SmartListStore.enforceHistoryRetention(targetUserId, 10);
    }

    const totalReconciled = results.reduce((acc, r) => acc + (r.reconciledCount || 0), 0);

    return {
      success: true,
      processedUsersCount: userList.length,
      reconciledReports: totalReconciled,
      results
    };
  }

  /**
   * Reconcile a single user's routine reports immediately.
   */
  async reconcileUser(userId, { now = new Date(), forceToday = false } = {}) {
    return this.processTick({ now, userId, forceToday });
  }

  /**
   * Start the periodic background scheduler (Local development only).
   * Automatically disabled in production / Vercel in favor of Vercel Cron.
   */
  start(intervalMs = 60000) {
    if (this.isRunning) return;

    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const isProduction = process.env.NODE_ENV === 'production' || isVercel;

    if (isProduction && process.env.ENABLE_LOCAL_SCHEDULER !== 'true') {
      console.log('[DailyReportScheduler] In-memory scheduler disabled in production/Vercel in favor of Vercel Cron.');
      return;
    }

    this.tickIntervalMs = intervalMs;
    this.isRunning = true;

    // Run first tick after small delay
    setTimeout(() => {
      if (this.isRunning) {
        this.processTick().catch(() => {});
      }
    }, 1000);

    this.intervalId = setInterval(() => {
      this.processTick().catch(() => {});
    }, this.tickIntervalMs);

    if (this.intervalId && typeof this.intervalId.unref === 'function') {
      this.intervalId.unref();
    }
  }

  /**
   * Stop the periodic background scheduler.
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }
}

const schedulerInstance = new DailyReportScheduler();

module.exports = schedulerInstance;
