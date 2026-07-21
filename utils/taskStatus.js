// utils/taskStatus.js - Enhanced with proper cleanup
const crypto = require('crypto');

const tasks = new Map();

// Optional: Map userId → array of taskIds for faster lookup
tasks.userMap = new Map();

const taskStatus = {
  // Create a new task
  create(userId, type, metadata = {}) {
    const taskId = crypto.randomBytes(8).toString('hex');
    const task = {
      id: taskId,
      userId,
      type,
      state: 'pending',
      progress: 0,
      currentStep: 0,
      totalSteps: 0,
      message: 'Initializing...',
      metadata,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    tasks.set(taskId, task);
    
    // Maintain user index
    if (!tasks.userMap.has(userId)) {
      tasks.userMap.set(userId, []);
    }
    tasks.userMap.get(userId).push(taskId);
    
    return task;
  },
  
  // Start a task with total steps
  start(taskId, totalSteps = 1, message = 'Starting...') {
    const task = tasks.get(taskId);
    if (task) {
      task.state = 'running';
      task.totalSteps = totalSteps;
      task.message = message;
      task.updatedAt = new Date();
    }
    return task;
  },
  
  // Update task progress
  update(taskId, updates) {
    const task = tasks.get(taskId);
    if (task) {
      Object.assign(task, updates);
      task.updatedAt = new Date();
    }
    return task;
  },
  
  // Complete a task
  complete(taskId, result = {}, message = 'Complete!') {
    const task = tasks.get(taskId);
    if (task) {
      task.state = 'completed';
      task.progress = 100;
      task.currentStep = task.totalSteps || 1;
      task.message = message;
      task.result = result;
      task.completedAt = new Date();
      task.updatedAt = new Date();
    }
    return task;
  },
  
  // Mark task as failed
  fail(taskId, error, message = 'Failed') {
    const task = tasks.get(taskId);
    if (task) {
      task.state = 'failed';
      task.error = error?.message || String(error);
      task.message = message;
      task.failedAt = new Date();
      task.updatedAt = new Date();
    }
    return task;
  },
  
  // Get task by ID
  get(taskId) {
    return tasks.get(taskId);
  },
  
  // Get all tasks for a user (latest first)
  getUserTasks(userId, options = {}) {
    if (!tasks.userMap || !tasks.userMap.has(userId)) {
      return [];
    }
    
    const taskIds = tasks.userMap.get(userId);
    let userTasks = taskIds
      .map(id => tasks.get(id))
      .filter(Boolean);
    
    // Sort by updatedAt descending (most recent first)
    userTasks.sort((a, b) => b.updatedAt - a.updatedAt);
    
    if (options.activeOnly) {
      userTasks = userTasks.filter(task => task.state === 'running');
    }
    
    if (options.limit) {
      userTasks = userTasks.slice(0, options.limit);
    }
    
    return userTasks;
  },
  
  // Clear all tasks for a specific user
  clearUserTasks(userId) {
    if (!tasks.userMap || !tasks.userMap.has(userId)) return 0;

    const taskIds = tasks.userMap.get(userId);
    let cleared = 0;

    taskIds.forEach(id => {
      if (tasks.delete(id)) cleared++;
    });

    tasks.userMap.delete(userId);
    return cleared;
  },
  
  // Get all tasks (for debugging/admin)
  getAll() {
    return Array.from(tasks.values());
  },
  
  // Clear ALL tasks (use carefully!)
  clear() {
    tasks.clear();
    tasks.userMap.clear();
    return true;
  },

  /**
   * Clean up old completed/failed/cancelled tasks
   * @param {number} maxAgeMs - Max age in milliseconds (default: 24 hours)
   * @returns {number} Number of tasks cleaned
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000) { // 24 hours default
    const now = Date.now();
    let cleanedCount = 0;

    for (const [taskId, task] of tasks.entries()) {
      const finishedStates = ['completed', 'failed', 'cancelled'];
      const isFinished = finishedStates.includes(task.state);
      const completionTime = task.completedAt || task.failedAt || task.updatedAt;
      const isOld = completionTime && (now - new Date(completionTime).getTime()) > maxAgeMs;

      if (isFinished && isOld) {
        tasks.delete(taskId);
        cleanedCount++;

        // Also remove from userMap
        if (tasks.userMap.has(task.userId)) {
          const userTaskIds = tasks.userMap.get(task.userId);
          const index = userTaskIds.indexOf(taskId);
          if (index !== -1) {
            userTaskIds.splice(index, 1);
            if (userTaskIds.length === 0) {
              tasks.userMap.delete(task.userId);
            }
          }
        }
      }
    }

    return cleanedCount;
  }
};

module.exports = taskStatus;