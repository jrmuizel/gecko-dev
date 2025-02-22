/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var express = require('express');
var app = express();

var port = process.env.PORT || 3000;
var loopServerPort = process.env.LOOP_SERVER_PORT || 5000;

function getConfigFile(req, res) {
  "use strict";

  res.set('Content-Type', 'text/javascript');
  res.send(
    "var loop = loop || {};" +
    "loop.config = loop.config || {};" +
    "loop.config.serverUrl = 'http://localhost:" + loopServerPort + "';" +
    "loop.config.pendingCallTimeout = 20000;"
  );
}

app.get('/content/config.js', getConfigFile);

// This lets /test/ be mapped to the right place for running tests
app.use('/', express.static(__dirname + '/../'));

// Magic so that the legal content works both in the standalone server
// and as static content in the loop-client repo
app.use('/', express.static(__dirname + '/content/'));
app.use('/shared', express.static(__dirname + '/../content/shared/'));
app.get('/config.js', getConfigFile);

// This lets /content/ be mapped right for the static contents.
app.use('/', express.static(__dirname + '/'));
// This lets standalone components load images into the UI showcase
app.use('/standalone/content', express.static(__dirname + '/../content'));

var server = app.listen(port);

var baseUrl = "http://localhost:" + port + "/";

console.log("Serving repository root over HTTP at " + baseUrl);
console.log("Static contents are available at " + baseUrl + "content/");
console.log("Tests are viewable at " + baseUrl + "test/");
console.log("Use this for development only.");

// Handle SIGTERM signal.
function shutdown(cb) {
  "use strict";

  try {
    server.close(function () {
      process.exit(0);
      if (cb !== undefined) {
        cb();
      }
    });

  } catch (ex) {
    console.log(ex + " while calling server.close)");
  }
}

process.on('SIGTERM', shutdown);
