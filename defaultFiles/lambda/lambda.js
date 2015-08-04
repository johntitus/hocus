#!/usr/bin/env node

/* 
// Demo Hocus Controller 
// 
// Hocus controllers work by processing stdin and generate responses via stdout.
// While this particular controller is written in Node.js, you can write your controller in whatever language you want.
//
// Controller Input
//
// You can configure how Hocus calls your controller by modifying the 'executeCommand' in .hocus/config/controllers/your_controller.json.
// Your controller is always called with the request as the last option:
//
// executeCommand --request=JSON_STRINGIFIED_REQUEST
//
// Controller Output
// 
// Whatever you write to stdout is what will be sent back as the response.
*/

var argv = require('minimist')(process.argv.slice(2));
var request = JSON.parse(argv.request);

var response = {};

console.log(JSON.stringify( response ));

process.exit(0);