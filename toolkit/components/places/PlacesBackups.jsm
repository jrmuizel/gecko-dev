/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * vim: sw=2 ts=2 sts=2 expandtab filetype=javascript
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["PlacesBackups"];

const Ci = Components.interfaces;
const Cu = Components.utils;
const Cc = Components.classes;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesUtils.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "BookmarkJSONUtils",
  "resource://gre/modules/BookmarkJSONUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Deprecated",
  "resource://gre/modules/Deprecated.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS",
  "resource://gre/modules/osfile.jsm");

XPCOMUtils.defineLazyGetter(this, "localFileCtor",
  () => Components.Constructor("@mozilla.org/file/local;1",
                               "nsILocalFile", "initWithPath"));

XPCOMUtils.defineLazyGetter(this, "filenamesRegex",
  () => new RegExp("^bookmarks-([0-9\-]+)(?:_([0-9]+)){0,1}(?:_([a-z0-9=\+\-]{24})){0,1}\.(json(lz4)?)$", "i")
);

/**
 * Appends meta-data information to a given filename.
 */
function appendMetaDataToFilename(aFilename, aMetaData) {
  let matches = aFilename.match(filenamesRegex);
  return "bookmarks-" + matches[1] +
                  "_" + aMetaData.count +
                  "_" + aMetaData.hash +
                  "." + matches[4];
}

/**
 * Gets the hash from a backup filename.
 *
 * @return the extracted hash or null.
 */
function getHashFromFilename(aFilename) {
  let matches = aFilename.match(filenamesRegex);
  if (matches && matches[3])
    return matches[3];
  return null;
}

/**
 * Given two filenames, checks if they contain the same date.
 */
function isFilenameWithSameDate(aSourceName, aTargetName) {
  let sourceMatches = aSourceName.match(filenamesRegex);
  let targetMatches = aTargetName.match(filenamesRegex);

  return sourceMatches && targetMatches &&
         sourceMatches[1] == targetMatches[1];
}

/**
 * Given a filename, searches for another backup with the same date.
 *
 * @return OS.File path string or null.
 */
function getBackupFileForSameDate(aFilename) {
  return Task.spawn(function* () {
    let backupFiles = yield PlacesBackups.getBackupFiles();
    for (let backupFile of backupFiles) {
      if (isFilenameWithSameDate(OS.Path.basename(backupFile), aFilename))
        return backupFile;
    }
    return null;
  });
}

