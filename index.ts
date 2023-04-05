import { root, nodes, state as stateValue } from "membrane";
import { Octokit } from "@octokit/rest";
import parseLinks from "./parse-link-header";

interface State {
  token?: string;
  client?: Octokit;
  repos?: any;
}
const state = stateValue as State;

state.repos = state.repos ?? {};

function client(): Octokit {
  if (!state.client) {
    throw new Error(
      "Invoke `:configure` with your Github token before using this driver. Visit: https://github.com/settings/tokens/"
    );
  }
  return state.client;
}

// Determines if a query includes any fields that require fetching a given resource. Simple fields is an array of the
// fields that can be resolved without fetching
type ResolverInfo = {
  fieldNodes: {
    selectionSet: {
      selections: any;
    };
  }[];
};

const shouldFetch = (info: ResolverInfo, simpleFields: string[]) =>
  info.fieldNodes
    .flatMap(({ selectionSet: { selections } }) => {
      return selections;
    })
    .some(({ name: { value } }) => !simpleFields.includes(value));

// Generic helper to extract the "next" gref from the headers of a response
// TODO: support `prev` and `last` links
function getPageRefs(gref: any, response: { headers: any }): { next?: any } {
  const links = parseLinks(response.headers.link);
  if (!links) {
    return {};
  }
  const refs: { next?: any } = {};
  const args = gref.$args();

  // Github's API uses different methods to paginate depending on the endpoint
  if (links.next?.since !== undefined) {
    refs.next = gref({ ...args, since: links.next.since });
  } else if (links.next?.page !== undefined) {
    const page = Number.parseInt(links.next.page, 10);
    refs.next = gref({ ...args, page });
  } else if (links.next?.url) {
    // Extract the page number from the URL
    const url = new URL(links.next.url);
    if (url.searchParams.get("page")) {
      const page = Number.parseInt(url.searchParams.get("page")!, 10);
      refs.next = gref({ ...args, page });
    }
    if (url.searchParams.get("since")) {
      refs.next = gref({ ...args, since: url.searchParams.get("since") });
    }
  }
  return refs;
}

function getSearchPageRefs(gref: any, response: { headers: any }): { next?: any } {
  const links = parseLinks(response.headers.link);
  if (!links) {
    return {};
  }
  const refs: { next?: any } = {};
  const args = gref.$args();
  if (links) {
    if (links.next?.url !== undefined) {
      const qs = new URL(links.next.url).searchParams;
      const page = qs.get("page") !== undefined ? parseInt(qs.get("page")!, 10) : undefined;
      refs.next = gref({ ...args, q: qs.get("q"), page });
    }
  }
  return refs;
}

export const Root = {
  configure: ({ args }) => {
    if (args.token !== state.token) {
      console.log("Generating new client");
      state.token = args.token;
      state.client = new Octokit({
        auth: state.token,
      });
    }
  },
  users: () => ({}),
  search: () => ({}),
  status() {
    if (!state.token) {
      return `Not configured. [Generate API token](https://github.com/settings/tokens/new)`;
    }
    return "Ready";
  },
  parse: async ({ args: { name, value } }) => {
    // TODO: add more stuff like /tree, /commits, /blob, etc...
    switch (name) {
      case "user": {
        const url = new URL(value);
        const [, name] = url.pathname.split("/");
        return [root.users.one({ name })];
      }
      case "repo": {
        const url = new URL(value);
        const [, user, repo] = url.pathname.split("/");
        return [root.users.one({ name: user }).repos().one({ name: repo })];
      }
      case "search": {
        const url = new URL(value);

        const [, user, repo, section, ...rest] = url.pathname.split("/");
        // TODO: handle the /issues/created_by URL
        let creator: string | undefined;
        if (section === "pulls") {
          creator = rest[0];
        } else if (section === "issues" && rest[0] === "created_by") {
          creator = rest[1];
        }

        // TODO: Support Gref<any> type
        let gref: any = root.users
          .one({ name: user })
          .repos.one({ name: repo }).issues;

        const kind = /issue/.test(section) ? "issue" : "pr";
        const q = url.searchParams.get("q") ?? `is:${kind} is:open`;
        const page = url.searchParams.get("page") ?? undefined;
        gref = gref.search({ q, page: page && Number.parseInt(page, 10) });
        return [gref];
      }
      case "pullRequest":
      case "issue": {
        const url = new URL(value);
        const parts = url.pathname.split("/");
        const [_, user, repo, section, id] = parts;
        if (user) {
          let gref: any = root.users.one({ name: user });
          if (repo) {
            gref = gref.repos.one({ name: repo });
            if (section) {
              if (section === "issues") {
                gref = gref.issues;
              } else if (/^pulls?$/.test(section)) {
                gref = gref.pull_requests;
              } else {
                return [];
              }
              const number = Number.parseInt(id, 10);
              if (!Number.isNaN(number)) {
                gref = gref.one({ number });
              }
            }
          }
          return [gref];
        }
      }
    }
    return [];
  },
};

