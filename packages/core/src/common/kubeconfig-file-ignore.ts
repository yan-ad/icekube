/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/**
 * These file names are ignored outright when under a folder sync
 */
const ignoredFileNames = new Set([
  ".DS_Store", // macOS specific
  "Thumbs.db", // windows specific
  "cache", // discovery cache
  "desktop.ini", // windows specific
  "kubectx", // kubectx cache
  "kubens", // kubens cache
]);

/**
 * These file name patterns are ignored when under a folder sync.
 *
 * They used to be globs compiled by `glob-to-regexp`. What is matched is always
 * a basename, so every `*` in the original globs compiled to `.*` and did
 * nothing but leave one end of the pattern unanchored.
 */
const ignoredFileNamePatterns = [
  /^\._/, // macOS specific
  /^\.#/, // emacs lock files
  /^~/, // backup file
  /\.bak$/, // backup file
  /\.lock$/, // kubectl lock files
  /\.sw[nop]$/, // vim swap files
  /#$/, // emacs auto save
  /~$/, // backup file
];

/**
 * Returns the ignore rule that `fileName` matches, or `undefined` when the file
 * should be synced.
 */
export const matchIgnoredKubeconfigFileName = (fileName: string): string | undefined => {
  if (ignoredFileNames.has(fileName)) {
    return fileName;
  }

  return ignoredFileNamePatterns.find((pattern) => pattern.test(fileName))?.source;
};
