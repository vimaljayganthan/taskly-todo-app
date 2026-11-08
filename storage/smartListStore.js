const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
function getDataFile() {
  return process.env.SMART_LISTS_DATA_FILE || path.join(DATA_DIR, 'smart_lists.json');
}

let inMemoryData = null;

async function ensureDataLoaded() {
  if (inMemoryData !== null) return inMemoryData;

  const filePath = getDataFile();
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    inMemoryData = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      inMemoryData = {
        routines: [],
        completions: [],
        reports: [],
        settings: {}
      };
      await persistData();
    } else {
      console.warn('[SmartListStore] Read error, starting empty:', err.message);
      inMemoryData = { routines: [], completions: [], reports: [], settings: {} };
    }
  }
  return inMemoryData;
}

async function persistData() {
  if (!inMemoryData) return;
  const filePath = getDataFile();
  try {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, JSON.stringify(inMemoryData, null, 2), 'utf8');
  } catch (err) {
    console.error('[SmartListStore] Persist error:', err.message);
  }
}

const SmartListStore = {
  async getRoutines(userId) {
    const data = await ensureDataLoaded();
    return (data.routines || [])
      .filter(r => r.userId === userId && !r.deletedAt)
      .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0) || new Date(a.createdAt) - new Date(b.createdAt));
  },

  async addRoutine(userId, { title, orderIndex = 0 }) {
    const data = await ensureDataLoaded();
    const newRoutine = {
      id: crypto.randomUUID(),
      userId,
      user_id: userId,
      title: title.trim(),
      orderIndex: Number(orderIndex) || 0,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      deletedAt: null
    };
    data.routines.push(newRoutine);
    await persistData();
    return newRoutine;
  },

  async updateRoutine(userId, routineId, updates) {
    const data = await ensureDataLoaded();
    const routine = data.routines.find(r => r.id === routineId && r.userId === userId && !r.deletedAt);
    if (!routine) return null;

    if (typeof updates.title === 'string' && updates.title.trim()) {
      routine.title = updates.title.trim();
    }
    if (typeof updates.orderIndex === 'number') {
      routine.orderIndex = updates.orderIndex;
    }
    routine.updatedAt = new Date().toISOString();
    await persistData();
    return routine;
  },

  async deleteRoutine(userId, routineId) {
    const data = await ensureDataLoaded();
    const idx = data.routines.findIndex(r => r.id === routineId && r.userId === userId);
    if (idx === -1) return false;

    // Hard delete from routine list so it no longer appears in future days
    // Historical reports remain unaffected because reports store snapshots
    data.routines.splice(idx, 1);
    await persistData();
    return true;
  },

  async getCompletions(userId, date) {
    const data = await ensureDataLoaded();
    return (data.completions || []).filter(c => c.userId === userId && c.date === date);
  },

  async setCompletion(userId, { routineId, date, completed, carriedForward = false }) {
    const data = await ensureDataLoaded();
    let record = data.completions.find(c => c.userId === userId && c.routineId === routineId && c.date === date);

    if (record) {
      record.completed = Boolean(completed);
      record.completedAt = completed ? new Date().toISOString() : null;
      if (typeof carriedForward === 'boolean') {
        record.carriedForward = carriedForward;
      }
    } else {
      record = {
        id: crypto.randomUUID(),
        userId,
        user_id: userId,
        routineId,
        date,
        completed: Boolean(completed),
        completedAt: completed ? new Date().toISOString() : null,
        carriedForward: Boolean(carriedForward),
        createdAt: new Date().toISOString()
      };
      data.completions.push(record);
    }

    await persistData();
    return record;
  },

  async getReports(userId) {
    const data = await ensureDataLoaded();
    return (data.reports || [])
      .filter(r => r.userId === userId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },

  async getReport(userId, date) {
    const data = await ensureDataLoaded();
    return data.reports.find(r => r.userId === userId && r.date === date) || null;
  },

  async saveReport(userId, reportData) {
    const data = await ensureDataLoaded();
    const date = reportData.date;
    const existingIndex = data.reports.findIndex(r => r.userId === userId && r.date === date);

    let completedRoutines = reportData.completedRoutines;
    if (typeof completedRoutines === 'string') {
      try { completedRoutines = JSON.parse(completedRoutines); } catch (_) { completedRoutines = []; }
    }
    if (!Array.isArray(completedRoutines)) {
      completedRoutines = Array.isArray(reportData.completedList)
        ? reportData.completedList
        : (Array.isArray(reportData.completed_routines) ? reportData.completed_routines : []);
    }
    completedRoutines = completedRoutines.map(t => (typeof t === 'string' ? t.trim() : (t?.title ? String(t.title).trim() : ''))).filter(Boolean);

    let incompleteRoutines = reportData.incompleteRoutines;
    if (typeof incompleteRoutines === 'string') {
      try { incompleteRoutines = JSON.parse(incompleteRoutines); } catch (_) { incompleteRoutines = []; }
    }
    if (!Array.isArray(incompleteRoutines)) {
      incompleteRoutines = Array.isArray(reportData.incompleteList)
        ? reportData.incompleteList
        : (Array.isArray(reportData.incomplete_routines) ? reportData.incomplete_routines : []);
    }
    incompleteRoutines = incompleteRoutines.map(t => (typeof t === 'string' ? t.trim() : (t?.title ? String(t.title).trim() : ''))).filter(Boolean);

    const completedCount = completedRoutines.length;
    const incompleteCount = incompleteRoutines.length;
    const totalRoutines = completedCount + incompleteCount;
    const completionRate = totalRoutines > 0 ? Math.round((completedCount / totalRoutines) * 100) : 0;

    let status = reportData.status || 'Not Started';
    let statusBadge = reportData.statusBadge || 'Not Started';
    if (totalRoutines > 0 && completedCount === totalRoutines) {
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
    }

    let closingStatement = reportData.closingStatement;
    if (!closingStatement) {
      if (totalRoutines === 0) {
        closingStatement = 'No routines scheduled for this date.';
      } else if (completedCount === totalRoutines) {
        closingStatement = 'Outstanding work! You completed 100% of your daily routines today. All objectives achieved!';
      } else if (completionRate >= 80) {
        closingStatement = `Great job! You achieved ${completionRate}% routine completion today. Keep up the strong consistency tomorrow!`;
      } else if (completionRate >= 50) {
        closingStatement = `Good progress! You reached ${completionRate}% routine completion today. Stay focused to close out the remaining routines!`;
      } else if (completedCount > 0) {
        closingStatement = `Some routines completed today (${completionRate}%). Keep pushing forward tomorrow to build momentum!`;
      } else {
        closingStatement = 'No routines were completed today. Tomorrow is a fresh opportunity to start strong!';
      }
    }

    const report = {
      id: reportData.id || crypto.randomUUID(),
      userId,
      user_id: userId,
      date,
      totalRoutines,
      completedCount,
      incompleteCount,
      completionRate,
      status,
      statusBadge,
      closingStatement,
      completedRoutines,
      incompleteRoutines,
      completedList: completedRoutines,
      incompleteList: incompleteRoutines,
      routinesSnapshot: Array.isArray(reportData.routinesSnapshot) ? reportData.routinesSnapshot : [],
      carryForwardDecision: reportData.carryForwardDecision || 'pending',
      createdAt: existingIndex !== -1 ? data.reports[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex !== -1) {
      data.reports[existingIndex] = report;
    } else {
      data.reports.push(report);
    }

    await persistData();
    return report;
  },

  async deleteReport(userId, reportId) {
    const data = await ensureDataLoaded();
    const idx = data.reports.findIndex(r => (r.id === reportId || r.date === reportId) && r.userId === userId);
    if (idx === -1) return false;
    data.reports.splice(idx, 1);
    await persistData();
    return true;
  },

  async getSettings(userId) {
    const data = await ensureDataLoaded();
    return (data.settings && data.settings[userId]) || {
      dailySummaryEnabled: true,
      dailySummaryTime: '22:00'
    };
  },

  async saveSettings(userId, settings) {
    const data = await ensureDataLoaded();
    if (!data.settings) data.settings = {};
    const existing = data.settings[userId] || { dailySummaryEnabled: true, dailySummaryTime: '22:00' };

    data.settings[userId] = {
      dailySummaryEnabled: typeof settings.dailySummaryEnabled === 'boolean' 
        ? settings.dailySummaryEnabled 
        : existing.dailySummaryEnabled,
      dailySummaryTime: typeof settings.dailySummaryTime === 'string' && settings.dailySummaryTime.trim()
        ? settings.dailySummaryTime.trim()
        : existing.dailySummaryTime,
      updatedAt: new Date().toISOString()
    };

    await persistData();
    return data.settings[userId];
  },

  // Test helper
  __resetForTests() {
    inMemoryData = {
      routines: [],
      completions: [],
      reports: [],
      settings: {}
    };
  }
};

module.exports = SmartListStore;