export const UserCollection = {
  async one({ args, info }) {
    if (!shouldFetch(info, ["login", "repos"])) {
      return { login: args.name };
    }
    const result = await client().users.getByUsername({ username: args.name });
    return result.data;
  },
  async page({ self, args }) {
    const apiArgs = toGithubArgs(args);
    const res = await client().users.list(apiArgs);

    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  },
};

export const User = {
  gref: ({ obj }) => root.users.one({ name: obj.login }),
  repos: () => ({}),
};

export const RepositoryCollection = {
  async one({ self, args, info }) {
    const { name: repo } = args;
    const { name: owner } = self.$argsAt(root.users.one());
    if (
      !shouldFetch(info, [
        "name",
        "repos",
        "issues",
        "pull_requests",
        "releases",
      ])
    ) {
      return { name: repo };
    }
    const result = await client().repos.get({ owner, repo });
    return result.data;
  },
  async page({ self, args }) {
    const { name: username } = self.$argsAt(root.users.one());

    const apiArgs = toGithubArgs({ ...args, username });
    const res = await client().repos.listForUser(apiArgs);

    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  },
  async search({ self, args }) {
    const { name: username } = self.$argsAt(root.users.one());
    const q = (args.q ?? "") + ` user:${username}`;

    const apiArgs = toGithubArgs({ ...args, q, username });
    const res = await client().search.repos(apiArgs);

    return {
      items: res.data.items,
      next: getPageRefs(self.search(args), res).next,
    };
  },
};

export const Repository = {
  gref: ({ self, obj }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    return root.users.one({ name: owner }).repos.one({ name: obj.name });
  },
  transfer: async ({ self, args }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    await client().repos.transfer({ ...args, owner });
  },
  addCollaborator: async ({ self, args }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    await client().repos.addCollaborator({ ...args, owner, repo });
  },
  createTree: async ({ self, args }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    // now only supports 1 tree params
    const body = {
      base_tree: args.base,
      tree: [
        {
          path: args.path,
          mode: "160000",
          type: "commit",
          sha: args.tree,
        },
      ],
    };
    const apiArgs = toGithubArgs({ ...body, owner, repo });
    const ref = await client().git.createTree(apiArgs);
    return ref.data.sha;
  },
  commentCreated: {
    async subscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await register(owner, repo, "issue_comment");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await unregister(owner, repo, "issue_comment");
    },
  },
  issueOpened: {
    async subscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);
      
      await register(owner, repo, "issues");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await unregister(owner, repo, "issues");
    },
  },
  pullRequestOpened: {
    async subscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await register(owner, repo, "pull_request");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await unregister(owner, repo, "pull_request");
    },
  },
  releasePublished: {
    async subscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await register(owner, repo, "release");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);
      
      await unregister(owner, repo, "release");
    },
  },
  branches: () => ({}),
  commits: () => ({}),
  issues: () => ({}),
  pull_requests: () => ({}),
  releases: () => ({}),
  content: () => ({}),
  async license({ self }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const res = await client().licenses.getForRepo({ owner, repo });
    return res.data;
  },
};

export const IssueCollection = {
  async one({ self, args, info }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { number: issue_number } = args;

    if (!shouldFetch(info, ["number"])) {
      return { number: issue_number };
    }

    const result = await client().issues.get({ owner, repo, issue_number });
    return result.data;
  },

  async search({ self, args: allArgs }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    let { q, ...args } = allArgs;
    q = `${q ?? ""} repo:${owner}/${repo}`;

    const apiArgs = toGithubArgs({ ...args, q });
    const res = await client().search.issuesAndPullRequests(apiArgs);

    return { 
      ...res.data, 
      next: getSearchPageRefs(self.search(args), res).next 
    };
  },

  async page({ self, args: rawArgs }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { kind, ...args } = rawArgs;

    const apiArgs = toGithubArgs({ ...args, owner, repo });
    const res = await client().issues.listForRepo(apiArgs);

    // TODO: this can be problematic because we're ignoring on the client side (GH's API doesn't have a way to filter by
    // kind, even though they do it in their UI. UPDATE: read the comment below). The correct way to implement this is,
    // if anything is filtered out, we need to get more items to fill the "empty" slots. That could get crazy (many
    // requests) with a repo that has maany issues of one kind vs the other.
    // IMPORTANT: Actually, we might be able to implement this with the /search API. More info here:
    // https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests
    if (res.data && kind) {
      res.data = res.data.filter(
        (e) =>
          (kind === "issue" && !e.pull_request) ||
          (kind === "pr" && e.pull_request)
      );
    }

    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  },
};

