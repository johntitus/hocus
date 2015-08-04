
var childProcess = require('child_process');

process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

exports.handler = function(event, context) {
	var command = execCommand + " --request='" + JSON.stringify(event) + "'";
	console.log(command);
	childProcess.exec( command, function ( err, stdout, stderr ){
		if ( err ){
			console.log(stderr);
			context.fail( stderr );
		} else {
			console.log( stdout );
			context.succeed( JSON.parse(stdout) );
		}
	})
};