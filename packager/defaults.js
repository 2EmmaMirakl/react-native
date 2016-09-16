/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 */
'use strict';

exports.assetExts =  [
  'bmp', 'gif', 'jpg', 'jpeg', 'png', 'psd', 'svg', 'webp', // Image formats
  'm4v', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', // Video formats
  'aac', 'aiff', 'caf', 'm4a', 'mp3', 'wav', // Audio formats
  'html', 'pdf', // Document formats
];

exports.moduleSystem = require.resolve('./react-packager/js/Resolver/polyfills/require.js');

exports.platforms = ['ios', 'android', 'windows', 'web'];

exports.polyfills = [
  require.resolve('./react-packager/js/Resolver/polyfills/polyfills.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/console.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/error-guard.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/Number.es6.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/String.prototype.es6.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/Array.prototype.es6.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/Array.es6.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/Object.es7.js'),
  require.resolve('./react-packager/js/Resolver/polyfills/babelHelpers.js'),
];

exports.providesModuleNodeModules = [
  'react-native',
  'react-native-windows',
  // Parse requires AsyncStorage. They will
  // change that to require('react-native') which
  // should work after this release and we can
  // remove it from here.
  'parse',
];

exports.runBeforeMainModule = [
  // Ensures essential globals are available and are patched correctly.
  'InitializeCore',
];
