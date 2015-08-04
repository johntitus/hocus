var osenv = require('osenv');
var colors = require('colors');
var fs = require('fs-extra');
var mkdirp = require('mkdirp');
var path = require('path');
var async = require("async");

var deployer = require( "./deployer" );

var hocusPath = path.resolve(__dirname + '/..');
var userHome = osenv.home();
var credentialsFile = userHome + '/.hocus/credentials.json';

var actions = {};

/**
 * Create a new Hocus app folder structure.
 *
 * @param {string} name
 */
actions.new = function( name ){

	// Exit if no 'name' provided.
	if ( typeof name === 'undefined' ){
		console.log('\t Usage: hocus new [application name].'.red)
		return;
	}

	var appConfig = {
		name : name
	};

	/* Create folder structure for the app */
	var rootDir = appConfig.name;
	logCreated( name );

	mkdirp.sync(rootDir + '/models');
	logCreated( name + "/models")

	mkdirp.sync(rootDir + '/views');
	logCreated( name + "/views")

	mkdirp.sync(rootDir + '/controllers');
	logCreated( name + "/controllers")

	mkdirp.sync(rootDir + '/public');
	logCreated( name + "/public")

	fs.writeFileSync(rootDir + '/public/404.html', fs.readFileSync( hocusPath + '/defaultFiles/404.html') );
	logCreated( name + "/public/404.html")

	fs.writeFileSync(rootDir + '/public/robots.txt', fs.readFileSync( hocusPath + '/defaultFiles/robots.txt') );
	logCreated( name + "/public/robots.txt")

	fs.writeFileSync(rootDir +'/routes.json', JSON.stringify( require(hocusPath + '/defaultFiles/routes.json'), null, 4  ) );
	logCreated( name + "/routes.json")

	mkdirp.sync(rootDir + '/.hocus');
	logCreated( name + "/.hocus")

	fs.writeFileSync(rootDir + '/.hocus/app.json', JSON.stringify( appConfig, null, 4 ) );
	logCreated( name + "/.hocus/app.json")
	
	mkdirp.sync(rootDir + '/.hocus/environments');
	logCreated( name + "/.hocus/environments")

	mkdirp.sync(rootDir + '/.hocus/environments/dev');
	logCreated( name + "/.hocus/environments/dev")

	mkdirp.sync(rootDir + '/.hocus/environments/test');
	logCreated( name + "/.hocus/environments/test")

	mkdirp.sync(rootDir + '/.hocus/environments/production');
	logCreated( name + "/.hocus/environments/production")

	fs.writeFileSync(rootDir +'/.gitignore', fs.readFileSync( hocusPath + '/defaultFiles/.gitignore') );
	logCreated( name + "/.gitignore")

	console.log('Hocus app created.'.green);
};

/**
 * Deploy the Hocus app to AWS in the environment specified.
 * Default environment is 'dev'.
 *
 * @param {string} [environment='dev']
 */
