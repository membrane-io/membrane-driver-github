import { client, getDiff, graphql } from './client';
import { parse as parseUrl } from 'url';
import { parse as parseQuery } from 'querystring';
import getPageLinks from '@octokit/rest/lib/plugins/pagination/get-page-links';
const { root } = program.refs;

export async function init() {
  await root.users.set({});

  program.state.repos = {};
  await program.save();
}

export async function parse({ name, value }) {
  switch (name) {
    case "url": {
      const { pathname: path } = parseUrl(value, true);
      const parts = path.split("/");
      // TODO: users
      if (parts.length < 3) {
        return root;
      }
      const repo = root.users
        .one({ name: parts[1] })
        .repos()
        .one({ name: parts[2] });
      if (parts.length >= 4 && parts[3] === 'issues') {
        if (parts.length >= 5) {
          const number = Number.parseInt(parts[4], 10);
          if (!Number.isNaN(number)) {
            return repo.issues.one({ number });
          }
          return repo.issues;
        }
        return repo.issues;
      } else if (parts.length >= 4 && /^pulls?$/.test(parts[3])) {
        if (parts.length >= 5) {
          const number = Number.parseInt(parts[4], 10);
          if (!Number.isNaN(number)) {
            return repo.pullRequests.one({ number });
          }
          return repo.pullRequests;
        }
        return repo.pullRequests;
      }
      return repo;
    }
    case 'repo': {
      const parts = path.split('/');
      return root.users.one({ name: parts[0] }).repos().one({ name: parts[1] });
    }
  }
}

// Generic way to get the next ref for this driver
function getNextPageRef(pageRef, response) {
  const nextLink = getPageLinks(response).next;
  if (!nextLink) {
    return null;
  }
  const { page, since } = parseQuery(parseUrl(nextLink).query);
  if (page !== undefined) {
    return pageRef.ref.withArgs({
      ...pageRef.args,
      page: Number.parseInt(page, 10),
    });
  } else if (since !== undefined) {
    return pageRef.ref.withArgs({
      ...pageRef.args,
      since: Number.parseInt(since, 10),
    });
  }
  console.log("Failed to find next page from link:", nextLink);
  return null;
}

// All param names are the same as Github's but changed to camel-case, this
// function changes back the argument names back to underscores so they can sent
// to the API
function toApiArgs(args, initialValue = {}) {
  return Object.keys(args)
    .filter((key) => args[key] !== undefined)
    .reduce((acc, key) => {
      // Membrane convention
      if (key === "pageSize") {
        acc["per_page"] = args[key];
      } else {
        const apiKey = key.replace(/([A-Z])/g, ($1) => '_' + $1.toLowerCase());
        acc[apiKey] = args[key];
      }
      return acc;
    }, initialValue);
}

export const UserCollection = {
  async one({ args }) {
    const { name: username } = args;
    const result = await client.users.getForUser({ username });
    return result.data;
  },
  async page({ self, args }) {
    const apiArgs = toApiArgs(args);
    const res = await client.users.getAll(apiArgs);

    return {
      items: res.data,
      next: getNextPageRef(self.page(args), res)
    };
  },
};

export const User = {
  self({ self, parent, source }) {
    return parent.parent.parent.one({ name: source.login });
  },
  avatarUrl({ source }) {
    return source['avatar_url'];
  },
  gravatarId({ source }) {
    return source['gravatar_id'];
  },
  siteAdmin({ source }) {
    return source['site_admin'];
  },
  publicRepos({ source }) {
    return source['public_repos'];
  },
  publicGists({ source }) {
    return source['public_gists'];
  },
  createdAt({ source }) {
    return source['created_at'];
  },
  updatedAt({ source }) {
    return source['updated_at'];
  },
  repos() {
    return {};
  },
};

export const RepositoryCollection = {
  async one({ self, args }) {
    const { name: repo } = args;
    const { name: owner } = self.match(root.users.one());
    const result = await client.repos.get({ owner, repo });
    return result.data;
  },
  async page({ self, args }) {
    const { name: username } = self.match(root.users.one());

    const apiArgs = toApiArgs(args, { username });
    const res = await client.repos.getForUser(apiArgs);

    return {
      items: res.data,
      next: getNextPageRef(self.page(args), res)
    };
  },
};

