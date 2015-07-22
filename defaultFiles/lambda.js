console.log('Loading function');

exports.handler = function(event, context) {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    context.succeed();
};