actions.deploy = function( environment ){

	var environment = (typeof environment === 'undefined') ? 'dev' : environment;

	var appRoot = findAppRoot(),
		appConfig = findAppConfig();

	// Read in the AWS credentials for the environment being deployed to.
	var credentials = JSON.parse(fs.readFileSync(credentialsFile)).profiles[environment]; 

	// Exit if there are no credentials for this environment.
	if ( typeof credentials === 'undefined' ){
		console.log('\t Could not read credentials for environment: '.red + environment);
		console.log('\t Try running '.red + 'hocus configure'.cyan + ' with a Credential Profile of '.red + environment);
		return;
	}

	// If there is a config.json for this environment, then the app has been deployed to the environment previously.
	var environmentDeployed = fs.existsSync( appRoot + '/.hocus/environments/' + environment + '/config.json');

	// If the app has never been deployed to the environment, we need to do some setup.
	if ( !environmentDeployed ){
		var that = this;

		var apiName = "hocus_" + appConfig.name + "_" + environment;

		deployer.createApi( apiName, credentials, function( err, apiConfig ){
			// If createApi fails, it's usually because the credentials for this environment
			// don't have the right access in AWS.
			if ( err ){
				console.log( err );
				logFailure( 'Error creating API. Deployment failed.' );				
			} else {
				
				logCreated('AWS API Gateway API with id ' + apiConfig.id);

				// If this is a 'non-standard' environment (not dev, test, or production), 
				// we need to create the .hocus/environment folder for it.
				if ( !fs.existsSync( appRoot + '/.hocus/environments/' + environment ) ){
					mkdirp.sync( appRoot + '/.hocus/environments/' + environment );
					logCreated( ' .hocus/environments/' + environment );
				}				

				deployer.getRootRoute( apiConfig.id, credentials, function( err, rootRoute ){
					if ( err ){
						console.log( err );
						logFailure( 'Error creating API. Deployment failed.' );	
					} else {
						apiConfig.rootRoute = rootRoute;
						// Store the environment config.
						fs.writeFileSync( appRoot + '/.hocus/environments/' + environment + '/config.json', JSON.stringify( apiConfig, null, 4 ) );
						console.log('\t wrote ' .green + appConfig.name + '/.hocus/environments/' + environment + '/config.json' );

						// Call actions.deploy again, now that environment is created.
						actions.deploy( environment );
					}
				});

				
			}
		});
	} else { //environment has already been deployed to once
		var routes = require( appRoot + '/routes.json' );

		var environmentConfig = require( appRoot + '/.hocus/environments/' + environment + '/config.json');

		var appRoot = findAppRoot();

		/*
		// DEPLOY controllers
		*/
		var controllerList = getDirectories( appRoot + '/controllers' );
		async.each( controllerList, function( controller, done ){
			var controllerName = controller,
				directoryPath = appRoot + "/controllers/" + controllerName,
				controllerConfig = require( appRoot + '/.hocus/config/controllers/' + controllerName + '.json');

			var main = fs.readFileSync( hocusPath + '/defaultFiles/lambdaMain.js').toString();
			var executeCommand = "var execCommand =  './run/" + controllerConfig.executeCommand + "';";
			var indexCommand = executeCommand + main;

			var isUpdate = fs.existsSync( appRoot + '/.hocus/config/controllers/' + controllerName + '/config.json' );

			deployer.deployController( environmentConfig, controllerName, controllerConfig, directoryPath, indexCommand, isUpdate, credentials, function( err, controllerConfig ){
				if ( err ){
					console.log('error deploying controller ' + controllerName);
					done( err );
				} else {
					//console.log( controllerConfig );
					mkdirp( appRoot  + '/.hocus/config/controllers/' + controllerName );
					fs.writeFileSync(appRoot  + '/.hocus/config/controllers/' + controllerName + '/config.json', JSON.stringify( controllerConfig, null, 4 ) );
					done();
				}				
			});
		}, function( err ) {
			if ( err ){
				console.log( 'error in controllerlist deployment');
				console.log( err );
			} else {
				console.log("done deploying controllers");
				deployer.deleteExistingRoutes( environmentConfig.id, credentials, function( err ){
					if ( err ){
						console.log( err );
					} else {						
						deployer.createResources( environmentConfig.id, environmentConfig.rootRoute, routes.basePath, routes.paths, credentials, function( err ){
							if ( err ) {
								console.log( err );
								logFailure( 'Error updating routes. Deployment failed.' );				
							} else {
								console.log('done')
							}
						});

					}
				});
			}
		});		
		
	}
};