this.PlacesBackups = {
  /**
   * Matches the backup filename:
   *  0: file name
   *  1: date in form Y-m-d
   *  2: bookmarks count
   *  3: contents hash
   *  4: file extension
   */
  get filenamesRegex() filenamesRegex,

  get folder() {
    Deprecated.warning(
      "PlacesBackups.folder is deprecated and will be removed in a future version",
      "https://bugzilla.mozilla.org/show_bug.cgi?id=859695");
    return this._folder;
  },

  /**
   * This exists just to avoid spamming deprecate warnings from internal calls
   * needed to support deprecated methods themselves.
   */
  get _folder() {
    let bookmarksBackupDir = Services.dirsvc.get("ProfD", Ci.nsILocalFile);
    bookmarksBackupDir.append(this.profileRelativeFolderPath);
    if (!bookmarksBackupDir.exists()) {
      bookmarksBackupDir.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt("0700", 8));
      if (!bookmarksBackupDir.exists())
        throw("Unable to create bookmarks backup folder");
    }
    delete this._folder;
    return this._folder = bookmarksBackupDir;
  },

  /**
   * Gets backup folder asynchronously.
   * @return {Promise}
   * @resolve the folder (the folder string path).
   */
  getBackupFolder: function PB_getBackupFolder() {
    return Task.spawn(function* () {
      if (this._backupFolder) {
        return this._backupFolder;
      }
      let profileDir = OS.Constants.Path.profileDir;
      let backupsDirPath = OS.Path.join(profileDir, this.profileRelativeFolderPath);
      yield OS.File.makeDir(backupsDirPath, { ignoreExisting: true });
      return this._backupFolder = backupsDirPath;
    }.bind(this));
  },

  get profileRelativeFolderPath() "bookmarkbackups",

  /**
   * Cache current backups in a sorted (by date DESC) array.
   */
  get entries() {
    Deprecated.warning(
      "PlacesBackups.entries is deprecated and will be removed in a future version",
      "https://bugzilla.mozilla.org/show_bug.cgi?id=859695");
    return this._entries;
  },

  /**
   * This exists just to avoid spamming deprecate warnings from internal calls
   * needed to support deprecated methods themselves.
   */
  get _entries() {
    delete this._entries;
    this._entries = [];
    let files = this._folder.directoryEntries;
    while (files.hasMoreElements()) {
      let entry = files.getNext().QueryInterface(Ci.nsIFile);
      // A valid backup is any file that matches either the localized or
      // not-localized filename (bug 445704).
      if (!entry.isHidden() && filenamesRegex.test(entry.leafName)) {
        // Remove bogus backups in future dates.
        if (this.getDateForFile(entry) > new Date()) {
          entry.remove(false);
          continue;
        }
        this._entries.push(entry);
      }
    }
    this._entries.sort((a, b) => {
      let aDate = this.getDateForFile(a);
      let bDate = this.getDateForFile(b);
      return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
    });
    return this._entries;
  },

  /**
   * Cache current backups in a sorted (by date DESC) array.
   * @return {Promise}
   * @resolve a sorted array of string paths.
   */
  getBackupFiles: function PB_getBackupFiles() {
    return Task.spawn(function* () {
      if (this._backupFiles)
        return this._backupFiles;

      this._backupFiles = [];

      let backupFolderPath = yield this.getBackupFolder();
      let iterator = new OS.File.DirectoryIterator(backupFolderPath);
      yield iterator.forEach(function(aEntry) {
        // Since this is a lazy getter and OS.File I/O is serialized, we can
        // safely remove .tmp files without risking to remove ongoing backups.
        if (aEntry.name.endsWith(".tmp")) {
          OS.File.remove(aEntry.path);
          return;
        }

        if (filenamesRegex.test(aEntry.name)) {
          // Remove bogus backups in future dates.
          let filePath = aEntry.path;
          if (this.getDateForFile(filePath) > new Date()) {
            return OS.File.remove(filePath);
          } else {
            this._backupFiles.push(filePath);
          }
        }
      }.bind(this));
      iterator.close();

      this._backupFiles.sort((a, b) => {
        let aDate = this.getDateForFile(a);
        let bDate = this.getDateForFile(b);
        return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
      });

      return this._backupFiles;
    }.bind(this));
  },

  /**
   * Creates a filename for bookmarks backup files.
   *
   * @param [optional] aDateObj
   *                   Date object used to build the filename.
   *                   Will use current date if empty.
   * @param [optional] bool - aCompress
   *                   Determines if file extension is json or jsonlz4
                       Default is json
   * @return A bookmarks backup filename.
   */
  getFilenameForDate: function PB_getFilenameForDate(aDateObj, aCompress) {
    let dateObj = aDateObj || new Date();
    // Use YYYY-MM-DD (ISO 8601) as it doesn't contain illegal characters
    // and makes the alphabetical order of multiple backup files more useful.
      return "bookmarks-" + dateObj.toLocaleFormat("%Y-%m-%d") + ".json" +
                            (aCompress ? "lz4" : "");
  },

  /**
   * Creates a Date object from a backup file.  The date is the backup
   * creation date.
   *
   * @param aBackupFile
   *        nsIFile or string path of the backup.
   * @return A Date object for the backup's creation time.
   */
  getDateForFile: function PB_getDateForFile(aBackupFile) {
    let filename = (aBackupFile instanceof Ci.nsIFile) ? aBackupFile.leafName
                                                       : OS.Path.basename(aBackupFile);
    let matches = filename.match(filenamesRegex);
    if (!matches)
      throw("Invalid backup file name: " + filename);
    return new Date(matches[1].replace(/-/g, "/"));
  },

  /**
   * Get the most recent backup file.
   *
   * @returns nsIFile backup file
   */
  getMostRecent: function PB_getMostRecent() {
    Deprecated.warning(
      "PlacesBackups.getMostRecent is deprecated and will be removed in a future version",
      "https://bugzilla.mozilla.org/show_bug.cgi?id=859695");

    for (let i = 0; i < this._entries.length; i++) {
      let rx = new RegExp("\.json(lz4)?$");
      if (this._entries[i].leafName.match(rx))
        return this._entries[i];
    }
    return null;
  },

   /**
    * Get the most recent backup file.
    *
    * @return {Promise}
    * @result the path to the file.
    */
   getMostRecentBackup: function PB_getMostRecentBackup() {
     return Task.spawn(function* () {
       let entries = yield this.getBackupFiles();
       for (let entry of entries) {
         let rx = new RegExp("\.json(lz4)?$");
         if (OS.Path.basename(entry).match(rx)) {
           return entry;
         }
       }
       return null;
    }.bind(this));
  },

  /**
   * Serializes bookmarks using JSON, and writes to the supplied file.
   * Note: any item that should not be backed up must be annotated with
   *       "places/excludeFromBackup".
   *
   * @param aFilePath
   *        OS.File path for the "bookmarks.json" file to be created.
   * @return {Promise}
   * @resolves the number of serialized uri nodes.
   * @deprecated passing an nsIFile is deprecated
   */
  saveBookmarksToJSONFile: function PB_saveBookmarksToJSONFile(aFilePath) {
    if (aFilePath instanceof Ci.nsIFile) {
      Deprecated.warning("Passing an nsIFile to PlacesBackups.saveBookmarksToJSONFile " +
                         "is deprecated. Please use an OS.File path instead.",
                         "https://developer.mozilla.org/docs/JavaScript_OS.File");
      aFilePath = aFilePath.path;
    }
    return Task.spawn(function* () {
      let { count: nodeCount, hash: hash } =
        yield BookmarkJSONUtils.exportToFile(aFilePath);

      let backupFolderPath = yield this.getBackupFolder();
      if (OS.Path.dirname(aFilePath) == backupFolderPath) {
        // We are creating a backup in the default backups folder,
        // so just update the internal cache.
        this._entries.unshift(new localFileCtor(aFilePath));
        if (!this._backupFiles) {
          yield this.getBackupFiles();
        }
        this._backupFiles.unshift(aFilePath);
      } else {
        // If we are saving to a folder different than our backups folder, then
        // we also want to create a new compressed version in it.
        // This way we ensure the latest valid backup is the same saved by the
        // user.  See bug 424389.
        let mostRecentBackupFile = yield this.getMostRecentBackup();
        if (!mostRecentBackupFile ||
            hash != getHashFromFilename(OS.Path.basename(mostRecentBackupFile))) {
          let name = this.getFilenameForDate(undefined, true);
          let newFilename = appendMetaDataToFilename(name,
                                                     { count: nodeCount,
                                                       hash: hash });
          let newFilePath = OS.Path.join(backupFolderPath, newFilename);
          let backupFile = yield getBackupFileForSameDate(name);
          if (backupFile) {
            // There is already a backup for today, replace it.
            yield OS.File.remove(backupFile, { ignoreAbsent: true });
            if (!this._backupFiles)
              yield this.getBackupFiles();
            else
              this._backupFiles.shift();
            this._backupFiles.unshift(newFilePath);
          } else {
            // There is no backup for today, add the new one.
            this._entries.unshift(new localFileCtor(newFilePath));
            if (!this._backupFiles)
              yield this.getBackupFiles();
            this._backupFiles.unshift(newFilePath);
          }
          let jsonString = yield OS.File.read(aFilePath);
          yield OS.File.writeAtomic(newFilePath, jsonString, { compression: "lz4" });
        }
      }

      return nodeCount;
    }.bind(this));
  },

  /**
   * Creates a dated backup in <profile>/bookmarkbackups.
   * Stores the bookmarks using a lz4 compressed JSON file.
   * Note: any item that should not be backed up must be annotated with
   *       "places/excludeFromBackup".
   *
   * @param [optional] int aMaxBackups
   *                       The maximum number of backups to keep.  If set to 0
   *                       all existing backups are removed and aForceBackup is
   *                       ignored, so a new one won't be created.
   * @param [optional] bool aForceBackup
   *                        Forces creating a backup even if one was already
   *                        created that day (overwrites).
   * @return {Promise}
   */
  create: function PB_create(aMaxBackups, aForceBackup) {
    let limitBackups = function* () {
      let backupFiles = yield this.getBackupFiles();
      if (typeof aMaxBackups == "number" && aMaxBackups > -1 &&
          backupFiles.length >= aMaxBackups) {
        let numberOfBackupsToDelete = backupFiles.length - aMaxBackups;
        while (numberOfBackupsToDelete--) {
          this._entries.pop();
          let oldestBackup = this._backupFiles.pop();
          yield OS.File.remove(oldestBackup);
        }
      }
    }.bind(this);

    return Task.spawn(function* () {
      if (aMaxBackups === 0) {
        // Backups are disabled, delete any existing one and bail out.
        yield limitBackups(0);
        return;
      }

      // Ensure to initialize _backupFiles
      if (!this._backupFiles)
        yield this.getBackupFiles();
      let newBackupFilename = this.getFilenameForDate(undefined, true);
      // If we already have a backup for today we should do nothing, unless we
      // were required to enforce a new backup.
      let backupFile = yield getBackupFileForSameDate(newBackupFilename);
      if (backupFile && !aForceBackup)
        return;

      if (backupFile) {
        // In case there is a backup for today we should recreate it.
        this._backupFiles.shift();
        this._entries.shift();
        yield OS.File.remove(backupFile, { ignoreAbsent: true });
      }

      // Now check the hash of the most recent backup, and try to create a new
      // backup, if that fails due to hash conflict, just rename the old backup.
      let mostRecentBackupFile = yield this.getMostRecentBackup();
      let mostRecentHash = mostRecentBackupFile &&
                           getHashFromFilename(OS.Path.basename(mostRecentBackupFile));

      // Save bookmarks to a backup file.
      let backupFolder = yield this.getBackupFolder();
      let newBackupFile = OS.Path.join(backupFolder, newBackupFilename);
      let newFilenameWithMetaData;
      try {
        let { count: nodeCount, hash: hash } =
          yield BookmarkJSONUtils.exportToFile(newBackupFile,
                                               { compress: true,
                                                 failIfHashIs: mostRecentHash });
        newFilenameWithMetaData = appendMetaDataToFilename(newBackupFilename,
                                                           { count: nodeCount,
                                                             hash: hash });
      } catch (ex if ex.becauseSameHash) {
        // The last backup already contained up-to-date information, just
        // rename it as if it was today's backup.
        this._backupFiles.shift();
        this._entries.shift();
        newBackupFile = mostRecentBackupFile;
        // Ensure we retain the proper extension when renaming
        // the most recent backup file.
        if (/\.json$/.test(OS.Path.basename(mostRecentBackupFile)))
          newBackupFilename = this.getFilenameForDate();
        newFilenameWithMetaData = appendMetaDataToFilename(
          newBackupFilename,
          { count: this.getBookmarkCountForFile(mostRecentBackupFile),
            hash: mostRecentHash });
      }

      // Append metadata to the backup filename.
      let newBackupFileWithMetadata = OS.Path.join(backupFolder, newFilenameWithMetaData);
      yield OS.File.move(newBackupFile, newBackupFileWithMetadata);
      this._entries.unshift(new localFileCtor(newBackupFileWithMetadata));
      this._backupFiles.unshift(newBackupFileWithMetadata);

      // Limit the number of backups.
      yield limitBackups(aMaxBackups);
    }.bind(this));
  },

  /**
   * Gets the bookmark count for backup file.
   *
   * @param aFilePath
   *        File path The backup file.
   *
   * @return the bookmark count or null.
   */
  getBookmarkCountForFile: function PB_getBookmarkCountForFile(aFilePath) {
    let count = null;
    let filename = OS.Path.basename(aFilePath);
    let matches = filename.match(filenamesRegex);
    if (matches && matches[2])
      count = matches[2];
    return count;
  },

  /**
   * Gets a bookmarks tree representation usable to create backups in different
   * file formats.  The root or the tree is PlacesUtils.placesRootId.
   * Items annotated with PlacesUtils.EXCLUDE_FROM_BACKUP_ANNO and all of their
   * descendants are excluded.
   *
   * @return an object representing a tree with the places root as its root.
   *         Each bookmark is represented by an object having these properties:
   *         * id: the item id (make this not enumerable after bug 824502)
   *         * title: the title
   *         * guid: unique id
   *         * parent: item id of the parent folder, not enumerable
   *         * index: the position in the parent
   *         * dateAdded: microseconds from the epoch
   *         * lastModified: microseconds from the epoch
   *         * type: type of the originating node as defined in PlacesUtils 
   *         The following properties exist only for a subset of bookmarks:
   *         * annos: array of annotations
   *         * uri: url
   *         * iconuri: favicon's url
   *         * keyword: associated keyword
   *         * charset: last known charset
   *         * tags: csv string of tags
   *         * root: string describing whether this represents a root
   *         * children: array of child items in a folder
   */
  getBookmarksTree: Task.async(function* () {
    let rootGUID = yield PlacesUtils.promiseItemGUID(PlacesUtils.placesRootId);
    let startTime = Date.now();
    let root = yield PlacesUtils.promiseBookmarksTree(rootGUID, {
      excludeItemsCallback: aItem => {
        return aItem.annos &&
          aItem.annos.find(a => a.name == PlacesUtils.EXCLUDE_FROM_BACKUP_ANNO);
      },
      includeItemIds: true
    });

    try {
      Services.telemetry
              .getHistogramById("PLACES_BACKUPS_BOOKMARKSTREE_MS")
              .add(Date.now() - startTime);
    } catch (ex) {
      Components.utils.reportError("Unable to report telemetry.");
    }
    return [root, root.itemsCount];
  })
}

