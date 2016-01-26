 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const debug = require('debug')('ReactNativePackager:DependencyGraph');
const util = require('util');
const path = require('path');
const inArray = require ('in-array');
const NODE_PATHS = require('node-paths');
const isAbsolutePath = require('absolute-path');
const getAssetDataFromName = require('../../lib/getAssetDataFromName');
const {sync} = require('io');
const Q = require('q');

const Module = require('../Module');
const NullModule = require('../NullModule');
const globalConfig = require('../../GlobalConfig');

class ResolutionRequest {
  constructor({
    dev,
    platform,
    entryPath,
    hasteMap,
    assetServer,
    helpers,
    moduleCache,
    fastfs,
  }) {
    this._dev = dev;
    this._platform = platform;
    this._entryPath = entryPath;
    this._hasteMap = hasteMap;
    this._assetServer = assetServer;
    this._helpers = helpers;
    this._moduleCache = moduleCache;
    this._fastfs = fastfs;
  }

  getOrderedDependencies(response) {
    return Q().then(() => {
      const entry = this._moduleCache.getModule(this._entryPath);
      const visited = Object.create(null);
      visited[entry.hash()] = true;

      var failed = false;
      const collect = (mod) => {
        response.pushDependency(mod);
        return mod.getDependencies().then(
          depNames => Q.all(
            depNames.map(name => {
              const result = mod.resolveDependency(name);
              if (result) {
                return result;
              }

              return this.resolveDependency(mod, name)
              .then(result => {
                if (result && !failed) {
                  var displayPath = result.path;
                  if (result.path[0] === '/') {
                    displayPath = path.relative(lotus.path, result.path);
                  }
                  log
                    .moat(1)
                    .white('Resolved: ')
                    .green(name)
                    .moat(0)
                    .white('    into: ')
                    .cyan(displayPath)
                    .moat(0)
                    .white('     for: ')
                    .yellow(path.relative(lotus.path, mod.path))
                    .moat(1);
                }
                return result;
              })
              .fail(error => {
                failed = true;
                if (error.type !== 'UnableToResolveError') {
                  throw error;
                }
              });
            })
          )
          .then(dependencies => [depNames, dependencies])
        ).then(([depNames, dependencies]) => {
          let p = Q();

          const filteredPairs = [];

          dependencies.forEach((modDep, i) => {
            if (modDep == null) {
              debug(
                'WARNING: Cannot find required module `%s` from module `%s`',
                depNames[i],
                mod.path
              );
              return false;
            }
            return filteredPairs.push([depNames[i], modDep]);
          });

          response.setResolvedDependencyPairs(mod, filteredPairs);

          filteredPairs.forEach(([depName, modDep]) => {
            p = p.then(() => {
              if (!visited[modDep.hash()]) {
                visited[modDep.hash()] = true;
                return collect(modDep);
              }
              return null;
            });
          });

          return p;
        });
      };

      return collect(entry);
    });
  }

  getAsyncDependencies(response) {
    return Q().then(() => {
      const mod = this._moduleCache.getModule(this._entryPath);
      return mod.getAsyncDependencies().then(bundles =>
        Q.all(bundles.map(bundle =>
          Q.all(bundle.map(
            dep => this.resolveDependency(mod, dep)
          ))
        ))
        .then(bs => bs.map(bundle => bundle.map(dep => dep.path)))
      );
    }).then(asyncDependencies => asyncDependencies.forEach(
      (dependency) => response.pushAsyncDependency(dependency)
    ));
  }

  resolveDependency(fromModule, toModuleName) {
    return Q.try(() =>
      this._resolveAssetDependency(toModuleName) ||
        this._resolveJSDependency(fromModule, toModuleName))
    .then(resolvedModule => {
      fromModule.resolveDependency(toModuleName, resolvedModule);
      return resolvedModule;
    });
  }

