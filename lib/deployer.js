var aws4 = require("aws4");
var AWS = require("aws-sdk")
var request = require("request");
var _ = require("underscore");
var async = require("async");
var mkdirp = require('mkdirp');
var fs = require('fs-extra');
var archiver = require('archiver');
var path = require('path');

var deployer = {};

module.exports = deployer;

var ApiGatewayRequest = function( apiGatewayRequestOptions, awsCredentials, callback ){
	
	var awsOptions = {
		host: 'apigateway.' + awsCredentials.regionName + '.amazonaws.com', 
		path: apiGatewayRequestOptions.path,
		method : apiGatewayRequestOptions.method
	};

	if ( typeof apiGatewayRequestOptions.body !== 'undefined' ){
		awsOptions.body = JSON.stringify( apiGatewayRequestOptions.body );
	}

	aws4.sign(awsOptions, {
		accessKeyId: awsCredentials.awsAccessKey, 
		secretAccessKey: awsCredentials.awsSecretAccessKey
	});

	var requestOptions = {
		'uri' : 'https://apigateway.' + awsCredentials.regionName + '.amazonaws.com' + apiGatewayRequestOptions.path,
		'method' : apiGatewayRequestOptions.method
	};

	var opts = _.extend(requestOptions, awsOptions);	
	
	request( opts, function( err, resp, body ){
		if ( err ) {
			callback( err );
		} else {
			if ( resp.statusCode > 399 ){
				console.log(resp.statusCode);
				console.log( body );
			}
			if ( typeof body !== 'undefined' && body.length > 0 ){
				callback( null, resp, JSON.parse( body ) );
			} else {
				callback( null, resp );
			}
		}
	});
};



deployer.deployController = function( environmentConfig, controllerName, controllerConfig, directoryPath, indexCommand, isUpdate, awsCredentials, callback ){
	AWS.config.update({
		accessKeyId: awsCredentials.awsAccessKey,
		secretAccessKey : awsCredentials.awsSecretAccessKey,
		region : awsCredentials.regionName
	});
	// Create a temp folder to store the zip until upload is complete
	mkdirp.sync('./temp');	
	
	var outZip = fs.createWriteStream('./temp/lambda.zip' )

	var archive = archiver.create('zip',{});
	archive.append( indexCommand, { name: 'index.js' } );

	// Zip the controller directory, but inside the zip put it in a '/run' subdirectory.
	archive.directory('./controllers/' + controllerName, '/run' );
	archive.pipe( outZip );
	archive.finalize();
	
	outZip.on('close', function(){
		
		var lambda = new AWS.Lambda();

		var params = {
			FunctionName: 'hocus_' + environmentConfig.id + '_controller_' + controllerName,
		};

		if ( isUpdate ){
			console.log('updating controller ' + controllerName);
			params[ "ZipFile" ] = fs.readFileSync('./temp/lambda.zip');

			lambda.updateFunctionCode(params, function(err, data) {
				if (err) callback( err ); // an error occurred
				else  {
					//need to store controller details
					console.log('\t deployed controller: '.green + controllerName );
					controllerConfig.data = data;
					callback( null, controllerConfig );
				}
			});
		} else {
			console.log('deploying new controller ' + controllerName);
			params[ "Handler" ] = "index.handler";
			params[ "Role" ] = environmentConfig.roleArn;
			params[ "Runtime" ] = "nodejs";
			params[ "Code" ] = { 
				ZipFile: fs.readFileSync('./temp/lambda.zip')
			};
			
			lambda.createFunction(params, function(err, data) {
				if (err) callback( err ); // an error occurred
				else  {
					//need to store controller details
					console.log('\t deployed controller: '.green + controllerName );
					controllerConfig.data = data;
					callback( null, controllerConfig );
				}
			});
		}
	});	
};


/**
 * Create a new API in the AWS API Gateway.
 *
 * @param {string} apiName
 * @param {object} awsCredentials AWS credentials
 * @param {function} callback Function callback with signature (err, apiId)
 */
