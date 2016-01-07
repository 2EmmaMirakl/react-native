/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule loadSourceMap
 * @flow
 */

'use strict';

var Q = require('q');
var Path = require('path');
var NativeModules = require('NativeModules');
var SourceMapConsumer = require('SourceMap').SourceMapConsumer;
var SourceMapURL = require('./source-map-url');
var { fetch } = require('fetch');

var RCTSourceCode = NativeModules.SourceCode;
var RCTNetworking = NativeModules.Networking;

global._loadSourceMapForFile = Object.create(null);

function loadSourceMapForBundle(): Q.Promise {

  if (global.RAW_SOURCE_MAP) {
    return Q(global.RAW_SOURCE_MAP);
  }

  if (!RCTSourceCode) {
    return Q.reject(new Error('RCTSourceCode module is not available'));
  }

  if (!RCTNetworking) {
    // Used internally by fetch
    return Q.reject(new Error('RCTNetworking module is not available'));
  }

  return Q.promise((resolve, reject) =>
    RCTSourceCode.getScriptText(resolve, reject))

  .then(extractSourceMapURL)

  .then(({ fullURL, baseURL, mapURL }) => {
    if (fullURL) { return fullURL }
    if (mapURL) { return baseURL + mapURL }
    throw Error('No source map URL found.');
  })

  .then(loadSourceMap);
}

function loadSourceMapForFile(filePath): Q.Promise {

  if (filePath[0] !== '/') {
    return Q.reject(Error('"filePath" must start with a "/".'));
  }

  var dirPath = filePath.slice(0, filePath.lastIndexOf('/'));

  var url = 'http://192.168.0.2:8081/read' + filePath;

  var promise = global._loadSourceMapForFile[url];

  if (!promise) {
    console.log('Loading: ' + url);
    promise = global._loadSourceMapForFile[url] = fetch(url);
    promise.always(() => {
      console.log('Finished loading: ' + url);
      delete global._loadSourceMapForFile[url];
    });
  }

  return promise

  .then(res => ({ url: url, text: res._bodyText }))

  .then(extractSourceMapURL)

  .then((urls) => {
    if (urls.mapURL) {
      return urls.baseURL + '/read' + Path.resolve(dirPath + '/' + urls.mapURL);
    }
    throw Error('No source map: ' + url);
  })

  .then(loadSourceMap);
}

function loadSourceMap(url): Q.Promise {

  console.log('Loading source map: ' + url);

  global._loadSourceMap = fetch(url);

  return global._loadSourceMap

  .then(res => res.text())

  .then(map => new SourceMapConsumer(map));
}

function extractSourceMapURL({ url, text, fullSourceMappingURL }): ?string {
  return {
    fullURL: fullSourceMappingURL || null,
    baseURL: url ? url.match(/(.+:\/\/.*?)\//)[1] : null,
    mapURL: SourceMapURL.getFrom(text) || null,
  };
}

module.exports = {
  loadSourceMap: loadSourceMap,
  loadSourceMapForBundle: loadSourceMapForBundle,
  loadSourceMapForFile: loadSourceMapForFile,
};