  _resolveJSDependency(fromModule, toModuleName) {
    return Q.all([
      toModuleName,
      this._redirectRequire(fromModule, toModuleName)
    ])

    .then(([oldModuleName, toModuleName]) => {

      if (toModuleName === null) {
        redirectAlert(fromModule.path, oldModuleName);
        return this._getNullModule(oldModuleName, fromModule);
      }

      if (globalConfig.redirect[toModuleName] !== undefined) {
        let oldModuleName = toModuleName;
        toModuleName = globalConfig.redirect[toModuleName];
        if (toModuleName === false) {
          redirectAlert(fromModule.path, oldModuleName);
          return this._getNullModule(oldModuleName, fromModule);
        }
        toModuleName = globalConfig.resolve(toModuleName);
        redirectAlert(fromModule.path, oldModuleName, toModuleName);
      }

      if (inArray(NODE_PATHS, toModuleName)
          && !this._hasteMap._map[toModuleName]) {
        redirectAlert(fromModule.path, toModuleName);
        return this._getNullModule(toModuleName, fromModule);
      }

      var promise = Q.reject();

      if (toModuleName[0] !== '.' && toModuleName[0] !== '/') {
        promise = promise.fail(() =>
          this._resolveHasteDependency(fromModule, toModuleName));
      }

      return promise

      .fail(() => {
        let absPath = this._getLotusPath(fromModule, toModuleName);
        return this._resolveNodeDependency(fromModule, absPath);
      })

      .fail(error => {
        if (error.type === 'UnableToResolveError') {
          log
            .moat(1)
            .white('Failed to resolve: ')
            .red(toModuleName)
            .moat(0)
            .white('              for: ')
            .red(path.relative(lotus.path, fromModule.path))
            .moat(1);
        }
        throw error;
      });
    });
  }

  _resolveAssetDependency(toModuleName) {
    const assetPath = this._assetServer.resolve(toModuleName, this._fastfs);
    if (assetPath) {
      return this._moduleCache.getAssetModule(assetPath);
    }
  }

  _resolveHasteDependency(fromModule, toModuleName) {

    return Q.try(() => {
      var dep = this._hasteMap.getModule(toModuleName, this._platform);
      if (dep && dep.type === 'Module') {
        return dep;
      }

      let packageName = toModuleName;
      while (packageName && packageName !== '.') {
        dep = this._hasteMap.getModule(packageName, this._platform);
        if (dep && dep.type === 'Package') {
          break;
        }
        packageName = path.dirname(packageName);
      }

      if (dep && dep.type === 'Package') {
        const potentialModulePath = path.join(
          dep.root,
          path.relative(packageName, toModuleName)
        );
        return this._tryResolve(
          () => this._loadAsFile(potentialModulePath),
          () => this._loadAsDir(potentialModulePath)
        );
      }

      throw new UnableToResolveError('Unable to resolve dependency');
    });
  }

  _resolveNodeDependency(fromModule, toModuleName) {

    if (toModuleName[0] === '.') {
      throw new Error('"' + toModuleName + '" cannot be a relative path');
    }

    return Q.try(() => {

      if (toModuleName[0] === '/') {
        return this._tryResolve(
          () => this._loadAsFile(toModuleName),
          () => this._loadAsDir(toModuleName)
        );
      }

      if (lotus.isEnabled) {
        const absPath = lotus.resolve(toModuleName, fromModule.path);
        if (absPath && this._fastfs._getRoot(absPath).isDetached) {
          return Q.try(() => this._moduleCache.getModule(absPath));
        }
      }

      const searchQueue = [];
      for (let currDir = path.dirname(fromModule.path);
           currDir !== '/';
           currDir = path.dirname(currDir)) {
        if (/node_modules$/.test(currDir)) {
          continue;
        }
        searchQueue.push(
          path.join(currDir, 'node_modules', toModuleName)
        );
      }

      var promise = Q.reject(new UnableToResolveError('Node module not found'));

      searchQueue.forEach(potentialModulePath => {
        promise = this._tryResolve(
          () => this._tryResolve(
            () => promise,
            () => this._loadAsFile(potentialModulePath)
          ),
          () => this._loadAsDir(potentialModulePath)
        );
      });

      return promise;
    });
  }

  _redirectRequire(fromModule, modulePath) {
    return Q(fromModule.getPackage()).then(p => {
      if (p) {
        var absPath = modulePath;
        if (modulePath[0] === '.') {
          absPath = path.resolve(
            path.dirname(fromModule.path),
            modulePath
          );
        }
        return p.redirectRequire(absPath)
        .then(redirect => {
          if (redirect === absPath) {
            return modulePath;
          } else {
            redirectAlert(fromModule.path, modulePath, redirect);
            return redirect;
          }
        });
      }
      return modulePath;
    });
  }