deployer.createApi = function( apiName, awsCredentials, callback ){
		
	var apiGatewayRequestOptions = {
		method : 'POST',
		path : '/restapis',
		body : { name : apiName }
	};

	var apiConfig = {};

	AWS.config.update({
		accessKeyId: awsCredentials.awsAccessKey,
		secretAccessKey : awsCredentials.awsSecretAccessKey,
		region : awsCredentials.regionName
	});

	// Send request to AWS API Gateway to create a new API.
	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, function (err, resp, data){

		if (err) callback( err );

		// AWS responds with 201 status code if API created successfully.
		if (resp.statusCode > 399){ // API not created
			var error = {
				statusCode : resp.statusCode
			};
			if (resp.statusCode === 403){ // Forbidden. Credentials aren't allowed to create an API.
				error.message = 'Your credentials do not have access to create a new API in the AWS API Gateway.';
			} else { // General error catch-all. See error.data for AWS error information.
				error.message = 'An error occured creating a new AWS API Gateway.';
			}
			error.data = data;
			callback( error );
		} else { // Successfully created API
			//console.log( data );
			apiConfig.id = data.id;

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
			    },		        
		        {
		            "Effect": "Allow",
		            "Action": [
		                "lambda:InvokeFunction"
		            ],
		            "Resource": ["*"]
		        }
			  ]
			};	
			var policyParams = {
				PolicyDocument : JSON.stringify( policy ),
				PolicyName : policyName,
				Description : 'Auto created policy to exec lambda by hocus for app ' + appConfig.id
			}	
			
			iam.createPolicy(policyParams, function(err, data) {
				if (err) callback( err ); // an error occurred
				else {
					console.log('\t created new policy to allow Lambda execution: '.green + policyName);

					appConfig[policyName] = data.Policy.Arn;
										
					var assumeRole = {
		               "Version" : "2012-10-17",
		               "Statement": [ {
		                  "Effect": "Allow",
		                  "Principal": {
		                     "Service": ["lambda.amazonaws.com","apigateway.amazonaws.com"]
		                  },
		                  "Action": "sts:AssumeRole"
		               } ]
		            };

		            var roleName = 'hocus_' + appConfig.id + '_ExecLambdaRole';
					var params = {
						AssumeRolePolicyDocument: JSON.stringify( assumeRole ),
						RoleName: roleName
					};
					iam.createRole(params, function(err, data) {
						if (err) callback( err ); // an error occurred
						else  {
							console.log( data );
							console.log('\t created new Role to allow Lambda execution: '.green + roleName);
							appConfig['roleName'] = roleName;
							appConfig['roleArn'] = data.Role.Arn;

							var params = {
								PolicyArn: appConfig[policyName], /* required */
								RoleName: roleName /* required */
							};
							iam.attachRolePolicy(params, function(err, data) {
								
								if (err) callback( err ); // an error occurred
								else  {
									console.log('\t attached Policy to Role '.green);
									callback( null, appConfig );
								}
							});
						}
					});
				}
			});
		}
	});
};

deployer.getRootRoute = function( apiId, awsCredentials, callback ){
	deployer.getApiRoutes( apiId, awsCredentials, function( err, routes ){
		if ( err ) callback( err );
		else {
			callback( null, getRootRoute( routes ) );
		}
	})
}

deployer.getApiRoutes = function( apiId, awsCredentials, callback ){
		
	var apiGatewayRequestOptions = {
		method : 'GET',
		path : '/restapis/' + apiId + '/resources'
	};

	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, function( err, resp, body ){
		if ( err ){
			console.log('error calling ApiGatewayRequest')
			callback( err );
		} else {

			var item = body._embedded.item;
			var routes = ( _.isArray( item ) ) ? item : [ item ];
			for ( var i = 0, len = routes.length; i < len; i++ ){
				delete routes[i]._links;
			}
			callback( null, routes );
		}
	});	
};

deployer.deleteRoute = function( apiId, routeId, awsCredentials, callback ){
	
	var apiGatewayRequestOptions = {
		method : 'DELETE',
		path : '/restapis/' + apiId + '/resources/' + routeId
	};
	//console.log( routeId );
	
	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, function( err, resp, body ){	
		console.log('');
		console.log('done with ' + routeId);

		if ( err ) {
			console.log("*****************************************");
			console.log( resp.statusCode );
			console.log( routeId );
			callback( err );
		} else {
			if (resp.statusCode > 399 ){
				console.log("*****************************************");
				console.log( resp.statusCode );
				console.log( routeId );
				callback( body );
			} else {
				console.log("no err");
				console.log(routeId)
				callback( null );
			}
		}
	});

};

deployer.deleteExistingRoutes = function( apiId, awsCredentials, callback ){
	deployer.getApiRoutes( apiId, awsCredentials, function( err, routes ){
		if ( err ){
			callback( err );
		} else {
			console.log( routes );
			// Remove the root route so we don't try and delete it.
			var routes = _.filter( routes, function( route ){
				return (route.path != "/");
			});
			//console.log( routes );
			async.each( routes, function(route, deleteDone){

				deployer.deleteRoute( apiId, route.id, awsCredentials, deleteDone );
			}, function( err ){
				if ( err ) callback( err );
				callback( null );
			});

		}
	});
};

