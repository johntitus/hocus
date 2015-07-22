#! /usr/bin/env node

var program = require('commander');
var prompt = require('prompt');

var actions = require('./lib/actions');

program
    .version('0.0.1')
    .command('new [name]')
    .description('create a new hocus app')
    .action( actions.new );

program
    .command('configure')
    .description('configure your AWS access and settings')
    .action( function(){
        var schema = {
            properties : {
                'profile' : {
                    require : true,
                    default : 'default',
                    description : 'Profile Name:'.cyan
                },
                'awsAccessKey' : {
                    required : true,
                    pattern : /^[a-zA-Z0-9]{20}$/, // 20 alphanumeric characters
                    description: 'AWS Access Key ID:'.cyan,
                    message: 'That does not seem to be a valid AWS Access Key.'
                },
                'awsSecretAccessKey' : {
                    required : true,
                    pattern : /^[a-zA-Z0-9/+=]{40}$/, // 40 base64 characters
                    description: 'AWS Secret Access Key:'.cyan,
                    message: 'That does not seem to be a valid AWS Secret Access Key.'
                },
                'regionName' :{
                    default : 'us-east-1',
                    description: 'Default Region Name:'.cyan,
                    message : 'Must be one of us-east-1, us-west-2, or eu-west-1. Default is us-east-1.',
                    conform : function( value ){
                        var validRegions = [
                            'us-east-1',
                            'us-west-2',
                            'eu-west-1'
                        ];
                        return (validRegions.indexOf(value) > -1);
                    }
                }
            }
        }

        prompt.message = '';
        prompt.delimiter = '';
        prompt.start();
        prompt.get(schema, function(err, result){
            actions.configure(result);
        });
    });

program.command('generate model', 'generate a model');
program.command('delete model', 'delete a model');

program.command('generate controller', 'generate a controller');

program
    .command('test')
    .action( actions.test );

program.parse(process.argv);