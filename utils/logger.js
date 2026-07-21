/**
 * Logger Utility
 * Structured logging with levels, file output, and rotation
 * @version 2.0.0
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

// Configuration
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

const LOG_COLORS = {
  error: '\x1b[31m', // Red
  warn: '\x1b[33m',  // Yellow
  info: '\x1b[36m',  // Cyan
  http: '\x1b[35m',  // Magenta
  debug: '\x1b[32m', // Green
  reset: '\x1b[0m'
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug');
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const ENABLE_FILE_LOGGING = process.env.ENABLE_FILE_LOGGING === 'true' || IS_PRODUCTION;

// Ensure log directory exists
if (ENABLE_FILE_LOGGING && !fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Current log file stream
let currentLogFile = null;
let currentLogSize = 0;

/**
 * Get current log file path
 */
function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `app-${date}.log`);
}

/**
 * Rotate log files
 */
function rotateLogFiles() {
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('app-') && f.endsWith('.log'))
    .sort()
    .reverse();

  // Remove old files
  while (files.length >= MAX_FILES) {
    const oldFile = files.pop();
    try {
      fs.unlinkSync(path.join(LOG_DIR, oldFile));
    } catch (err) {
      // Ignore
    }
  }
}

/**
 * Get or create log file stream
 */
function getLogStream() {
  if (!ENABLE_FILE_LOGGING) return null;

  const filePath = getLogFilePath();

  // Check if we need a new file
  if (currentLogFile) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size >= MAX_FILE_SIZE) {
        currentLogFile.end();
        currentLogFile = null;
        rotateLogFiles();
      }
    } catch (err) {
      // File doesn't exist, create new
      currentLogFile = null;
    }
  }

  if (!currentLogFile) {
    rotateLogFiles();
    currentLogFile = fs.createWriteStream(filePath, { flags: 'a' });
    currentLogSize = 0;
  }

  return currentLogFile;
}

/**
 * Format log entry
 */
function formatLogEntry(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const pid = process.pid;

  // Structured JSON for production
  if (IS_PRODUCTION) {
    return JSON.stringify({
      timestamp,
      level,
      pid,
      message,
      ...meta
    });
  }

  // Pretty format for development
  const color = LOG_COLORS[level] || LOG_COLORS.reset;
  const reset = LOG_COLORS.reset;
  const metaStr = Object.keys(meta).length ? ` ${util.inspect(meta, { depth: 2, colors: true })}` : '';

  return `${color}[${timestamp}] [${level.toUpperCase()}]${reset} ${message}${metaStr}`;
}

/**
 * Check if level should be logged
 */
function shouldLog(level) {
  return LOG_LEVELS[level] <= LOG_LEVELS[LOG_LEVEL];
}

/**
 * Write log entry
 */
function writeLog(level, message, meta = {}) {
  if (!shouldLog(level)) return;

  const formatted = formatLogEntry(level, message, meta);

  // Console output
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  // File output
  const stream = getLogStream();
  if (stream) {
    const fileEntry = IS_PRODUCTION
      ? formatted
      : formatLogEntry(level, message, meta).replace(/\x1b\[\d+m/g, ''); // Strip colors
    stream.write(fileEntry + '\n');
  }
}

/**
 * Parse arguments
 */
function parseArgs(args) {
  if (args.length === 0) return { message: '', meta: {} };
  if (args.length === 1) {
    if (typeof args[0] === 'string') {
      return { message: args[0], meta: {} };
    }
    return { message: '', meta: args[0] };
  }

  const [message, ...rest] = args;
  const meta = rest.reduce((acc, item) => {
    if (typeof item === 'object' && item !== null) {
      return { ...acc, ...item };
    }
    return acc;
  }, {});

  return { message: String(message), meta };
}

const logger = {
  // Log levels
  LEVELS: LOG_LEVELS,

  /**
   * Error level
   */
  error(...args) {
    const { message, meta } = parseArgs(args);
    writeLog('error', message, meta);
  },

  /**
   * Warning level
   */
  warn(...args) {
    const { message, meta } = parseArgs(args);
    writeLog('warn', message, meta);
  },

  /**
   * Info level
   */
  info(...args) {
    const { message, meta } = parseArgs(args);
    writeLog('info', message, meta);
  },

  /**
   * HTTP level
   */
  http(...args) {
    const { message, meta } = parseArgs(args);
    writeLog('http', message, meta);
  },

  /**
   * Debug level
   */
  debug(...args) {
    const { message, meta } = parseArgs(args);
    writeLog('debug', message, meta);
  },

  /**
   * Log with custom level
   */
  log(level, ...args) {
    if (!LOG_LEVELS.hasOwnProperty(level)) {
      level = 'info';
    }
    const { message, meta } = parseArgs(args);
    writeLog(level, message, meta);
  },

  /**
   * Create child logger with default meta
   */
  child(defaultMeta = {}) {
    return {
      error: (...args) => {
        const { message, meta } = parseArgs(args);
        writeLog('error', message, { ...defaultMeta, ...meta });
      },
      warn: (...args) => {
        const { message, meta } = parseArgs(args);
        writeLog('warn', message, { ...defaultMeta, ...meta });
      },
      info: (...args) => {
        const { message, meta } = parseArgs(args);
        writeLog('info', message, { ...defaultMeta, ...meta });
      },
      http: (...args) => {
        const { message, meta } = parseArgs(args);
        writeLog('http', message, { ...defaultMeta, ...meta });
      },
      debug: (...args) => {
        const { message, meta } = parseArgs(args);
        writeLog('debug', message, { ...defaultMeta, ...meta });
      }
    };
  },

  /**
   * Create Express middleware
   */
  createMiddleware() {
    return (req, res, next) => {
      const start = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 400 ? 'warn' : 'http';

        writeLog(level, `${req.method} ${req.originalUrl}`, {
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
          userAgent: req.get('user-agent')
        });
      });

      next();
    };
  },

  /**
   * Time a function
   */
  async time(label, fn) {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.debug(`${label} completed`, { duration: `${duration}ms` });
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      this.error(`${label} failed`, { duration: `${duration}ms`, error: err.message });
      throw err;
    }
  },

  /**
   * Get log file contents
   */
  getLogContents(lines = 100) {
    if (!ENABLE_FILE_LOGGING) return [];

    const filePath = getLogFilePath();
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    return allLines.slice(-lines);
  },

  /**
   * Clear log file
   */
  clearLogs() {
    if (currentLogFile) {
      currentLogFile.end();
      currentLogFile = null;
    }

    if (ENABLE_FILE_LOGGING) {
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('app-') && f.endsWith('.log'));

      files.forEach(f => {
        try {
          fs.unlinkSync(path.join(LOG_DIR, f));
        } catch (err) {
          // Ignore
        }
      });
    }

    this.info('Logs cleared');
  },

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      level: LOG_LEVEL,
      fileLogging: ENABLE_FILE_LOGGING,
      logDir: LOG_DIR,
      maxFileSize: MAX_FILE_SIZE,
      maxFiles: MAX_FILES,
      isProduction: IS_PRODUCTION
    };
  }
};

module.exports = logger;