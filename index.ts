import { root, state as stateValue } from "membrane";
import { Octokit } from "@octokit/rest";
import parseLinks from "./parse-link-header";

interface State {
  token?: string;
  client?: Octokit;
}
const state = stateValue as State;

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
function getPageRefs(
  gref: Gref<unknown>,
  response: { headers: any }
): { next?: any } {
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
    const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
    refs.next = gref({ ...args, page });
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
  // issueOpened: {
  //   async subscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     await ensureTimerIsSet(`${owner}/${repo}`, "issueOpened");
  //   },
  //   async unsubscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     await unsetTimerRepo(`${owner}/${repo}`, 'issueOpened');
  //   },
  // },
  // pullRequestOpened: {
  //   async subscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     await ensureTimerIsSet(`${owner}/${repo}`, "pullRequestOpened");
  //   },
  //   async unsubscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     await unsetTimerRepo(`${owner}/${repo}`, 'pullRequestOpened');
  //   },
  // },
  // releasePublished: {
  //   async subscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     await ensureTimerIsSet(`${owner}/${repo}`, 'releasePublished');
  //   },
  //   async unsubscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     await unsetTimerRepo(`${owner}/${repo}`, 'releasePublished');
  //   },
  // },
  branches: () => ({}),
  issues: () => ({}),
  pull_requests: () => ({}),
  releases: () => ({}),
  async content({ obj, self, args: { path }, info }) {
    if (!shouldFetch(info, ["path", ...Object.keys(obj)])) {
      return { path };
    }
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { data } = await client().repos.getContent({ owner, repo, path });
    if (Array.isArray(data)) {
      const gref = root.users.one({ name: owner }).repos.one({ name: repo });
      return {
        type: "directory",
        files: data.map((e) => gref.content({ path: e.path }))
      };
    }

    return data;
  },
  async license({ self }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const res = await client().licenses.getForRepo({ owner, repo });
    return res.data;
  },
};

