/**
 * Barebones https fileserver to use with Janus Gateway
 * All we do here is tell node to statically serve the files
 * from this directory
 * 
 * You can run this with: node fileserver.js 
 * or: npm start
 */

'use strict';
var fs = require('fs');
var nodeStatic = require('node-static');
var https = require('https');

// Change to modify the default port for the fileserver:
const HTTPS_PORT = 8080;

const serverConfig = {
  key:  fs.readFileSync('conf/mycert.key'),
  cert: fs.readFileSync('conf/mycert.pem'),
};

var fileServer = new(nodeStatic.Server)();
https.createServer(serverConfig, function(req, res) {
  fileServer.serve(req, res);
}).listen(HTTPS_PORT);
