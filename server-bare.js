'use strict';

var fs = require('fs');
var nodeStatic = require('node-static');
var https = require('https');

const HTTPS_PORT = 8080;
const serverConfig = {
  key:  fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

var fileServer = new(nodeStatic.Server)();
https.createServer(serverConfig, function(req, res) {
  fileServer.serve(req, res);
}).listen(HTTPS_PORT);