deployer.updateRoutes = function( apiId, routes, awsCredentials, callback ){
		
	if ( typeof routes === 'undefined' ){
		callback( 'No routes defined.' );
	} else {

		deployer.deleteExistingRoutes( apiId, awsCredentials, function( err ){
			if ( err ) {
				callback( err );
			} else {
				console.log( routes );
				callback( null, 'done');
			}
		});
	}
};

deployer.createIntegration = function( apiId, resourceId, method, controllerName, awsCredentials, callback ){
	console.log("creating intregration for: " + controllerName );
	var appRoot = findAppRoot();

	var lambdaConfig = require( appRoot + "/.hocus/config/controllers/" + controllerName + "/config.json");

	var apiGatewayRequestOptions = {
		method : "PUT",
		path : "/restapis/" + apiId + "/resources/" + resourceId + "/methods/" + method.toUpperCase() + "/integration",
		body : {
			type : "AWS",
			httpMethod : method.toUpperCase(),
			uri : "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/" + lambdaConfig.data.FunctionArn +"/invocations",
			credentials : lambdaConfig.data.Role
		}
	};
	console.log("******************")
	console.log(apiGatewayRequestOptions)
	console.log("******************")
	console.log("")
	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, function( err, resp, body ){
		if ( err ) callback( err );
		else{
			console.log("got response from put integration");
			console.log("status Code: " + resp.statusCode);
			console.log( body );
			callback( null, body );
		}
	});
};

deployer.putMethodResponse = function( apiId, resourceId, method, statusCode, awsCredentials, callback ){
	var apiGatewayRequestOptions = {
		method : "PUT",
		path : "/restapis/" + apiId + "/resources/" + resourceId + "/methods/" + method.toUpperCase() + "/responses/" + statusCode,
		body : {
			statusCode : statusCode
		}
	};
	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, callback );
};

deployer.putIntegrationResponse = function( apiId, resourceId, method, statusCode, awsCredentials, callback ){
	/*
	var apiGatewayRequestOptions = {
		method : "PUT",
		path : "/restapis/" + apiId + "/resources/" + resourceId + "/methods/" + method.toUpperCase() + "/integration/responses/" + statusCode,
		body : {
			statusCode : statusCode
		}
	};
	*/
	var apiGatewayRequestOptions = {
		method : "PUT",
		path : "/restapis/" + apiId + "/resources/" + resourceId + "/methods/" + method.toUpperCase() + "/integration/responses/" + statusCode,
		body : {
			responseTemplates : {
				"application/json" : null
			}
		}
	};
	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, callback );
};

deployer.createMethod = function( apiId, resourceId, method, parameters, awsCredentials, callback ){
	//console.log( resourceId );
	//console.log("")
	//console.log( method );
	//console.log( parameters );

	var apiGatewayRequestOptions = {
		method : "PUT",
		path : "/restapis/" + apiId + "/resources/" + resourceId + "/methods/" + method.toUpperCase(),
		body : {
			apiKeyRequired : false,
			authorizationType : "NONE"
		}
	};

	//console.log( apiGatewayRequestOptions );
	
	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, function( err, resp, body ){	
		if ( err ) {
			console.log( 'error putting a method to a resource');
			console.log( err );
			callback( err );
		} else {
			if (resp.statusCode > 399 ){
				callback( body );
			} else {
				console.log("created method " + method);

				if ( typeof parameters.controller !== "undefined" ){

					deployer.putMethodResponse( apiId, resourceId, method, "200", awsCredentials, function( err, resp, body ){
						if ( err ){
							console.log("error creating method response");
							console.log( err );
							callback( err );
						} else {
							console.log("created method response of 200 for " + method);

							// Update lambda permission
							
							deployer.createIntegration( apiId, resourceId, method, parameters.controller, awsCredentials, function( err, resp, body ){
								if ( err ){
									console.log( "error creating integration response" );
									console.log( err );
									callback( err );
								} else {
									console.log("created integration " + method);
									deployer.putIntegrationResponse( apiId, resourceId, method, "200", awsCredentials, function( err, resp, body ){
										if ( err ){
											console.log( "error creating integration response " );
											console.log( err );
											callback( err );
										} else {
											console.log( body );
											console.log("created integration response of 200 for " + method);
											callback( null, resp, body);
										}
									});
								}
							});
							

							
						}
					});
						
				} else {
					console.log('done creating method');
					callback( null, resp, body );
				}
			}
		}
	});
};