export const Issue = {
  gref: ({ self, obj }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const number = obj.number;
    return root.users.one({ name: owner }).repos.one({ name: repo }).issues.one({ number });
  },
  close: ({ self, obj }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { number } = self.$argsAt(root.users.one.repos.one.issues.one);

    return client().issues.update({
      owner,
      repo,
      issue_number: number,
      state: "closed",
    });
  },
  pull_request: () => {
    // TODO: parse obj.url which looks like this URL:
    // https://api.github.com/repos/octocat/Hello-World/pulls/1347
  },
  async createComment({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { number: issue_number } = self.$argsAt(root.users.one.repos.one.issues.one);
    const { body } = args;

    return client().issues.createComment({ owner, repo, issue_number, body });
  },
  comments: () => ({}),
  user({ obj, info }) {
    if (obj.user) {
      if (!shouldFetch(info, Object.keys(obj.user))) {
        return obj.user;
      }
      return UserCollection.one({ args: { name: obj.user.login }, info });
    }
  },
  commentCreated: {
    async subscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await register(owner, repo, "issue_comment");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await unregister(owner, repo, "issue_comment");
    },
  },
  closed: {
    async subscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await register(owner, repo, "issues");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await unregister(owner, repo, "issues");
    },
  },
};

export const CommentCollection = {
  async one({ self, args: { id }, info }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    
    const res = await client().issues.getComment({
      owner,
      repo,
      comment_id: id,
    });
    return res.data;
  },
  async page({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    
    const { number: issue } = self.$argsAt(root.users.one.repos.one.issues.one);
    const { number: pull } = self.$argsAt(root.users.one.repos.one.pull_requests.one);

    const issue_number = issue || pull;

    const apiArgs = toGithubArgs({ ...args, owner, repo, issue_number });
    const res = await client().rest.issues.listComments(apiArgs);
    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  }
};

export const Comment = {
  gref({ self, obj }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { number: issue } = self.$argsAt(root.users.one.repos.one.issues.one);
    const { number: pull } = self.$argsAt(root.users.one.repos.one.pull_requests.one);

    const repository = root.users.one({ name: owner }).repos.one({ name: repo });

    if (issue) {
      return repository.issues.one({ number: issue }).comments.one({ id: obj.id });
    } else if (pull) {
      return repository.pull_requests.one({ number: pull }).comments.one({ id: obj.id });
    }
  },
};

export const CommitCollection = {
  async one({ self, args: { ref }, info }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const result = await client().repos.getCommit({
      owner,
      repo,
      ref,
    });

    return result.data;
  },

  async page({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);

    const apiArgs = toGithubArgs({ ...args, owner, repo });
    const res = await client().repos.listCommits(apiArgs);
    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  },
  async create({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);

    const parents = args.parents.split(",") || [];
    const apiArgs = toGithubArgs({
      tree: args.tree,
      owner,
      repo,
      parents,
      message: args.message,
    });
    const res = await client().git.createCommit(apiArgs);
    return res.data.sha;
  },
};

export const Commit = {
  gref({ self, obj }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    return root.users
      .one({ name: owner })
      .repos.one({ name: repo })
      .commits.one({ ref: obj.sha });
  },
  async author({ obj, info }) {
    if (!shouldFetch(info, Object.keys(obj.author))) {
      return obj.author;
    }
    const {
      author: { login },
    } = obj;
    const result = await client().users.getByUsername({ username: login });
    return result.data;
  },
  message({ obj }) {
    return obj.commit?.message;
  },
};

export const ContentCollection = {
  async file({ self, obj, args: { path }, info }) {
    if (!shouldFetch(info, ["path", ...Object.keys(obj)])) {
      return { path };
    }
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { data } = await client().repos.getContent({ owner, repo, path });

    if (!Array.isArray(data)) {
      return data;
    }
  },

  async dir({ self, obj, args: { path } }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { data } = await client().repos.getContent({ owner, repo, path });
    return Array.isArray(data) ? data : [];
  },
};

export const Content = {
  gref: ({ self, obj }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    if (obj.type === "dir") {
      return root.users
        .one({ name: owner })
        .repos.one({ name: repo })
        .content.dir({ path: obj.path });
    }
    return root.users
      .one({ name: owner })
      .repos.one({ name: repo })
      .content.file({ path: obj.path });
  },
  async content({ obj, self, args: { path }, info }) {
    let encoding;
    let content;
    if (obj.content) {
      content = obj.content;
      encoding = obj.encoding;
    } else {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);
      const { data } = await client().repos.getContent({ owner, repo, path });
      content = (data as any)?.content;
      encoding = (data as any)?.encoding;
    }
    if (encoding === "base64") {
      try {
        content = Buffer.from(content, "base64").toString("utf8");
        encoding = "utf8";
      } catch {
        throw new Error("Failed to decode, keep base64");
      }
    }
    return content;
  },
};

