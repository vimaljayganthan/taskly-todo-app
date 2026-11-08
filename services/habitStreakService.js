/**
 * Habit Streak & Consistency Calculation Engine (Taskly v2.0.0 Build 11)
 *
 * Core Business Logic:
 * 1. 4-State Routine Model: 'completed', 'pending', 'postponed', 'cancelled'.
 * 2. 80% Daily Qualifying Rule:
 *    - Cancelled routines are excluded from eligible denominator.
 *    - Postponed routines remain incomplete on their original date.
 *    - Pending routines remain incomplete.
 *    - Qualifying day: eligibleCount > 0 AND (completedCount / eligibleCount) >= 0.80.
 *    - Days with 0 eligible routines do NOT qualify.
 * 3. Contiguous Streak Calculations: Current Streak and Longest (Best) Streak.
 * 4. Weekly and Monthly Consistency Metrics.
 * 5. Strict Date & Timezone Integrity using calendar YYYY-MM-DD representations.
 */

const VALID_STATUSES = ['completed', 'pending', 'postponed', 'cancelled'];

class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = status;
  }
}

// ==============================================================================
// 1. Date Helpers (Calendar Day Integrity, Timezone Offset Independent)
// ==============================================================================

function toYmdString(dateInput) {
  if (!dateInput) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof dateInput === 'string') {
    // If already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
    // Extract first 10 chars if ISO string
    if (dateInput.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
      return dateInput.slice(0, 10);
    }
  }
  const dateObj = new Date(dateInput);
  if (isNaN(dateObj.getTime())) {
    throw new ValidationError(`Invalid date provided: ${dateInput}`);
  }
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYmd(ymdStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdStr)) {
    throw new ValidationError(`Invalid YYYY-MM-DD date format: ${ymdStr}`);
  }
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(ymdStr, days) {
  const dt = parseYmd(ymdStr);
  dt.setDate(dt.getDate() + Number(days));
  return toYmdString(dt);
}