export const Repository = {
  self({ self, parent, source }) {
    return parent.parent.parent.one({ name: source.name });
  },
  issueOpened: {
    async subscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      await ensureTimerIsSet(`${owner}/${repo}`, "issueOpened");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      await unsetTimerRepo(`${owner}/${repo}`, 'issueOpened');
    },
  },
  pullRequestOpened: {
    async subscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      await ensureTimerIsSet(`${owner}/${repo}`, "pullRequestOpened");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      await unsetTimerRepo(`${owner}/${repo}`, 'pullRequestOpened');
    },
  },
  releasePublished: {
    async subscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      await ensureTimerIsSet(`${owner}/${repo}`, 'releasePublished');
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      await unsetTimerRepo(`${owner}/${repo}`, 'releasePublished');
    },
  },
  fullName({ source }) {
    return source['full_name'];
  },
  htmlUrl({ source }) {
    return source['html_url'];
  },
  forksCount({ source }) {
    return source['forks_count'];
  },
  stargazersCount({ source }) {
    return source['stargazers_count'];
  },
  watchersCount({ source }) {
    return source['watchers_count'];
  },
  defaultBranch({ source }) {
    return source['default_branch'];
  },
  openIssuesCount({ source }) {
    return source['open_issuesCount'];
  },
  hasIssues({ source }) {
    return source['has_issues'];
  },
  hasWiki({ source }) {
    return source['has_wiki'];
  },
  hasPages({ source }) {
    return source['has_pages'];
  },
  hasDownloads({ source }) {
    return source['has_downloads'];
  },
  pushedAt({ source }) {
    return source['pushed_at'];
  },
  createdAt({ source }) {
    return source['created_at'];
  },
  updatedAt({ source }) {
    return source['updated_at'];
  },
  allowRebaseMerge({ source }) {
    return source['allow_rebase_merge'];
  },
  allowSquashMerge({ source }) {
    return source['allow_squash_merge'];
  },
  allowMergeCommit({ source }) {
    return source['allow_merge_commit'];
  },
  subscribersCount({ source }) {
    return source['subscribers_count'];
  },
  networkCount({ source }) {
    return source['network_count'];
  },
  issues({ self, source }) {
    return {};
  },
  pullRequests({ self, source }) {
    return {};
  },
  releases({ self, source }) {
    return {};
  },
};

export const IssueCollection = {
  async one({ self, source, args }) {
    const { name: owner } = self.match(root.users.one());
    const { name: repo } = self.match(root.users.one.repos.one);

    const { number } = args;
    const result = await client.issues.get({ owner, repo, number });
    return result.data;
  },

  async page({ self, source, args }) {
    const { name: owner } = self.match(root.users.one());
    const { name: repo } = self.match(root.users.one.repos.one);

    const apiArgs = toApiArgs(args, { owner, repo });
    const res = await client.issues.getForRepo(apiArgs);
    return {
      items: res.data,
      next: getNextPageRef(self.page(args), res)
    };
  },
};

export const Issue = {
  self({ self, parent, source }) {
    return parent.parent.parent.one({ number: source.number });
  },
  activeLockReason({ source }) {
    return source['active_lock_reason'];
  },
  async subscribe({ self }) {
    const nodeId = await self.nodeId.$query();
    // NOTE: The REST endpoint doesn't seem to work (403) for subscriptions so we use GraphQL here instead.
    const query = `
      mutation($id: ID!) {
          updateSubscription(input: { subscribableId:$id, state:SUBSCRIBED }) {
            subscribable { viewerSubscription }
          }
      }`;
    const variables = { id: nodeId };
    await graphql(query, variables);
  },
  nodeId({ source }) {
    return source.node_id;
  },
  owner({ source }) {
    return root.users.one({name: source.user.login});
  },
  closed: {
    async subscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      const { number } = self.match(root.users.one.repos.one.issues.one);

      await ensureTimerIsSet(`${owner}/${repo}`, `issueClosed/${number}`);
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      const { number } = self.match(root.users.one.repos.one.issues.one);

      await unsetTimerRepo(`${owner}/${repo}`, `issueClosed/${number}`);
    },
  },
};

export const PullRequestCollection = {
  async one({ self, source, args }) {
    const { name: owner } = self.match(root.users.one);
    const { name: repo } = self.match(root.users.one.repos.one);
    const { number } = args;
    const result = await client.pullRequests.get({ owner, repo, number });
    return result.data;
  },

  async page({ self, source, args }) {
    const { name: owner } = self.match(root.users.one());
    const { name: repo } = self.match(root.users.one().repos().one());

    const apiArgs = toApiArgs(args, { owner, repo });
    const res = await client.pullRequests.getAll(apiArgs);

    return {
      items: res.data,
      next: getNextPageRef(self.page(args), res),
    };
  },
};

export const PullRequest = {
  self({ self, parent, source }) {
    return parent.parent.parent.one({ number: source.number });
  },
  activeLockReason({ source }) {
    return source['active_lock_reason'];
  },
  diff({ source }) {
    return getDiff(source['diff_url']);
  },
  async subscribe({ self }) {
    const nodeId = await self.nodeId.$query();
    // NOTE: The REST endpoint doesn't seem to work (403) for subscriptions so we use GraphQL here instead.
    const query = `
      mutation($id: ID!) {
          updateSubscription(input: { subscribableId:$id, state:SUBSCRIBED }) {
            subscribable { viewerSubscription }
          }
      }`;
    const variables = { id: nodeId };
    await graphql(query, variables);
  },
  nodeId({ source }) {
    return source.node_id;
  },
  owner({ source }) {
    return root.users.one({ name: source.user.login });
  },
  closed: {
    async subscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      const { number } = self.match(root.users.one.repos.one.pullRequests.one);

      await ensureTimerIsSet(`${owner}/${repo}`, `pullRequestClosed/${number}`);
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.match(root.users.one);
      const { name: repo } = self.match(root.users.one.repos.one);
      const { number } = self.match(root.users.one.repos.one.pullRequests.one);

      await unsetTimerRepo(`${owner}/${repo}`, `pullRequestClosed/${number}`);
    },
  },
};

