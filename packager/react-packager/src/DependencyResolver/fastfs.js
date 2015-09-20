'use strict';

const Activity = require('../Activity');
const Q = require('q');
const {EventEmitter} = require('events');

const _ = require('underscore');
const fs = require('fs');
const path = require('path');

const readFile = Q.denodeify(fs.readFile);
const stat = Q.denodeify(fs.stat);

const isDescendant = require('../lib/isDescendant');
const hasOwn = Object.prototype.hasOwnProperty;

const NOT_FOUND_IN_ROOTS = 'NotFoundInRootsError';

const File = require('./File');

class Fastfs extends EventEmitter {
  constructor(name, roots, fileWatcher, {ignore, crawling}) {
    super();
    this._name = name;
    this._fileWatcher = fileWatcher;
    this._ignore = ignore;
    this._detachedRoots = [];
    this._roots = roots.map(root => new File(root, { isDir: true }));
    this._fastPaths = Object.create(null);
    this._crawling = crawling;
  }

  build() {
    const rootsPattern = new RegExp(
      '^(' + this._roots.map(root => escapeRegExp(root.path)).join('|') + ')'
    );

    return this._crawling.then(files => {
      const fastfsActivity = Activity.startEvent('Building in-memory fs for ' + this._name);
      files.forEach(filePath => {
        if (filePath.match(rootsPattern)) {
          const newFile = new File(filePath, { isDir: false });
          const parent = this._fastPaths[path.dirname(filePath)];
          if (parent) {
            parent.addChild(newFile);
          } else {
            this._add(newFile);
            for (let file = newFile; file; file = file.parent) {
              if (!this._fastPaths[file.path]) {
                this._fastPaths[file.path] = file;
              }
            }
          }
        }
      });
      Activity.endEvent(fastfsActivity);
      this._fileWatcher.on('all', this._processFileChange.bind(this));
    });
  }

  stat(filePath) {
    return Q().then(() => {
      const file = this._getFile(filePath);
      return file.stat();
    });
  }

  getAllFiles() {
    return _.chain(this._roots)
      .map(root => root.getFiles())
      .flatten()
      .value();
  }

  findFilesByExt(ext, { ignore }) {
    return this.getAllFiles()
      .filter(
        file => file.ext() === ext && (!ignore || !ignore(file.path))
      )
      .map(file => file.path);
  }

  findFilesByExts(exts) {
    return this.getAllFiles()
      .filter(file => exts.indexOf(file.ext()) !== -1)
      .map(file => file.path);
  }

  findFilesByName(name, { ignore }) {
    return this.getAllFiles()
      .filter(
        file => path.basename(file.path) === name &&
          (!ignore || !ignore(file.path))
      )
      .map(file => file.path);
  }

  readFile(filePath) {
    const file = this._getFile(filePath);
    if (!file) {
      throw new Error(`Unable to find file with path: ${file}`);
    }
    return file.read();
  }

  closest(filePath, name) {
    for (let file = this._getFile(filePath).parent;
         file;
         file = file.parent) {
      if (file.children[name]) {
        return file.children[name].path;
      }
    }
    return null;
  }

  fileExists(filePath) {
    let file;
    try {
      file = this._getFile(filePath);
    } catch (e) {
      if (e.type === NOT_FOUND_IN_ROOTS) {
        return false;
      }
      throw e;
    }

    return file && !file.isDir;
  }

  dirExists(filePath) {
    let file;
    try {
      file = this._getFile(filePath);
    } catch (e) {
      if (e.type === NOT_FOUND_IN_ROOTS) {
        return false;
      }
      throw e;
    }

    return file && file.isDir;
  }

  matches(dir, pattern) {
    let dirFile = this._getFile(dir);
    if (!dirFile.isDir) {
      throw new Error(`Expected file ${dirFile.path} to be a directory`);
    }

    return Object.keys(dirFile.children)
      .filter(name => name.match(pattern))
      .map(name => path.join(dirFile.path, name));
  }

  _getRoot(filePath) {
    return this._getRootFromRoots(filePath, this._roots) ||
           this._getRootFromRoots(filePath, this._detachedRoots);
  }

  _getRootFromRoots(filePath, roots) {
    for (let i = 0; i < roots.length; i++) {
      let root = roots[i];
      if (isDescendant(root.path, filePath)) {
        return root;
      }
    }
    return null;
  }

  _getAndAssertRoot(filePath) {
    const root = this._getRoot(filePath);
    if (!root) {
      const error = new Error(`File ${filePath} not found in any of the roots`);
      error.type = NOT_FOUND_IN_ROOTS;
      throw error;
    }
    return root;
  }

  _getFile(filePath) {
    filePath = path.normalize(filePath);
    if (!hasOwn.call(this._fastPaths, filePath)) {
      this._fastPaths[filePath] = this._getAndAssertRoot(filePath).getFileFromPath(filePath);
    }

    return this._fastPaths[filePath];
  }

  _add(file) {
    this._getAndAssertRoot(file.path).addChild(file);
  }

  _processFileChange(type, filePath, root, fstat) {
    const absPath = path.join(root, filePath);
    if (this._ignore(absPath) || (fstat && fstat.isDirectory())) {
      return;
    }

    // Make sure this event belongs to one of our roots.
    if (!this._getRoot(absPath)) {
      return;
    }

    if (type === 'delete' || type === 'change') {
      const file = this._getFile(absPath);
      if (file) {
        file.remove();
      }
    }

    delete this._fastPaths[path.normalize(absPath)];

    if (type !== 'delete') {
      this._add(new File(absPath, { isDir: false }));
    }

    this.emit('change', type, filePath, root, fstat);
  }
}

function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

module.exports = Fastfs;
