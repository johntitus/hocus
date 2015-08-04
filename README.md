# Hocus
The magical NoOps development framework.

Hocus is a development framework that takes away the pain of managing servers, and databases, and everything else for that matter.
## Status
Very much in active/breaking development.

## Installation
Hocus is still in active/breaking development mode, so installation isn't pretty at the moment.

1) Clone this repo.
    
    `git clone git@github.com:johntitus/hocus.git`
2) Change into the Hocus directory

    `cd hocus`
3) Link the binary

    `npm link`

## Commands
`hocus configure`

Set up your AWS credentials & region. Stores in `~/home/.hocus/credentials.json`

`hocus new [application name]`

Creates a new hocus app. Working, but directory structure may change.

`hocus generate controller [controller name]`

Creates a new controller. The new controller will be an example controller that is ready to be deployed to AWS Lambda. Working, but syntax may change.

`hocus generate model [model name] [..attributes..]`

Creates a new model - which means a new Dynamo table. Not yet implemented.

`hocus generate scaffold [resource name]`

Creates a model in dynamo, a controller, and a view. Also edits the `routes.json` file to link everything together. Not yet implemented.

`hocus deploy [stage]`

Deploys everything to AWS.
Controllers go to AWS Lambda.
Models go to Dynamo.
Routes.json turns into a new API in the AWS API Gateawy.
Currently puts everything into a "dev" environment.