export const ReleaseCollection = {
  async one({ self, source, args }) {
    const { name: owner } = self.match(root.users.one);
    const { name: repo } = self.match(root.users.one.repos.one);
    const { id } = args;

    const result = await client.repos.getRelease({ owner, repo, id });
    return result.data;
  },

  async page({ self, source, args }) {
    const { name: owner } = self.match(root.users.one);
    const { name: repo } = self.match(root.users.one.repos.one);
    const apiArgs = toApiArgs(args, { owner, repo });
    const res = await client.repos.getReleases(apiArgs);
    return {
      items: res.data,
      next: getNextPageRef(self.page(args), res),
    };
  },
};

export const Release = {
  self({ self, parent, source }) {
    return parent.parent.parent.one({ id: `${source.id}` });
  },
  nodeId({ source }) {
    return source.node_id;
  },
  tagName({ source }) {
    return source.tag_name;
  },
  targetCommitish({ source }) {
    return source.target_commitish;
  },
  createdAt({ source }) {
    return source.created_at;
  },
};

export const Config = {
  self({ self, parent, source }) {
    return parent.parent.parent.one({ id: source.hook_id });
  },
  contentType({ source }) {
    return source['content_type'];
  },
};

export const Owner = {
  nodeId({ source }) {
    return source.node_id;
  },
  avatarUrl({ source }) {
    return source.avatar_url;
  },
  subscriptionsUrl({ source }) {
    return source.subscriptions_url;
  },
  eventsUrl({ source }) {
    return source.events_url;
  },
  receivedEventsUrl({ source }) {
    return source.received_events_url;
  },
};

export async function timer({ key }) {
  const { state } = program;
  const [owner, repo] = key.split('/');
  const { data, meta } = await client.activity.getEventsForRepo({ owner, repo });

  // Find the index of the oldest event that hasn't been processed yet
  const index = data.findIndex((item) => formatTime(item.created_at) <= state.repos[key].lastEventTime);

  if (index > 0) {
    // Process all new events in oldest-to-newest order
    const newEvents = data.slice(0, index).reverse();
    for (let item of newEvents) {
      const { type, payload } = item;
      for (let eventData of state.repos[key].events) {
        const [event, number] = eventData.split('/');
        switch (event) {
          case 'issueOpened': {
            if (type === 'IssuesEvent' && payload.action === 'opened') {
              const repoRef = root.users.one({ name: owner }).repos.one({ name: repo });
              await repoRef.issueOpened.dispatch({
                issue: repoRef.issues.one({ number }),
              });
            }
            break;
          }
          case 'issueClosed': {
            if (type === 'IssuesEvent' && payload.action === 'closed') {
              const issueRef = root.users.one({ name: owner }).repos.one({ name: repo }).issues.one({ number });
              await issueRef.closed.dispatch();
            }
            break;
          }
          case 'releasePublished': {
            if (type === 'ReleaseEvent' && payload.action === 'published') {
              const repoRef = root.users.one({ name: owner }).repos.one({ name: repo });
              const id = payload.release.id;
              await repoRef.releasePublished.dispatch({
                release: repoRef.releases.one({ id }),
              });
            }
            break;
          }
          case 'pullRequestOpened': {
            if (type === 'PullRequestEvent' && payload.action === 'opened') {
              const repoRef = root.users.one({ name: owner }).repos.one({ name: repo });
              await repoRef.pullRequestOpened.dispatch({
                issue: repoRef.issues.one({ number }),
                pullRequest: repoRef.pullRequests.one({ number }),
              });
            }
            break;
          }
          case 'pullRequestClosed': {
            if (type === 'PullRequestEvent' && payload.action === 'closed') {
              const pullRef = root.users.one({ name: owner }).repos.one({ name: repo }).pullRequests.one({ number });
              await pullRef.closed.dispatch();
            }
            break;
          }
        }
      }
    }

    // Save the time of the most recent event
    const lastEvent = newEvents[newEvents.length - 1];
    state.repos[key].lastEventTime = formatTime(lastEvent.created_at);
    await program.save();
  }

  // Schedule the next check
  const pollInterval = Number.parseInt(meta['x-poll-interval'], 10);
  await program.setTimer(key, pollInterval);
}

async function ensureTimerIsSet(repo, event) {
  const { state } = program;
  const repository = (state.repos[repo] = state.repos[repo] || {});
  const events = (repository['events'] = repository['events'] || []);

  if (events.length === 0) {
    repository['lastEventTime'] = new Date().getTime();
    await timer({ key: repo });
  }

  if (!events.includes(event)) {
    events.push(event);
    await program.save();
  }
}

async function unsetTimerRepo(repo, event) {
  const events = program.state.repos[repo].events;

  const index = events.indexOf(event);
  if (index >= 0) {
    events.splice(index, 1);
    await program.save();
  }

  if (events.length === 0) {
    await program.unsetTimer(repo);
  }
}

function formatTime(time) {
  return new Date(time).getTime();
}
