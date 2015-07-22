var osenv = require('osenv');
var colors = require('colors');
var aws4  = require('aws4');
var AWS = require('aws-sdk');
var request = require('request');
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var archiver = require('archiver');

var home = osenv.home();
var credentialsFile = home + '/.hocus/credentials.json';

var credentials = JSON.parse(fs.readFileSync(credentialsFile)).default;
	
AWS.config.update({
	accessKeyId: credentials.awsAccessKey,
	secretAccessKey : credentials.awsSecretAccessKey,
	region : credentials.regionName
});

var hocusPath = path.resolve(__dirname + '/..');

var actions = {};

actions.deleteModel = function(modelName){
	

	var params = {
		TableName : 'hocus_' + modelName		
	};
	
	var dynamodb = new AWS.DynamoDB();
	dynamodb.deleteTable( params, function( err, data ){
		if ( err ) throw err;
		
		fs.unlinkSync('./config/models/' + modelName + '.json');
		
		fs.unlinkSync('./models/'+ modelName + '.json');

		console.log('    deleted model: '.green + modelName.green );
	});
};

actions.test = function( callback ){
	var policyName = 'hocus_ExecLambdaPolicy';

	/*
	* ISSUE:
	* The code below is forced to be run at the app root directory.
	* Refactor to  walk up proccess.cwd() until it finds the app config?
	*/

	var appConfig = require(process.cwd() + '/.hocus/appConfig.json');
	console.log( appConfig );

	if ( typeof appConfig[policyName] === 'undefined' ){

		var iam = new AWS.IAM();
		
		var policy = {
		  "Version": "2012-10-17",
		  "Statement": [
		    {
		      "Effect": "Allow",
		      "Action": [
		        "logs:*"
		      ],
		      "Resource": "arn:aws:logs:*:*:*"
		    }
		  ]
		};	
		var policyParams = {
			PolicyDocument : JSON.stringify( policy ),
			PolicyName : policyName,
			Description : 'Auto created policy to exec lambda by hocus'
		}	
		
		iam.createPolicy(policyParams, function(err, data) {
			if (err) console.log(err, err.stack); // an error occurred
			else {
				
				appConfig[policyName] = data.Policy.Arn;
				fs.writeFileSync( process.cwd() + '/.hocus/appConfig.json', JSON.stringify( appConfig, null, 4) );


				var assumeRole = {
	               "Version" : "2012-10-17",
	               "Statement": [ {
	                  "Effect": "Allow",
	                  "Principal": {
	                     "Service": [ "ec2.amazonaws.com" ]
	                  },
	                  "Action": [ "sts:AssumeRole" ]
	               } ]
	            };

				var params = {
					AssumeRolePolicyDocument: JSON.stringify( assumeRole ),
					RoleName: 'hocus_ExecLambdaRole'
				};
				iam.createRole(params, function(err, data) {
					if (err) console.log(err, err.stack); // an error occurred
					else  {
						console.log( 'role created successfully' );
						var params = {
							PolicyArn: appConfig[policyName], /* required */
							RoleName: 'hocus_ExecLambdaRole' /* required */
						};
						iam.attachRolePolicy(params, function(err, data) {
							if (err) console.log(err, err.stack); // an error occurred
							else     console.log(data);           // successful response
						});
					}
				});
			}
		});
	}
	
};

actions.generateController = function(controllerName){
	/*
	var params = {
		Code: { 
			ZipFile: new Buffer('...') || 'STRING_VALUE'
		},
		FunctionName: 'hocus_controller_' + controllerName,
		Handler: 'index.handler', 
		Role: 'STRING_VALUE', 
		Runtime: 'nodejs', 
	};
	lambda.createFunction(params, function(err, data) {
		if (err) console.log(err, err.stack); // an error occurred
		else     console.log(data);           // successful response
	});
	*/
	mkdirp('./controllers/' + controllerName);
	fs.writeFileSync('./controllers/' + controllerName +'/lambda.js', fs.readFileSync( hocusPath + '/defaultFiles/lambda.js').toString() );
	console.log('\t created controller: '.green + controllerName );
	var archive = archiver.create('zip',{});
	archive = archiver.directory('./controllers/' + controllerName );
	archive.finalize();

	var params = {
		Code: { 
			ZipFile: archive
		},
		FunctionName: 'hocus_controller_' + controllerName,
		Handler: 'index.handler', 
		Role: 'STRING_VALUE', 
		Runtime: 'nodejs', 
	};
	lambda.createFunction(params, function(err, data) {
		if (err) console.log(err, err.stack); // an error occurred
		else     console.log(data);           // successful response
	});
	
};

