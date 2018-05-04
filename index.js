import { client } from './client';
import { parse as parseUrl } from 'url';
const { root } = program.refs;

export async function init() {
  return root.repos.set({});
}

export async function endpoint({ name, req}) {
}

export async function parse({ name, value}) {
  switch (name) {
    case 'url': {
      const { pathname: path } = parseUrl(value, true);
      const parts = path.split('/');

      if (parts.length >= 3) {
        return root.repos.one({ owner: parts[1], name: parts[2] })
      }
    }
  }
}

export const RepositoryCollection = {
  async one({ source, args }) {
    const { owner, name } = args;
    const result = await client.repos.get({ owner, repo: name });
    return result.data;
  },
  async page({ source, args }) {
  }
}

export const RepositoryPage = {
  items({ source }) {
    return source;
  },

  next({ self }) {
    const args = self.match(root.repos.page());
    return root.repos.page({ args });
  }
}

export const Repository = {
  self({ self, parent, source }) {
    return self || parent.ref.pop().pop().push('one', { id: source.id });
  },
  issues({ self, source }) {
    return {};
  },
}

export const IssueCollection = {
  async one({ self, source, args }) {
    const { owner, name } = self.match(root.repos.one());
    const result = await client.issues.get({ owner, repo: name, number: args.number });
    return result.data;
  },

  async page({ self, source, args }) {
    const { owner, name } = self.match(root.repos.one());

    const {
      pageSize,
      page,
      since,
      direction,
      sort,
      labels,
      state,
      filter,
    } = args;

    const options = Object.keys(args)
      .filter((key) => args[key] !== undefined)
      .reduce((acc, key) => {
        if (key === 'pageSize') {
          acc['per_page'] = args[key];
        } else {
          acc[key] = args[key];
        }
        return acc;
      }, { owner, repo });

    const result = await client.issues.getForRepo(options);
    return result;
  }
}

export const Issue = {
  self({ self, parent, source }) {
    return self || parent.ref.pop().pop().push('one', { number: source.number });
  },
}

export const IssuePage = {
  items({ source }) {
    return source.data;
  },

  next({ self, source }) {
    // Get the args from the current page
    const reposArgs = self.match(root.repos.one());
    const issuesArgs = self.match(root.repos.one().issues().page());;

    // Increment the page number
    const { page } = issuesArgs;
    issuesArgs.page = (page || 0) + 1;

    return root.repos.one(reposArgs).issues().page(issuesArgs);
  }
}

