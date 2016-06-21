/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const path = require('path');
const http = require('http');
const connect = require('connect');
const ReactPackager = require('react-packager');

const webSocketProxy = require('./util/webSocketProxy.js');
const attachHMRServer = require('./util/attachHMRServer');

const statusPageMiddleware = require('./middleware/statusPageMiddleware.js');
const getDevToolsMiddleware = require('./middleware/getDevToolsMiddleware');
const cpuProfilerMiddleware = require('./middleware/cpuProfilerMiddleware');
const loadRawBodyMiddleware = require('./middleware/loadRawBodyMiddleware');
const systraceProfileMiddleware = require('./middleware/systraceProfileMiddleware.js');
const openStackFrameInEditorMiddleware = require('./middleware/openStackFrameInEditorMiddleware');

function runServer(args, config, readyCallback) {
  var wsProxy = null;

  log.clear();
  log.pushIndent(2);

  const packagerServer = getPackagerServer(args, config);

  const app = connect()
    .use(loadRawBodyMiddleware)
    .use(connect.compress())
    .use(getDevToolsMiddleware(args, () => wsProxy && wsProxy.isChromeConnected()))
    .use(openStackFrameInEditorMiddleware)
    .use(statusPageMiddleware)
    .use(systraceProfileMiddleware)
    .use(cpuProfilerMiddleware)
    .use(packagerServer.processRequest.bind(packagerServer));

  args.projectRoots.forEach(root => app.use(connect.static(root)));

  app.use(connect.logger())
    .use(connect.errorHandler());

  const serverInstance = http.createServer(app).listen(
    args.port,
    args.host,
    function() {
      attachHMRServer({
        httpServer: serverInstance,
        path: '/hot',
        packagerServer,
      });

      wsProxy = webSocketProxy.attachToServer(serverInstance, '/debugger-proxy');
      webSocketProxy.attachToServer(serverInstance, '/devtools');

      log.moat(1);
      log.gray.dim('Listening...');
      log.moat(0);
      log.green('http://', require('ip').address(), ':', args.port);
      log.moat(1);
      readyCallback && readyCallback();
    }
  );
  // Disable any kind of automatic timeout behavior for incoming
  // requests in case it takes the packager more than the default
  // timeout of 120 seconds to respond to a request.
  serverInstance.timeout = 0;
}

function getPackagerServer(args, config) {

  const internalRoots = [
    'fbjs/src',
    'react/src',
    'react-native/Libraries',
    'react-native/node_modules/react-timer-mixin',
  ].map(root => path.join(lotus.path, root));

  const transformModulePath =
    path.isAbsolute(args.transformer) ? args.transformer :
    path.resolve(process.cwd(), args.transformer);

  const { projectRoots } = args;
  const { projectExts, assetExts } = ReactPackager.config;

  log.moat(1);
  log.white('Watching: ');
  log.plusIndent(2);
  if (projectRoots.length) {
    projectRoots.forEach(root => {
      log.moat(0);
      log.cyan(root);
    });
  } else {
    log.gray.dim('(empty)');
  }
  log.popIndent();
  log.moat(1);

  log.moat(1);
  log.white('Valid extensions: ');
  log.plusIndent(2);
  if (projectExts.length || assetExts.length) {
    projectExts
      .concat(assetExts)
      .forEach(ext => {
        log.moat(0);
        log.yellow('.' + ext);
      });
  } else {
    log.moat(0);
    log.gray.dim('(empty)');
  }
  log.popIndent();
  log.moat(1);

  return ReactPackager.createServer({
    cacheVersion: '3',
    resetCache: args.resetCache || args['reset-cache'],
    nonPersistent: args.nonPersistent,
    internalRoots: internalRoots,
    projectRoots: projectRoots,
    projectExts: projectExts,
    assetExts: assetExts,
    transformModulePath: transformModulePath,
    getTransformOptionsModulePath: config.getTransformOptionsModulePath,
    verbose: args.verbose,
  });
}

module.exports = runServer;