deployer.createMethods = function( apiId, route, awsCredentials, callback ){
	//console.log( route.id );
	var methods = getMethods( route );
	async.each( methods, function( method, done ){
		deployer.createMethod( apiId, route.id, method, route[method], awsCredentials, done );
	}, callback );
};

deployer.createResource= function( apiId, path, parentId, awsCredentials, callback ){
	var apiGatewayRequestOptions = {
		method : 'POST',
		path : '/restapis/' + apiId + '/resources/' + parentId,
		body :  { pathPart : path }
	};
	
	ApiGatewayRequest( apiGatewayRequestOptions, awsCredentials, function( err, resp, body ){	
		if ( err ) {
			callback( err );
		} else {
			if (resp.statusCode > 399 ){
				callback( body );
			} else {
				callback( null, resp, body );
			}
		}
	});
};

deployer.createResources = function( apiId, rootResource, basePath, paths, awsCredentials, callback ){
	
	var routes = [];

	// Turn a path into a clean, friendly fullPath
	_.each( paths, function( value, entry ){
		var fullPath = buildResourcePath( basePath, entry );
		value.fullPath = fullPath;
		//console.log( value );
		routes.push( { id : '', path : fullPath } );
	});


	// Expand the list of paths so that there are no gaps.
	// If route is 
	//    /api/pets/{petId}/owners
	// it cannot be created without first creating
	//    /api/pets/{petId}
	_.each( routes, function( route ){
		var parts = route.path.split("/");
		for ( var i = 1, len = parts.length; i < len; i++ ){
			var shortPath = parts.slice(0, i+1).join("/");
			var existingPath = _.find( routes, { path : shortPath });
			if ( typeof existingPath === "undefined" ){
				routes.push({ id : '', path : shortPath } );
			}
		}
	});

	// Sort the routes, so the parent route is always created first.
	routes.sort( function( a, b ){
		if ( a.path < b.path ){
			return -1;
		}
		return 1;
	});
	
	// Create each route in series, so that the new AWS API Gateway Resource ID can be attached to the route object.
	async.eachSeries( routes, function( route, done ){
		var parentPath = route.path.substring(0, route.path.lastIndexOf("/") );
		var parentRoute = _.find( routes, { path : parentPath } );
		
		// If there is no parent route in the list of  outes, then the parent is the root resource.
		var parentRouteId = ( typeof parentRoute !== "undefined" ) ? parentRoute.id : rootResource.id;
		
		// The 'pathPart' is the end of the url. For instance, if the path is
		//    /api/pets/{petId}/owners
		/// then the pathPart is just
		//    owners
		var pathPart = getPathPart(route.path );
		
		deployer.createResource( apiId, pathPart, parentRouteId, awsCredentials, function( err, resp, body ){
			if ( err ) {
				done( err );
			} else {
				route.id = body.id;
				//console.log( route );
				var path = _.find( paths, { fullPath : route.path } );
				if ( typeof path !== "undefined" ){
					path.id = route.id;
					if ( hasMethods( path )){						
						deployer.createMethods( apiId, path, awsCredentials, function( err, resp, body ){
							done( err );
						});
					}
				} else {
					done();
				}
			}
		});
	}, callback );	
};


var getMethods = function( route ){
	return _.filter( _.keys( route ), function( method ){
		var httpMethods = [ "GET", "POST", "PUT", "DELETE", "HEAD" ];
		return (httpMethods.indexOf( method.toUpperCase() ) > -1)
	});
}

var hasMethods = function( route ){
	return ( getMethods(route).length > 0 );
}

var getPathPart = function( path ){
	return path.substring( path.lastIndexOf("/") + 1);
}

var findParentRouteId = function( path, routes ){
	var parent = _.find( routes, { path : path } );
	return parent.id
}


var buildResourcePath = function( basePath, resourcePath ){
	var basePath = ( typeof basePath === "undefined" ) ? "" : basePath;
	var base = trimSlashes( basePath );
	if ( base !== "" ){
		base = "/" + base;
	}
	var result = trimTrailingSlashes( base + "/" + trimSlashes( resourcePath ) );
	if ( result === "" ){
		result = "/";
	}
	return result;
};

var trimSlashes = function( path ){
	return path.replace(/^\/|\/$/g, '');
};

var trimTrailingSlashes = function( path ){
	return path.replace(/\/+$/, "");
}

var getRootRoute = function( routes ){
	return _.find( routes, function( route ){
		return (route.path === "/");
	});
};

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
var atAppRoot = function(currPath){
	var lookup = path.join( currPath, '.hocus/app.json');
	return fs.existsSync(lookup);
}