function diffDays(ymdA, ymdB) {
  const dtA = parseYmd(ymdA);
  const dtB = parseYmd(ymdB);
  const diffTime = dtA.getTime() - dtB.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

// ==============================================================================
// 2. Status Validation & State Transition Machine
// ==============================================================================

function validateStatusTransition(currentStatus, newStatus, options = {}) {
  const { date, postponedTo, cancellationReason } = options;

  if (!newStatus || typeof newStatus !== 'string') {
    throw new ValidationError('Routine status must be a non-empty string');
  }

  const normalized = newStatus.trim().toLowerCase();
  if (!VALID_STATUSES.includes(normalized)) {
    throw new ValidationError(`Invalid status "${newStatus}". Allowed values: ${VALID_STATUSES.join(', ')}`);
  }

  if (normalized === 'postponed') {
    if (!postponedTo || typeof postponedTo !== 'string') {
      throw new ValidationError('Target date "postponedTo" (YYYY-MM-DD) is required when postponing a routine');
    }
    const cleanPostponedTo = toYmdString(postponedTo);
    const originDate = toYmdString(date || new Date());
    if (cleanPostponedTo <= originDate) {
      throw new ValidationError(`Postponed target date "${cleanPostponedTo}" must be strictly after the original routine date "${originDate}"`);
    }
  }

  if (normalized === 'cancelled' && cancellationReason !== undefined && cancellationReason !== null) {
    if (typeof cancellationReason !== 'string') {
      throw new ValidationError('Cancellation reason must be a string');
    }
    if (cancellationReason.trim().length > 100) {
      throw new ValidationError('Cancellation reason must not exceed 100 characters');
    }
  }

  return {
    valid: true,
    normalizedStatus: normalized,
    postponedTo: normalized === 'postponed' ? toYmdString(postponedTo) : null,
    cancellationReason: normalized === 'cancelled' && cancellationReason ? cancellationReason.trim() : null
  };
}

// ==============================================================================
// 3. Daily Statistics & Qualifying Rule (80% Rule)
// ==============================================================================

function calculateDayStatistics({ routines = [], completions = [], date, resetAt = null }) {
  const targetDate = toYmdString(date);

  // Map completions by routineId for this date
  const compMap = new Map();
  completions.forEach(c => {
    if (toYmdString(c.date) === targetDate) {
      compMap.set(c.routineId, c);
    }
  });

  let completedCount = 0;
  let pendingCount = 0;
  let postponedCount = 0;
  let cancelledCount = 0;

  const routineBreakdown = routines
    .map(r => {
      const comp = compMap.get(r.id);
      // Skip occurrences explicitly removed from a specific date (e.g. removed from tomorrow only)
      if (comp && (comp.status === 'removed' || comp.removed === true)) {
        return null;
      }

      let status = 'pending';
      let postponedTo = null;
      let cancellationReason = null;
      let completedAt = null;

      if (comp) {
        if (comp.status && VALID_STATUSES.includes(comp.status)) {
          status = comp.status;
        } else if (comp.completed === true) {
          status = 'completed';
        } else if (comp.completed === false) {
          status = 'pending';
        }
        postponedTo = comp.postponedTo || comp.postponed_to || null;
        cancellationReason = comp.cancellationReason || comp.cancellation_reason || null;
        completedAt = comp.completedAt || comp.completed_at || null;
      }

      // If a streak reset occurred, completions prior to or at the reset timestamp are treated as pending
      if (resetAt && status === 'completed') {
        const updateTime = comp?.completedAt || comp?.completed_at || comp?.updatedAt || comp?.updated_at;
        if (!updateTime || new Date(updateTime).getTime() <= new Date(resetAt).getTime()) {
          status = 'pending';
        }
      }

      if (status === 'completed') completedCount++;
      else if (status === 'postponed') postponedCount++;
      else if (status === 'cancelled') cancelledCount++;
      else pendingCount++;

      return {
        routineId: r.id,
        title: r.title,
        status,
        postponedTo,
        cancellationReason,
        completedAt,
        isCompleted: status === 'completed',
        isPending: status === 'pending',
        isPostponed: status === 'postponed',
        isCancelled: status === 'cancelled',
        carriedForward: Boolean(comp?.carriedForward || comp?.carried_forward)
      };
    })
    .filter(Boolean);

  const totalCount = completedCount + pendingCount + postponedCount + cancelledCount;
  // Cancelled routines are strictly excluded from the eligible denominator:
  const eligibleCount = totalCount - cancelledCount;

  // Completion rate is based strictly on eligible routines:
  const completionRate = eligibleCount > 0
    ? Math.round((completedCount / eligibleCount) * 100)
    : 0;

  // 80% Threshold Qualifying Rule:
  // Days with 0 eligible routines DO NOT qualify for a streak.
  const isQualified = (eligibleCount > 0) && (completionRate >= 80);

  return {
    date: targetDate,
    totalCount,
    completedCount,
    pendingCount,
    postponedCount,
    cancelledCount,
    eligibleCount,
    completionRate,
    isQualified,
    qualifyingThreshold: 80,
    routines: routineBreakdown
  };
}

// ==============================================================================
// 4. Streak Calculation Engine (Current & Longest Streaks)
// ==============================================================================

function calculateStreaks({ routines = [], completions = [], refDate = new Date(), resetAt = null }) {
  const todayStr = toYmdString(refDate);
  const yesterdayStr = addDays(todayStr, -1);
  const resetDateStr = resetAt ? toYmdString(resetAt) : null;

  if (!Array.isArray(routines) || routines.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      todayQualified: false,
      yesterdayQualified: false,
      lastQualifiedDate: null
    };
  }

  // 1. Group completions by date (filtering out dates before resetDateStr if resetAt is provided)
  const dateCompletionsMap = new Map();
  completions.forEach(c => {
    if (!c || !c.date) return;
    const dStr = toYmdString(c.date);
    if (resetDateStr && dStr < resetDateStr) return; // Ignore records prior to reset date
    if (!dateCompletionsMap.has(dStr)) {
      dateCompletionsMap.set(dStr, []);
    }
    dateCompletionsMap.get(dStr).push(c);
  });

  // Collect historical dates starting from reset point + today & yesterday
  const uniqueDates = new Set();
  dateCompletionsMap.forEach((_, dStr) => {
    if (!resetDateStr || dStr >= resetDateStr) {
      uniqueDates.add(dStr);
    }
  });

  if (!resetDateStr || todayStr >= resetDateStr) uniqueDates.add(todayStr);
  if (!resetDateStr || yesterdayStr >= resetDateStr) uniqueDates.add(yesterdayStr);

  const dayStatsMap = new Map();
  uniqueDates.forEach(dStr => {
    const dayComps = dateCompletionsMap.get(dStr) || [];
    const stats = calculateDayStatistics({
      routines,
      completions: dayComps,
      date: dStr,
      resetAt
    });
    dayStatsMap.set(dStr, stats);
  });

  const todayStats = dayStatsMap.get(todayStr);
  const yesterdayStats = (!resetDateStr || yesterdayStr >= resetDateStr) ? dayStatsMap.get(yesterdayStr) : null;

  // 2. Current Streak calculation:
  // If today is qualified: count today and walk backwards consecutively.
  // If today is NOT qualified:
  //   - If yesterday was qualified, today is still in progress (preserved waiting for today's habits).
  //   - If yesterday was NOT qualified, current streak is 0.
  let currentStreak = 0;
  if (todayStats && todayStats.isQualified) {
    let checkDate = todayStr;
    while (true) {
      if (resetDateStr && checkDate < resetDateStr) break;
      const stats = dayStatsMap.get(checkDate) || calculateDayStatistics({
        routines,
        completions: dateCompletionsMap.get(checkDate) || [],
        date: checkDate,
        resetAt
      });
      if (stats.isQualified) {
        currentStreak++;
        checkDate = addDays(checkDate, -1);
      } else {
        break;
      }
    }
  } else if (yesterdayStats && yesterdayStats.isQualified) {
    let checkDate = yesterdayStr;
    while (true) {
      if (resetDateStr && checkDate < resetDateStr) break;
      const stats = dayStatsMap.get(checkDate) || calculateDayStatistics({
        routines,
        completions: dateCompletionsMap.get(checkDate) || [],
        date: checkDate,
        resetAt
      });
      if (stats.isQualified) {
        currentStreak++;
        checkDate = addDays(checkDate, -1);
      } else {
        break;
      }
    }
  }

  // 3. Longest (Best) Historical Streak:
  // Sort unique dates chronologically
  const sortedDates = Array.from(uniqueDates).sort();
  let longestStreak = 0;
  let runningStreak = 0;
  let prevQualifiedDate = null;
  let lastQualifiedDate = null;

  sortedDates.forEach(dStr => {
    const stats = dayStatsMap.get(dStr);
    if (stats && stats.isQualified) {
      lastQualifiedDate = dStr;
      if (!prevQualifiedDate) {
        runningStreak = 1;
      } else {
        const gap = diffDays(dStr, prevQualifiedDate);
        if (gap === 1) {
          runningStreak++;
        } else if (gap > 1) {
          runningStreak = 1;
        }
      }
      prevQualifiedDate = dStr;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else {
      runningStreak = 0;
      prevQualifiedDate = null;
    }
  });

  // Longest streak is at least the current streak
  longestStreak = Math.max(longestStreak, currentStreak);

  return {
    currentStreak,
    longestStreak,
    todayQualified: Boolean(todayStats?.isQualified),
    yesterdayQualified: Boolean(yesterdayStats?.isQualified),
    lastQualifiedDate
  };
}

// ==============================================================================
// 5. Consistency Metrics (Weekly & Monthly)
// ==============================================================================

function calculateConsistency({ routines = [], completions = [], date = new Date(), resetAt = null }) {
  const refDateStr = toYmdString(date);
  const refDt = parseYmd(refDateStr);
  const resetDateStr = resetAt ? toYmdString(resetAt) : null;

  // 1. Weekly Consistency (Monday to Sunday)
  const dayOfWeek = refDt.getDay(); // 0 is Sun, 1 is Mon
  const monOffset = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
  const mondayDt = new Date(refDt);
  mondayDt.setDate(refDt.getDate() - monOffset);
  const mondayStr = toYmdString(mondayDt);
  const sundayStr = addDays(mondayStr, 6);

  let weekQualifyingDays = 0;
  let weekEligibleDays = 0;
  let weekDaysEvaluated = 0;

  for (let i = 0; i < 7; i++) {
    const curDateStr = addDays(mondayStr, i);
    // Only evaluate up to today/reference date to avoid future bias
    // And if streak was reset, only evaluate from reset date onwards
    if (curDateStr <= refDateStr && (!resetDateStr || curDateStr >= resetDateStr)) {
      weekDaysEvaluated++;
      const stats = calculateDayStatistics({
        routines,
        completions: completions.filter(c => toYmdString(c.date) === curDateStr),
        date: curDateStr,
        resetAt
      });
      if (stats.eligibleCount > 0) weekEligibleDays++;
      if (stats.isQualified) weekQualifyingDays++;
    }
  }

  const weeklyConsistency = weekDaysEvaluated > 0
    ? Math.round((weekQualifyingDays / weekDaysEvaluated) * 100)
    : 0;

  // 2. Monthly Consistency (1st of month to reference date)
  const y = refDt.getFullYear();
  const m = String(refDt.getMonth() + 1).padStart(2, '0');
  const monthStartStr = `${y}-${m}-01`;
  const yearMonth = `${y}-${m}`;

  let monthQualifyingDays = 0;
  let monthEligibleDays = 0;
  let monthDaysEvaluated = 0;

  let scanDate = monthStartStr;
  while (scanDate <= refDateStr) {
    if (!resetDateStr || scanDate >= resetDateStr) {
      monthDaysEvaluated++;
      const stats = calculateDayStatistics({
        routines,
        completions: completions.filter(c => toYmdString(c.date) === scanDate),
        date: scanDate,
        resetAt
      });
      if (stats.eligibleCount > 0) monthEligibleDays++;
      if (stats.isQualified) monthQualifyingDays++;
    }
    scanDate = addDays(scanDate, 1);
  }

  const monthlyConsistency = monthDaysEvaluated > 0
    ? Math.round((monthQualifyingDays / monthDaysEvaluated) * 100)
    : 0;

  const weekResult = {
    startDate: mondayStr,
    endDate: sundayStr,
    evaluatedUntil: refDateStr,
    qualifyingDays: weekQualifyingDays,
    eligibleDays: weekEligibleDays,
    totalDays: weekDaysEvaluated,
    consistencyPercent: weeklyConsistency,
    percentage: weeklyConsistency
  };

  const monthResult = {
    yearMonth,
    startDate: monthStartStr,
    evaluatedUntil: refDateStr,
    qualifyingDays: monthQualifyingDays,
    eligibleDays: monthEligibleDays,
    totalDays: monthDaysEvaluated,
    consistencyPercent: monthlyConsistency,
    percentage: monthlyConsistency
  };

  return {
    week: weekResult,
    weekly: weekResult,
    month: monthResult,
    monthly: monthResult
  };
}

// ==============================================================================
// 6. Historical Performance Breakdown
// ==============================================================================

function getHistoricalPerformance({ routines = [], completions = [], startDate, endDate, limit = 30 }) {
  const endStr = endDate ? toYmdString(endDate) : toYmdString(new Date());
  const startStr = startDate ? toYmdString(startDate) : addDays(endStr, -(Number(limit) - 1));

  const days = [];
  let cur = startStr;
  while (cur <= endStr) {
    const dayStats = calculateDayStatistics({
      routines,
      completions: completions.filter(c => toYmdString(c.date) === cur),
      date: cur
    });
    days.push(dayStats);
    cur = addDays(cur, 1);
  }

  // Routine-specific aggregated performance
  const routineStats = routines.map(r => {
    let completed = 0;
    let pending = 0;
    let postponed = 0;
    let cancelled = 0;

    days.forEach(d => {
      const found = d.routines.find(item => item.routineId === r.id);
      if (found) {
        if (found.status === 'completed') completed++;
        else if (found.status === 'postponed') postponed++;
        else if (found.status === 'cancelled') cancelled++;
        else pending++;
      } else {
        pending++;
      }
    });

    const activeDays = completed + pending + postponed;
    const rate = activeDays > 0 ? Math.round((completed / activeDays) * 100) : 0;

    return {
      routineId: r.id,
      title: r.title,
      completedCount: completed,
      pendingCount: pending,
      postponedCount: postponed,
      cancelledCount: cancelled,
      completionRate: rate
    };
  });

  return {
    startDate: startStr,
    endDate: endStr,
    totalDays: days.length,
    days,
    routines: routineStats
  };
}

module.exports = {
  VALID_STATUSES,
  ValidationError,
  toYmdString,
  parseYmd,
  addDays,
  diffDays,
  validateStatusTransition,
  calculateDayStatistics,
  calculateStreaks,
  calculateConsistency,
  getHistoricalPerformance
};