actions.generateModel = function(modelName,attributes){
	var credentials = JSON.parse(fs.readFileSync(credentialsFile)).default;
	
	AWS.config.update({
		accessKeyId: credentials.awsAccessKey,
		secretAccessKey : credentials.awsSecretAccessKey,
		region : credentials.regionName
	});
	
	var params = {
		TableName : 'hocus_' + modelName,
		AttributeDefinitions : [
			{ 
				AttributeName : 'hocus_id',
				AttributeType : 'S'
			}
		],
		KeySchema : [
			{
				AttributeName : 'hocus_id',
				KeyType : 'HASH'
			}
		],
		ProvisionedThroughput: {
			ReadCapacityUnits: 5,
			WriteCapacityUnits: 5
		}
	};
	
	var dynamodb = new AWS.DynamoDB();
	dynamodb.createTable( params, function( err, data ){
		if ( err ) throw err;

		/* Store the AWS config for the DynamoDB table in config/models/{modelName}.json */
		var model = {
			tableName : data.TableDescription.TableName,
			tableARN : data.TableDescription.TableArn,
			tableCreated : data.TableDescription.CreationDateTime,
			tableCapacity : {
				readUnits : data.TableDescription.ProvisionedThroughput.ReadCapacityUnits,
				writeUnits : data.TableDescription.ProvisionedThroughput.WriteCapacityUnits,
			}
		}
		mkdirp('./config/models');
		fs.writeFileSync('./config/models/' + modelName + '.json', JSON.stringify(model, null, 4));

		/* Store the json schema for the model in models/{modelName}.json */
		var schema = {
			"title" : modelName + ' schema',
			"type" : "object",
			"properties" : {
				"hocus_id" : {
					"description" : "A UUID generated by hocus. Don't delete it.",
					"type" : "string"
				}
			},
			"required" : []
		};

		if ( typeof attributes !== 'undefined' ){
			attributes.forEach( function( attribute ){
				if ( attribute.indexOf(':') > -1 ){
					var pieces = attribute.split(':');
					schema.properties[ pieces[0] ] = {
						"type" : pieces[1]
					}
				} else {
					schema.properties[ attribute ] = {
						"type" : "string"
					}
				}
			});
		}
		fs.writeFileSync('./models/'+ modelName + '.json', JSON.stringify(schema, null, 4));


		console.log('    created new model: '.green + modelName.green );
	});

};

actions.configure = function(data){	
     
	mkdirp.sync(home + '/.hocus');

	
	var credentials = {};
    
    if (fs.existsSync(credentialsFile)){
    	credentials = JSON.parse(fs.readFileSync(credentialsFile));
    }
    var profile = data.profile;
    delete data.profile;

    credentials[ profile ] = data;

	fs.writeFileSync(home + '/.hocus/credentials.json', JSON.stringify(credentials, null, 4));
	console.log('Hocus configuration complete.'.green);
    
};

actions.new = function(appName){
	var home = osenv.home();
    var credentialsFile = home + '/.hocus/credentials.json';
    if (fs.existsSync(credentialsFile)){
		var credentials = JSON.parse(fs.readFileSync(credentialsFile)).default; 

		/* Create a new API on AWS API Gateway */
		var opts = {
			host: 'apigateway.us-east-1.amazonaws.com', 
			path: '/restapis',
			body : JSON.stringify({
				name : 'hocus_' + appName
			})
		};

		aws4.sign(opts, {
			accessKeyId: credentials.awsAccessKey, 
			secretAccessKey: credentials.awsSecretAccessKey
		});

		request.post('https://apigateway.us-east-1.amazonaws.com/restapis', opts, function (err, resp, body){
			if (err) throw err;

			var data = JSON.parse(body);

			if (resp.statusCode > 399){
				console.log(resp.statusCode);
				if (resp.statusCode === 403){
					console.log('Your credentials do not have access to create a new API in the AWS API Gateway.'.red);
				} else {
					console.log('An error occured creating a new AWS API Gateway.');
				}
				console.log('AWS Response was: ');
				console.log(data);
				console.log('');
				console.log('Hocus app not created.'.red)
			} else {								

				var appConfig = {
					name : data.name,
					id : data.id,
					createdDate: data.createdDate
				};

				console.log('\t created new API in AWS API Gateway with ID: '.green + appConfig.id);          

				/* Create folder structure for the app */
				var rootDir = (typeof appName === 'undefined') ? '.' : appName;

				console.log('\t create'.green);

				mkdirp.sync(rootDir + '/models');
				console.log('\t create'.green + ' models');

				mkdirp.sync(rootDir + '/views');
				console.log('\t create'.green + ' views');

				mkdirp.sync(rootDir + '/controllers');
				console.log('\t create'.green + ' controllers');

				mkdirp.sync(rootDir + '/public');
				console.log('\t create'.green + ' public');

				fs.writeFileSync(rootDir + '/public/404.html', fs.readFileSync( hocusPath + '/defaultFiles/404.html') );
				console.log('\t create'.green + ' public/404.html');

				fs.writeFileSync(rootDir + '/public/404.html', fs.readFileSync( hocusPath + '/defaultFiles/robots.txt') );
				console.log('\t create'.green + ' public/robots.txt');

				mkdirp.sync(rootDir + '/config');
				console.log('\t create'.green + ' config');

				fs.writeFileSync(rootDir + '/config/app.json', JSON.stringify( appConfig, null, 4 ) );
				console.log('\t create'.green + ' config/app.json');
				
				fs.writeFileSync(rootDir +'/config/routes.json', JSON.stringify( require(hocusPath + '/defaultFiles/routes.json'), null, 4  ) );
				console.log('\t create'.green + ' config/routes.json');

				mkdirp.sync(rootDir + '/config/environments');
				console.log('\t create'.green + ' config');

				console.log('Hocus app created.'.green);
			}
		});      
	} else {
		console.log('You need to run ' + 'hocus configure'.blue + ' before you can do this.');
	}
};

module.exports = actions;