export const BranchCollection = {
  async one({ self, args, info }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { name: branch } = args;
    if (!shouldFetch(info, ["name"])) {
      return { name: branch };
    }
    const result = await client().repos.getBranch({
      owner,
      repo,
      branch: args.name,
    });
    return result.data;
  },

  async page({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);

    const apiArgs = toGithubArgs({ ...args, owner, repo });
    const res = await client().repos.listBranches(apiArgs);
    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  },
};

export const Branch = {
  gref({ obj, self }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const name = obj.name;
    return root.users
      .one({ name: owner })
      .repos.one({ name: repo })
      .branches.one({ name });
  },
  commit({ obj }) {
    return obj.commit;
  },
  async update({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);

    const apiArgs = toGithubArgs({ ...args, owner, repo });
    return await client().git.updateRef(apiArgs);
  },
};

export const PullRequestCollection = {
  async one({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);

    const { number: pull_number } = args;
    const result = await client().pulls.get({ owner, repo, pull_number });
    return result.data;
  },

  async page({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);

    const apiArgs = toGithubArgs({ ...args, owner, repo });
    const res = await client().pulls.list(apiArgs);
    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  },
};

export const PullRequest = {
  gref: ({ self, obj }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const number = obj.number;
    return root.users
      .one({ name: owner })
      .repos.one({ name: repo })
      .pull_requests.one({ number });
  },
  close: ({ self, obj }) => {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { number } = self.$argsAt(root.users.one.repos.one.pull_requests.one);
    
    return client().pulls.update({
      owner,
      repo,
      pull_number: number,
      state: "closed",
    });
  },
  diff({ obj }) {
    // TODO
    // return getDiff(obj['diff_url']);
  },
  comments: () => ({}),
  async createComment({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { number: issue_number } = self.$argsAt(
      root.users.one.repos.one.pull_requests.one
    );
    const { body } = args;

    return client().issues.createComment({ owner, repo, issue_number, body });
  },
  owner({ obj }) {
    return root.users.one({ name: obj.user.login });
  },
  closed: {
    async subscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await register(owner, repo, "pull_request");
    },
    async unsubscribe({ self }) {
      const { name: owner } = self.$argsAt(root.users.one);
      const { name: repo } = self.$argsAt(root.users.one.repos.one);

      await unregister(owner, repo, "pull_request");
    },
  },
};