  _loadAsFile(potentialModulePath) {
    return Q().then(() => {
      let file;
      if (this._fileExists(potentialModulePath)) {
        file = potentialModulePath;
      } else if (this._platform != null &&
                 this._fileExists(potentialModulePath + '.' + this._platform + '.js')) {
        file = potentialModulePath + '.' + this._platform + '.js';
      } else if (this._fileExists(potentialModulePath + '.js')) {
        file = potentialModulePath + '.js';
      } else if (this._fileExists(potentialModulePath + '.json')) {
        file = potentialModulePath + '.json';
      } else {
        throw new UnableToResolveError(`File ${potentialModulePath} doesnt exist`);
      }

      return this._moduleCache.getModule(file);
    });
  }

  _loadAsDir(potentialDirPath) {
    return Q().then(() => {
      if (!this._dirExists(potentialDirPath)) {
        throw new UnableToResolveError(`Invalid directory ${potentialDirPath}`);
      }

      const packageJsonPath = path.join(potentialDirPath, 'package.json');
      if (this._fileExists(packageJsonPath)) {
        return this._moduleCache.getPackage(packageJsonPath)
          .getMain().then(
            (main) => this._tryResolve(
              () => this._loadAsFile(main),
              () => this._loadAsDir(main)
            )
          );
      }

      return this._loadAsFile(path.join(potentialDirPath, 'index'));
    });
  }

  _fileExists(filePath) {
    const root = this._fastfs._getRoot(filePath);
    if (root == null) {
      return false;
    }
    if (root.isDetached) {
      return sync.isFile(filePath);
    }
    return this._fastfs.fileExists(filePath);
  }

  _dirExists(filePath) {
    const root = this._fastfs._getRoot(filePath);
    if (root == null) {
      return false;
    }
    if (root.isDetached) {
      return sync.isDir(filePath);
    }
    return this._fastfs.dirExists(filePath);
  }

  _tryResolve(action, secondaryAction) {
    return action().fail((error) => {
      if (error.type !== 'UnableToResolveError') {
        throw error;
      }
      return secondaryAction();
    });
  }

  _getLotusPath(fromModule, toModuleName) {
    var lotusPath = lotus.resolve(toModuleName, fromModule.path);
    if (lotusPath) {
      return lotusPath;
    }

    // Support './MyClass' paths as shorthand for './MyClass/index'
    if (toModuleName[0] === '.') {
      toModuleName = path.resolve(
        path.dirname(fromModule.path),
        toModuleName
      );
      if (sync.isDir(toModuleName)) {
        lotusPath = lotus.resolve(toModuleName + '/index');
        if (lotusPath) {
          return lotusPath;
        }
      }
    }

    throw new UnableToResolveError();
  }

  _getNullModule(modulePath, fromModule) {

    // if (!this._dev) {
    //   return;
    // }

    if (typeof modulePath !== 'string') {
      throw TypeError('Expected "modulePath" to be a String');
    }

    const moduleCache = this._moduleCache._moduleCache;

    if (modulePath[0] === '.') {
      modulePath = path.resolve(
        path.resolve(fromModule.path),
        modulePath
      );
    }

    modulePath = modulePath + ' (null)';

    var module = moduleCache[modulePath];

    if (!module) {
      module = moduleCache[modulePath] = new NullModule(
        modulePath,
        this._fastfs,
        this._moduleCache,
        this._moduleCache._cache
      );
    }

    return module;
  }
}

function redirectAlert(depender, oldName, newName) {
  // if (newName == null) {
  //   newName = log.color.gray('null');
  // } else if (typeof newName === 'boolean') {
  //   newName = log.color.yellow(newName);
  // }
  // log
  //   .moat(1)
  //   .gray.dim(depender).moat(0)
  //   .green('redirect ').white(oldName).moat(0)
  //   .green('      to ').white(newName).moat(1);
}

function UnableToResolveError() {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);
  var msg = util.format.apply(util, arguments);
  this.message = msg;
  this.type = this.name = 'UnableToResolveError';
}

util.inherits(UnableToResolveError, Error);


module.exports = ResolutionRequest;
