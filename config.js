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
  .field('users', 'UserCollection')

schema.type('UserCollection')
  .computed('one', 'User')
    .param('name', 'String')
  .computed('page', 'UserPage')
    .param('since', 'Int')

schema.type('UserPage')
  .computed('items', '[User]')
  .computed('next', 'UserPage*')

schema.type('User')
  .field('name', 'String')
  .field('login', 'String')
  .field('id', 'Int')
  .computed('avatarUrl', 'String')
  .computed('gravatarId', 'String')
  .field('url', 'String')
  .computed('htmlUrl', 'String')
  .computed('followersUrl', 'String')
  .computed('followingUrl', 'String')
  .computed('gistsUrl', 'String')
  .computed('starredUrl', 'String')
  .computed('subscriptionsUrl', 'String')
  .computed('organizationsUrl', 'String')
  .computed('reposUrl', 'String')
  .computed('eventsUrl', 'String')
  .computed('receivedEventsUrl', 'String')
  .field('type', 'String')
  .computed('siteAdmin', 'Boolean')
  .field('name', 'String')
  .field('company', 'String')
  .field('blog', 'String')
  .field('location', 'String')
  .field('email', 'String')
  .field('hireable', 'Boolean')
  .field('bio', 'String')
  .computed('publicRepos', 'Int')
  .computed('publicGists', 'Int')
  .field('followers', 'Int')
  .field('following', 'Int')
  .computed('createdAt', 'String')
  .computed('updatedAt', 'String')

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