export const Content = {
  gref: ({ obj }) => {
   return obj;
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
let x: Gref<string>;

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

    // The search API doesn't use the same pagination scheme as other APIs so we don't use getPageRefs here
    let next = undefined;
    const links = res.headers.link && parseLinks(res.headers.link);
    if (links) {
      if (links.next?.url !== undefined) {
        const qs = new URL(links.next.url).searchParams;
        const page =
          qs.get("page") !== undefined
            ? parseInt(qs.get("page")!, 10)
            : undefined;
        next = self.search({ ...args, q: qs.get("q"), page });
      }
    }
    return { ...res.data, next };
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
    return root.users
      .one({ name: owner })
      .repos.one({ name: repo })
      .issues.one({ number });
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
  async subscribe({ self }) {
    // const nodeId = await self.nodeId.$query();
    // // NOTE: The REST endpoint doesn't seem to work (403) for subscriptions so we use GraphQL here instead.
    // const query = `
    //   mutation($id: ID!) {
    //       updateSubscription(input: { subscribableId:$id, state:SUBSCRIBED }) {
    //         subscribable { viewerSubscription }
    //       }
    //   }`;
    // const variables = { id: nodeId };
    // await graphql(query, variables);
  },
  async createComment({ self, args }) {
    const { name: owner } = self.$argsAt(root.users.one);
    const { name: repo } = self.$argsAt(root.users.one.repos.one);
    const { number: issue_number } = self.$argsAt(
      root.users.one.repos.one.issues.one
    );
    const { body } = args;

    return client().issues.createComment({ owner, repo, issue_number, body });
  },
  user({ obj, info }) {
    if (obj.user) {
      if (!shouldFetch(info, Object.keys(obj.user))) {
        return obj.user;
      }
      return UserCollection.one({ args: { name: obj.user.login }, info });
    }
  },
  // closed: {
  //   async subscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     const { number } = self.$argsAt(root.users.one.repos.one.issues.one);

  //     await ensureTimerIsSet(`${owner}/${repo}`, `issueClosed/${number}`);
  //   },
  //   async unsubscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     const { number } = self.$argsAt(root.users.one.repos.one.issues.one);

  //     await unsetTimerRepo(`${owner}/${repo}`, `issueClosed/${number}`);
  //   },
  // },
};

export const Reactions = {
  plus_one: ({ obj }) => obj["+1"],
  minus_one: ({ obj }) => obj["-1"],
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
  commit({ obj }) {
    return obj.commit;
  },
};

export const Commit = {
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

  async message({ obj }) {
    return obj?.commit?.message;
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
  // async subscribe({ self }) {
  //   const nodeId = await self.nodeId.$query();
  //   // NOTE: The REST endpoint doesn't seem to work (403) for subscriptions so we use GraphQL here instead.
  //   const query = `
  //     mutation($id: ID!) {
  //         updateSubscription(input: { subscribableId:$id, state:SUBSCRIBED }) {
  //           subscribable { viewerSubscription }
  //         }
  //     }`;
  //   const variables = { id: nodeId };
  //   await graphql(query, variables);
  // },
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
  // closed: {
  //   async subscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     const { number } = self.$argsAt(root.users.one.repos.one.pull_requests.one);

  //     await ensureTimerIsSet(`${owner}/${repo}`, `pullRequestClosed/${number}`);
  //   },
  //   async unsubscribe({ self }) {
  //     const { name: owner } = self.$argsAt(root.users.one);
  //     const { name: repo } = self.$argsAt(root.users.one.repos.one);
  //     const { number } = self.$argsAt(root.users.one.repos.one.pull_requests.one);

  //     await unsetTimerRepo(`${owner}/${repo}`, `pullRequestClosed/${number}`);
  //   },
  // },
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

export const Release = {
  self({ self, parent, obj }) {
    return parent.parent.parent.one({ id: `${obj.id}` });
  },
  nodeId({ obj }) {
    return obj.node_id;
  },
  tagName({ obj }) {
    return obj.tag_name;
  },
  targetCommitish({ obj }) {
    return obj.target_commitish;
  },
  createdAt({ obj }) {
    return obj.created_at;
  },
};

export const Config = {
  self({ self, parent, obj }) {
    return parent.parent.parent.one({ id: obj.hook_id });
  },
  contentType({ obj }) {
    return obj["content_type"];
  },
};

export const Owner = {
  nodeId({ obj }) {
    return obj.node_id;
  },
  avatarUrl({ obj }) {
    return obj.avatar_url;
  },
  subscriptionsUrl({ obj }) {
    return obj.subscriptions_url;
  },
  eventsUrl({ obj }) {
    return obj.events_url;
  },
  receivedEventsUrl({ obj }) {
    return obj.received_events_url;
  },
};

export const License = {
  htmlUrl({ obj }) {
    return obj["html_url"];
  },
  gitUrl({ obj }) {
    return obj["git_url"];
  },
  downloadUrl({ obj }) {
    return obj["download_url"];
  },
};

export const LicenseDesc = {
  spdxId({ obj }) {
    return obj["spdx_id"];
  },
};

// export async function timer({ key }) {
//   const { state } = program;
//   const [owner, repo] = key.split('/');
//   const { data, meta } = await client().activity.getEventsForRepo({ owner, repo });

//   // Find the index of the oldest event that hasn't been processed yet
//   const index = data.findIndex((item) => formatTime(item.created_at) <= state.repos[key].lastEventTime);

//   if (index > 0) {
//     // Process all new events in oldest-to-newest order
//     const newEvents = data.slice(0, index).reverse();
//     for (let item of newEvents) {
//       const { type, payload } = item;
//       for (let eventData of state.repos[key].events) {
//         const [event, number] = eventData.split('/');
//         switch (event) {
//           case 'issueOpened': {
//             if (type === 'IssuesEvent' && payload.action === 'opened') {
//               const repoRef = root.users.one({ name: owner }).repos.one({ name: repo });
//               await repoRef.issueOpened.dispatch({
//                 issue: repoRef.issues.one({ number }),
//               });
//             }
//             break;
//           }
//           case 'issueClosed': {
//             if (type === 'IssuesEvent' && payload.action === 'closed') {
//               const issueRef = root.users.one({ name: owner }).repos.one({ name: repo }).issues.one({ number });
//               await issueRef.closed.dispatch();
//             }
//             break;
//           }
//           case 'releasePublished': {
//             if (type === 'ReleaseEvent' && payload.action === 'published') {
//               const repoRef = root.users.one({ name: owner }).repos.one({ name: repo });
//               const id = `${payload.release.id}`;
//               await repoRef.releasePublished.dispatch({
//                 release: repoRef.releases.one({ id }),
//               });
//             }
//             break;
//           }
//           case 'pullRequestOpened': {
//             if (type === 'PullRequestEvent' && payload.action === 'opened') {
//               const repoRef = root.users.one({ name: owner }).repos.one({ name: repo });
//               await repoRef.pullRequestOpened.dispatch({
//                 issue: repoRef.issues.one({ number }),
//                 pullRequest: repoRef.pullRequests.one({ number }),
//               });
//             }
//             break;
//           }
//           case 'pullRequestClosed': {
//             if (type === 'PullRequestEvent' && payload.action === 'closed') {
//               const pullRef = root.users.one({ name: owner }).repos.one({ name: repo }).pullRequests.one({ number });
//               await pullRef.closed.dispatch();
//             }
//             break;
//           }
//         }
//       }
//     }

//     // Save the time of the most recent event
//     const lastEvent = newEvents[newEvents.length - 1];
//     state.repos[key].lastEventTime = formatTime(lastEvent.created_at);
//   }

//   // Schedule the next check
//   const pollInterval = Number.parseInt(meta['x-poll-interval'], 10);
//   await program.setTimer(key, pollInterval);
// }

// async function ensureTimerIsSet(repo, event) {
//   const { state } = program;
//   const repository = (state.repos[repo] = state.repos[repo] || {});
//   const events = (repository['events'] = repository['events'] || []);

//   if (events.length === 0) {
//     repository['lastEventTime'] = new Date().getTime();
//     await timer({ key: repo });
//   }

//   if (!events.includes(event)) {
//     events.push(event);
//   }
// }

// async function unsetTimerRepo(repo, event) {
//   const events = program.state.repos[repo].events;

//   const index = events.indexOf(event);
//   if (index >= 0) {
//     events.splice(index, 1);
//   }

//   if (events.length === 0) {
//     await program.unsetTimer(repo);
//   }
// }

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

// TODO
// export async function parse({ name, value }) {
//   switch (name) {
//     case "url": {
//       const { pathname: path } = parseUrl(value, true);
//       const parts = path.split("/");
//       // TODO: users
//       if (parts.length < 3) {
//         return root;
//       }
//       const repo = root.users.one({ name: parts[1] }).repos().one({ name: parts[2] });
//       if (parts.length >= 4 && parts[3] === 'issues') {
//         if (parts.length >= 5) {
//           const number = Number.parseInt(parts[4], 10);
//           if (!Number.isNaN(number)) {
//             return repo.issues.one({ number });
//           }
//           return repo.issues;
//         }
//         return repo.issues;
//       } else if (parts.length >= 4 && /^pulls?$/.test(parts[3])) {
//         if (parts.length >= 5) {
//           const number = Number.parseInt(parts[4], 10);
//           if (!Number.isNaN(number)) {
//             return repo.pullRequests.one({ number });
//           }
//           return repo.pullRequests;
//         }
//         return repo.pullRequests;
//       }
//       return repo;
//     }
//     case 'repo': {
//       const parts = path.split('/');
//       return root.users.one({ name: parts[0] }).repos().one({ name: parts[1] });
//     }
//   }
// }