actions.generateController = function(controllerName){
	
	var appRoot = findAppRoot();	
	
	if ( appRoot ){
		
		// Create the controller directory.
		mkdirp.sync( appRoot + '/controllers/' + controllerName );
		console.log('\t created: '.green + 'controllers/' + controllerName );

		// Create the controller config.
		mkdirp.sync( appRoot + '/.hocus/config/controllers/' );
		var controllerConfig = {
			'executeCommand' : 'lambda.js'
		}
		fs.writeFileSync(appRoot + '/.hocus/config/controllers/' + controllerName + '.json', JSON.stringify( controllerConfig, null, 4 ) );
		console.log('\t created: '.green + '.hocus/config/controllers/' + controllerName + '.json');

		fs.copySync( hocusPath + '/defaultFiles/lambda', appRoot + '/controllers/' + controllerName );		

		
	} else {
		console.log('\tCould not find app config.'.red);
	}
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

actions.configure = function(data){	
     
	mkdirp.sync(userHome + '/.hocus');
	
	var credentials = {
		profiles : {}
	};
    
    if (fs.existsSync(credentialsFile)){
    	credentials = JSON.parse(fs.readFileSync(credentialsFile));
    } else {
    	credentials['userName'] = data.userName;
    	delete data.userName;
    }
    var profile = data.profile;
    delete data.profile;

    credentials.profiles[ profile ] = data;

    fs.writeFileSync(userHome + '/.hocus/credentials.json', JSON.stringify(credentials, null, 4));
	console.log('Hocus configuration complete.'.green);
    
};

actions.new2 = function(appName){
	var credentialsFile = home + '/.hocus/credentials.json';
    if (fs.existsSync(credentialsFile)){
		var credentials = JSON.parse(fs.readFileSync(credentialsFile)).default; 

		/* Create a new API on AWS API deployer */
		var opts = {
			host: 'apideployer.us-east-1.amazonaws.com', 
			path: '/restapis',
			body : JSON.stringify({
				name : 'hocus_' + appName
			})
		};

		aws4.sign(opts, {
			accessKeyId: credentials.awsAccessKey, 
			secretAccessKey: credentials.awsSecretAccessKey
		});

		request.post('https://apideployer.us-east-1.amazonaws.com/restapis', opts, function (err, resp, body){
			if (err) throw err;

			var data = JSON.parse(body);

			if (resp.statusCode > 399){
				console.log(resp.statusCode);
				if (resp.statusCode === 403){
					console.log('Your credentials do not have access to create a new API in the AWS API deployer.'.red);
				} else {
					console.log('An error occured creating a new AWS API deployer.');
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

				console.log('\t created new API in AWS API deployer with ID: '.green + appConfig.id);

				// Create the ExecLambda Policy & Role for this app

				var policyName = 'hocus_' + appConfig.id + '_ExecLambdaPolicy';

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
					Description : 'Auto created policy to exec lambda by hocus for app ' + appConfig.id
				}	
				
				iam.createPolicy(policyParams, function(err, data) {
					if (err) console.log(err, err.stack); // an error occurred
					else {
						console.log('\t created new policy to allow Lambda execution: '.green + policyName);

						appConfig[policyName] = data.Policy.Arn;
						//fs.writeFileSync( process.cwd() + '/.hocus/appConfig.json', JSON.stringify( appConfig, null, 4) );

						
						var assumeRole = {
			               "Version" : "2012-10-17",
			               "Statement": [ {
			                  "Effect": "Allow",
			                  "Principal": {
			                     "Service": [ "lambda.amazonaws.com" ]
			                  },
			                  "Action": [ "sts:AssumeRole" ]
			               } ]
			            };
			            var roleName = 'hocus_' + appConfig.id + '_ExecLambdaRole';
						var params = {
							AssumeRolePolicyDocument: JSON.stringify( assumeRole ),
							RoleName: roleName
						};
						iam.createRole(params, function(err, data) {
							if (err) console.log(err, err.stack); // an error occurred
							else  {
								//console.log( data );
								console.log('\t created new Role to allow Lambda execution: '.green + roleName);
								appConfig['roleName'] = roleName;
								appConfig['roleArn'] = data.Role.Arn;

								var params = {
									PolicyArn: appConfig[policyName], /* required */
									RoleName: roleName /* required */
								};
								iam.attachRolePolicy(params, function(err, data) {
									
									if (err) console.log(err, err.stack); // an error occurred
									else  {
										console.log('\t attached Policy to Role '.green);

										var bucketName = 'hocus_' + appConfig.id
										// Create S3 bucket for this app
										var params = {
											Bucket: bucketName
										};
										var s3 = new AWS.S3();
										s3.createBucket( params, function( err, data ){
											if (err) console.log(err, err.stack); // an error occurred
											else {
												console.log('\t created S3 bucket for this app: '.green + 's3://' + bucketName);

												appConfig.bucketName = bucketName;

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
												console.log('\t create'.green + ' config/environments');

												console.log('Hocus app created.'.green);
											}
										});
									}
								});
							}
						});
					}
				});
			}
		});      
	} else {
		console.log('You need to run ' + 'hocus configure'.blue + ' before you can do this.');
	}
};

//http://stackoverflow.com/questions/18112204/get-all-directories-within-directory-nodejs
var getDirectories = function(srcpath) {
  return fs.readdirSync(srcpath).filter(function(file) {
    return fs.statSync(path.join(srcpath, file)).isDirectory();
  });
}

var atAppRoot = function(currPath){
	var lookup = path.join( currPath, '.hocus/app.json');
	return fs.existsSync(lookup);
}

var findAppRoot = function( currPath ){
	var currPath = (currPath) ? currPath : process.cwd();
	if ( atAppRoot( currPath ) ){
		return currPath;
	} else {
		var newPath = path.join( currPath, '../');
		if ( newPath !== currPath ){
			return findAppRoot( newPath );
		} else {
			return null;
		}
	}
}

var findAppConfig = function( currPath ){
	
	var currPath = (currPath) ? currPath : process.cwd();

	//console.log( currPath );

	if ( atAppRoot( currPath ) ){
		return require( path.join( currPath, '.hocus/app.json'));		
	} else {
		var newPath = path.join( currPath, '../');
		if ( newPath !== currPath ){
			return findAppConfig( newPath );
		} else {
			return null;
		}
	};
}

var isCreated = function(){
	var appConfig = findAppConfig();
	return (typeof appConfig.appId !== 'undefined');
};

var logCreated = function( string ){
	console.log('\t created '.green + string);
};

var logFailure = function( string ){
	console.log('\t ' + string.red);
};

module.exports = actions;