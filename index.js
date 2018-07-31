import { client } from './client';
import { parse as parseUrl } from 'url';
import { parse as parseQuery } from 'querystring';
import getPageLinks from '@octokit/rest/lib/plugins/pagination/get-page-links';
const { root } = program.refs;

export async function init() {
  await root.users.set({});
}

export async function parse({ name, value }) {
  switch (name) {
    case 'url': {
      const { pathname: path } = parseUrl(value, true);
      const parts = path.split('/');

      if (parts.length >= 3) {
        return root.users.one({ name: parts[1] }).repos().one({ name: parts[2] })
      }
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
    return pageRef.ref.withArgs({ ...pageRef.args, page: Number.parseInt(page) });
  } else if (since !== undefined) {
    return pageRef.ref.withArgs({ ...pageRef.args, since: Number.parseInt(since) });
  }
  console.log('Failed to find next page from link:', nextLink);
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
      if (key === 'pageSize') {
        acc['per_page'] = args[key];
      } else {
        const apiKey = key.replace(/([A-Z])/g, ($1) => '_' + $1.toLowerCase());
        acc[apiKey] = args[key]
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
      next: getNextPageRef(self.page(args), res),
    };
  },
}

export const User = {
  self({ self, parent, source }) {
    return self || parent.ref.pop().pop().push('one', { name: source.login });
  },
  avatarUrl({ source }) { return source['avatar_url']; },
  gravatarId({ source }) { return source['gravatar_id']; },
  siteAdmin({ source }) { return source['site_admin']; },
  publicRepos({ source }) { return source['public_repos']; },
  publicGists({ source }) { return source['public_gists']; },
  createdAt({ source }) { return source['created_at']; },
  updatedAt({ source }) { return source['updated_at']; },
  repos() { return {}; },
}

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
      next: getNextPageRef(self.page(args), res),
    };
  }
}

export const Repository = {
  self({ self, parent, source }) {
    return self || parent.ref.pop().pop().push('one', { name: source.name });
  },
  fullName({ source }) { return source['full_name']; },
  htmlUrl({ source }) { return source['html_url']; },
  forksCount({ source }) { return source['forks_count']; },
  stargazersCount({ source }) { return source['stargazers_count']; },
  watchersCount({ source }) { return source['watchers_count']; },
  defaultBranch({ source }) { return source['default_branch']; },
  openIssuesCount({ source }) { return source['open_issuesCount']; },
  hasIssues({ source }) { return source['has_issues']; },
  hasWiki({ source }) { return source['has_wiki']; },
  hasPages({ source }) { return source['has_pages']; },
  hasDownloads({ source }) { return source['has_downloads']; },
  pushedAt({ source }) { return source['pushed_at']; },
  createdAt({ source }) { return source['created_at']; },
  updatedAt({ source }) { return source['updated_at']; },
  allowRebaseMerge({ source }) { return source['allow_rebase_merge']; },
  allowSquashMerge({ source }) { return source['allow_squash_merge']; },
  allowMergeCommit({ source }) { return source['allow_merge_commit']; },
  subscribersCount({ source }) { return source['subscribers_count']; },
  networkCount({ source }) { return source['network_count']; },
  issues({ self, source }) { return {}; },
}

export const IssueCollection = {
  async one({ self, source, args }) {
    const { name: owner } = self.match(root.users.one());
    const { name: repo } = self.match(root.users.one().repos().one());
    const { number } = args;
    const result = await client.issues.get({ owner, repo, number });
    return result.data;
  },

  async page({ self, source, args }) {
    const { name: owner } = self.match(root.users.one());
    const { name: repo } = self.match(root.users.one().repos().one());

    const apiArgs = toApiArgs(args, { owner, repo });
    const res = await client.issues.getForRepo(apiArgs);

    return {
      items: res.data,
      next: getNextPageRef(self.page(args), res),
    };
  }
}

export const Issue = {
  self({ self, parent, source }) {
    return self || parent.ref.pop().pop().push('one', { number: source.number });
  },
  activeLockReason({ source }) { return source['active_lock_reason']; },
}

export const HooksCollection = {
  async one({ self, source, args }) {
    const { name: owner } = self.match(root.users.one());
    const { name: repo } = self.match(root.users.one().repos().one());
    const { id } = args;
    const result = await octokit.repos.getHook({owner, repo, id});
    return result.data;
  },

  async page({ self, source, args }) {
    const { name: owner } = self.match(root.users.one());
    const { name: repo } = self.match(root.users.one().repos().one());

    const apiArgs = toApiArgs(args, { owner, repo });
    const res = await client.repos.getHooks(apiArgs);

    return {
      items: res.data,
      next: getNextPageRef(self.page(args), res),
    };
  }
}

export const Issue = {
  self({ self, parent, source }) {
    return self || parent.ref.pop().pop().push('one', { number: source.number });
  },
  activeLockReason({ source }) { return source['active_lock_reason']; },
}

