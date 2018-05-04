const { dependencies, endpoints, environment, expressions, imports, schema } = program;

program.name = 'github';

environment
  .add('ACCESS_TOKEN', 'An access token')

endpoints
  .https('webhook', 'A webhook endpoint to receive notifications from Github')

expressions
  .add('url', '^https?://github.com/.+$')

schema.type('Root')
  .field('repos', 'RepositoryCollection')

schema.type('RepositoryCollection')
  .computed('one', 'Repository')
    .param('owner', 'String')
    .param('name', 'String')
  .computed('page', 'RepositoryPage')
    .param('q', 'String')
    .param('sort', 'String')
    .param('order', 'String')
    .param('page', 'Int')
    .param('pageSize', 'Int')

schema.type('RepositoryPage')
  .computed('items', '[Repository]')
  .computed('next', 'RepositoryPage*')

schema.type('Repository')
  .computed('self', 'Repository*')
  .field('name', 'String')
  .computed('issues', 'IssueCollection')

schema.type('IssueCollection')
  .computed('one', 'Issue')
    .param('number', 'Int')
  .computed('page', 'IssuePage')
    .param('filter', 'String') // TODO: shold be enum
    .param('state', 'String')
    .param('labels', 'String')
    .param('sort', 'String')
    .param('direction', 'String')
    .param('since', 'String')
    .param('page', 'Int')
    .param('pageSize', 'Int')

schema.type('IssuePage')
  .computed('items', '[Issue]')
  .computed('next', 'IssuePage*')

schema.type('Issue')
  .computed('self', 'Issue*')
  .field('number', 'Int')
  .field('title', 'String')

