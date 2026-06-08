'use strict';

const path = require('path');
const { promises: fs } = require('fs');
const { ConfigMissingError } = require('./errors');
const { sanitizeForFilename } = require('../models/job');

/**
 * Read all .md files from a jobs directory.
 *
 * Returns an empty array if the directory is missing or empty.
 * Ignores non-markdown files.
 *
 * @param {string} jobsDir - Path to the jobs directory.
 * @returns {Promise<{ filename: string, content: string }[]>}
 */
async function readJobFiles(jobsDir) {
  let filenames;
  try {
    filenames = await fs.readdir(jobsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const mdFiles = filenames.filter(f => f.endsWith('.md'));
  const results = await Promise.all(
    mdFiles.map(async (filename) => {
      const content = await fs.readFile(path.join(jobsDir, filename), 'utf-8');
      return { filename, content };
    })
  );
  return results;
}

/**
 * Write a job markdown file to the jobs directory.
 *
 * If the filename already exists, appends -2, -3, etc. before the extension
 * until a non-colliding name is found.
 *
 * @param {string} jobsDir - Path to the jobs directory.
 * @param {string} filename - Desired filename (e.g. "job.md").
 * @param {string} content - Markdown content to write.
 * @returns {Promise<string>} The actual filename written.
 */
async function writeJobFile(jobsDir, filename, content) {
  const base = filename.replace(/\.md$/, '');
  let candidate = filename;
  let counter = 2;
  while (true) {
    const filePath = path.join(jobsDir, candidate);
    try {
      await fs.access(filePath);
      // File exists — try next suffix
      candidate = `${base}-${counter}.md`;
      counter++;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File does not exist — write here
        await fs.writeFile(filePath, content, 'utf-8');
        return candidate;
      }
      throw err;
    }
  }
}

/**
 * Write a stack rank markdown file to resumes/[dateStr]/stack_rank_[dateStr].md.
 *
 * Creates the dated subdirectory if it does not exist.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} content - Stack rank markdown content.
 * @returns {Promise<string>} The full path written.
 */
async function writeStackRank(resumesDir, dateStr, content) {
  const targetDir = path.join(resumesDir, dateStr);
  await fs.mkdir(targetDir, { recursive: true });
  const fullPath = path.join(targetDir, `stack_rank_${dateStr}.md`);
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

/**
 * Read a stack rank markdown file for a given date string.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @returns {Promise<string>} The file content.
 * @throws {Error} If the file is not found — message includes the full path.
 */
async function readStackRank(resumesDir, dateStr) {
  const fullPath = path.join(resumesDir, dateStr, `stack_rank_${dateStr}.md`);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Stack rank file not found: ${fullPath}`);
    }
    throw err;
  }
}

/**
 * Read a config file by filename from the config directory.
 *
 * @param {string} configDir - Path to the config directory.
 * @param {string} filename - Config filename (e.g. "scoring_prompt.md").
 * @returns {Promise<string>} The file content.
 * @throws {ConfigMissingError} If the file is not found.
 */
async function readConfig(configDir, filename) {
  const fullPath = path.join(configDir, filename);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ConfigMissingError(filename);
    }
    throw err;
  }
}

/**
 * Write resume.md and cover_letter.md to an application package directory.
 *
 * The directory name is constructed from sanitized company and title.
 * Does NOT overwrite existing output directories — returns false if the
 * target directory already exists.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} company - Company name (raw — will be sanitized).
 * @param {string} title - Job title (raw — will be sanitized).
 * @param {string} resume - Resume markdown content.
 * @param {string} coverLetter - Cover letter markdown content.
 * @returns {Promise<boolean>} true if files were written, false if directory already existed.
 */
async function writeApplicationDocs(resumesDir, dateStr, company, title, resume, coverLetter) {
  const safeCompany = sanitizeForFilename(company, 60);
  const safeTitle = sanitizeForFilename(title, 60);
  const folderName = `${safeCompany} - ${safeTitle}`;
  const targetDir = path.join(resumesDir, dateStr, folderName);

  // Use fs.access to check if directory already exists — guard against overwriting
  try {
    await fs.access(targetDir);
    // Directory exists — do not overwrite
    return false;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // Directory does not exist — create and write files
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'resume.md'), resume, 'utf-8');
  await fs.writeFile(path.join(targetDir, 'cover_letter.md'), coverLetter, 'utf-8');
  return true;
}

/**
 * Write a submission_record.md to an output directory.
 *
 * @param {string} outputDir - Path to the application package directory.
 * @param {string} content - Markdown content for submission_record.md.
 * @returns {Promise<void>}
 */
async function writeSubmissionRecord(outputDir, content) {
  await fs.writeFile(path.join(outputDir, 'submission_record.md'), content, 'utf-8');
}

/**
 * Read the applications.json database from the project root.
 *
 * Returns an empty array if the file does not exist — does NOT throw.
 *
 * @param {string} rootDir - Project root directory.
 * @returns {Promise<object[]>} Array of ApplicationRecord objects.
 */
async function readApplications(rootDir) {
  const filePath = path.join(rootDir, 'applications.json');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Overwrite applications.json with a full array of ApplicationRecord objects.
 *
 * This is an atomic write — callers must read first, modify, then write.
 *
 * @param {string} rootDir - Project root directory.
 * @param {object[]} records - Array of ApplicationRecord objects.
 * @returns {Promise<void>}
 */
async function writeApplications(rootDir, records) {
  const filePath = path.join(rootDir, 'applications.json');
  await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8');
}

/**
 * Move all .md files from the jobs directory to archive/[dateStr]/.
 *
 * Creates the archive subdirectory if needed.
 * Returns the count of files moved. Source directory is left empty but present.
 *
 * @param {string} jobsDir - Path to the jobs directory.
 * @param {string} archiveDir - Path to the archive directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @returns {Promise<number>} Number of files moved.
 */
async function archiveJobFiles(jobsDir, archiveDir, dateStr) {
  const filenames = await fs.readdir(jobsDir);
  const mdFiles = filenames.filter(f => f.endsWith('.md'));

  if (mdFiles.length === 0) {
    return 0;
  }

  const targetDir = path.join(archiveDir, dateStr);
  await fs.mkdir(targetDir, { recursive: true });

  for (const filename of mdFiles) {
    const srcPath = path.join(jobsDir, filename);
    const destPath = path.join(targetDir, filename);
    await fs.rename(srcPath, destPath);
  }

  return mdFiles.length;
}

/**
 * List all application document files (resume.md, cover_letter.md) within
 * a dated output directory.
 *
 * Scans each company subdirectory under resumes/[dateStr]/ and collects
 * the paths of resume.md and cover_letter.md files found within.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @returns {Promise<{ filePath: string, relativePath: string, docType: 'resume'|'cover_letter' }[]>}
 * @throws {Error} Propagates fs errors (ENOENT if date directory does not exist).
 */
async function readDateDir(resumesDir, dateStr) {
  const targetDir = path.join(resumesDir, dateStr);
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(targetDir, entry.name);

    for (const docName of ['resume.md', 'cover_letter.md']) {
      const filePath = path.join(dirPath, docName);
      try {
        await fs.access(filePath);
        const docType = docName === 'resume.md' ? 'resume' : 'cover_letter';
        const relativePath = path.join(dateStr, entry.name, docName);
        results.push({ filePath, relativePath, docType });
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        // File does not exist — skip silently
      }
    }
  }

  return results;
}

/**
 * Write the aggregate QA report markdown file to a dated output directory.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} content - Markdown report content.
 * @returns {Promise<string>} The full path written.
 */
async function writeQaReport(resumesDir, dateStr, content) {
  const targetDir = path.join(resumesDir, dateStr);
  await fs.mkdir(targetDir, { recursive: true });
  const fullPath = path.join(targetDir, 'qa_report.md');
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

/**
 * Read a single application document file from disk.
 *
 * @param {string} filePath - Absolute path to the file to read.
 * @returns {Promise<string>} The file content as a UTF-8 string.
 * @throws {Error} Propagates fs errors (ENOENT if file does not exist).
 */
async function readDocFile(filePath) {
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * Overwrite a single application document file with new content.
 *
 * @param {string} filePath - Absolute path to the file to write.
 * @param {string} content - New content to write.
 * @returns {Promise<void>}
 */
async function writeDocFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Write a forensic_audit.md file into a job's existing output directory.
 *
 * The directory is expected to already exist (created by generate.js's
 * writeApplicationDocs). This method simply writes the audit report file
 * inside it.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} company - Company name (raw — will be sanitized).
 * @param {string} title - Job title (raw — will be sanitized).
 * @param {string} content - Markdown audit report content.
 * @returns {Promise<string>} The full path written.
 */
async function writeForensicAudit(resumesDir, dateStr, company, title, content) {
  const safeCompany = sanitizeForFilename(company, 60);
  const safeTitle = sanitizeForFilename(title, 60);
  const folderName = `${safeCompany} - ${safeTitle}`;
  const targetDir = path.join(resumesDir, dateStr, folderName);
  const fullPath = path.join(targetDir, 'forensic_audit.md');
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

module.exports = {
  readJobFiles,
  writeJobFile,
  writeStackRank,
  readStackRank,
  readConfig,
  writeApplicationDocs,
  writeSubmissionRecord,
  readApplications,
  writeApplications,
  archiveJobFiles,
  readDateDir,
  writeQaReport,
  readDocFile,
  writeDocFile,
  writeForensicAudit,
};