export const ReleaseCollection = {
  async one({ self, obj, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { id: release_id } = args;

    const result = await client().repos.getRelease({ owner, repo, release_id });
    return result.data;
  },

  async page({ self, obj, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const apiArgs = toGithubArgs({ ...args, owner, repo });
    const res = await client().repos.listReleases(apiArgs);
    return {
      items: res.data,
      next: getPageRefs(self.page(args), res).next,
    };
  },
};

export const GlobalSearch = {
  async issues({ self, args }) {
    const apiArgs = toGithubArgs({ ...args });
    const res = await client().search.issuesAndPullRequests(apiArgs);

    return { 
      items: res.data.items, 
      next: getSearchPageRefs(self.issues(args), res).next 
    };
  },
  async commits({ self, args }) {
    const apiArgs = toGithubArgs({ ...args });
    const res = await client().search.commits(apiArgs);

    return { 
      items: res.data.items, 
      next: getSearchPageRefs(self.commits(args), res).next 
    };
  },
};

export async function endpoint({ args: { path, query, headers, method, body } }) {
  switch (path) {
    case "/webhooks": {
      const event = JSON.parse(body);
      // Every webhook event has a repository object
      const repo: any = root.users
        .one({ name: event.repository.owner.login })
        .repos.one({ name: event.repository.name });

      if (event.action === "opened" && event.issue) {
        const issue = repo.issues.one({ number: event.issue.number });
        await repo.issueOpened.$emit({ issue });
      }

      if (event.action === "closed" && event.issue) {
        const issue = repo.issues.one({ number: event.issue.number });
        await issue.closed.$emit();
      }

      if (event.action === "created" && event.release) {
        const release = repo.release.one({ id: event.release.id });
        await repo.releasePublished.$emit({ release });
      }

      if (event.action === "opened" && event.pull_request) {
        const pullRequest = repo.pull_request.one({ number: event.pull_request.number });
        await repo.pullRequestOpened.$emit({ pullRequest });
      }

      if (event.action === "closed" && event.pull_request.closed) {
        const pullRequest = repo.pull_request.one({ number: event.pull_request.number });
        await pullRequest.closed.$emit();
      }

      if(event.action === "created" && event.comment){
          const comment = repo.issues.one({ number: event.issue.number }).comments.one({ id: event.comment.id });
          await repo.issues.one({ number: event.issue.number }).commentCreated.$emit({ comment });
          await repo.commentCreated.$emit({ comment });
      }
      return JSON.stringify({ status: 200 });
    }
    default:
      console.log("Unknown Endpoint:", path);
  }
}
async function register(owner: string, repo: string, event: string) {
  const webhookURL = (await nodes.endpoint.$get()) + "/webhooks";
  try {
    // Check if the repository already has a webhook
    const repository = state.repos[`${owner}/${repo}`];
    const { data: hooks } = await client().repos.listWebhooks({
      owner,
      repo,
    });
    const matchingHook = hooks.find((hook) => hook.id === repository.id);
    // If the repository already has a webhook, update it
    if (matchingHook) {
      if (repository.events.includes(event)) {
        console.log("Webhook already exists with the same event.");
        return;
      } else {
        const updatedEvents = [...repository.events, event];
        await client().repos.updateWebhook({
          owner,
          repo,
          hook_id: repository.id,
          config: {
            content_type: "json",
            url: webhookURL,
          },
          events: updatedEvents,
        });
        // Update the events array in the repository object
        repository.events = updatedEvents;
        console.log("Webhook updated with new event.");
        return;
      }
    }
    // Create a new webhook
    const {
      data: { id: webhookId },
    } = await client().repos.createWebhook({
      owner,
      repo,
      events: [event],
      config: {
        content_type: "json",
        url: webhookURL,
      },
    });

    // Add the repository to the state with the webhook data
    state.repos[`${owner}/${repo}`] = {
      id: webhookId,
      url: webhookURL,
      events: [event],
    };

    console.log("New webhook created.");
  } catch (error) {
    throw new Error(`Error registering ${event} event for ${owner}/${repo}. Details: ${error}`);
  }
}

async function unregister(owner: string, repo: string, event: string) {
  try {
    // Check if the repository has a webhook
    const repository = state.repos[`${owner}/${repo}`];
    if (!repository) {
      console.log(`Webhook does not exist for ${owner}/${repo}.`);
      return;
    }
    // Update the webhook to remove the specified events
    const updatedEvents = repository.events.filter((e: string) => e !== event);

    await client().repos.updateWebhook({
      owner,
      repo,
      hook_id: repository.id,
      config: {
        content_type: "json",
        url: repository.url,
      },
      events: updatedEvents,
    });
    repository.events = updatedEvents;
    console.log(`Event ${event} deleted from webhook.`);
    // Delete the webhook if there are no more events
    if (updatedEvents.length === 0) {
      await client().repos.deleteWebhook({
        owner,
        repo,
        hook_id: repository.id,
      });
      delete state.repos[`${owner}/${repo}`];
      console.log("Webhook deleted.");
      return;
    }
  } catch (error) {
    throw new Error(`Error unregistering ${event} event for ${owner}/${repo}. Details: ${error}`);
  }
}

function formatTime(time) {
  return new Date(time).getTime();
}

// Helper function to convert Membrane collection pattern naming to Github
// pagination naming. Removing any undefined
function toGithubArgs(args: Record<string, any>): any {
  const result = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) {
      if (key === "pageSize") {
        result["per_page"] = args[key];
      } else {
        result[key] = args[key];
      }
    }
  }
  return result;
}