# Github Driver

A [Membrane.io](https://membrane.io/) driver for Github.

## Setup

Get your [Personal access tokens (classic)](https://github.com/settings/tokens) and invoke the `:configure` action.

Generally, you'll want to interact with this driver via our VS Code extension but you can also configure it via Membrane's CLI:

```
mctl action 'github:configure(token:"<Token>")'
```

## Examples queries

Get user repos
```
$ mctl query 'github:users.one(name:"tj").repos.page.items' '{ full_name watchers_count forks_count }'
[
   {
    "full_name": "tj/awesome-actions",
    "url": "https://api.github.com/repos/tj/awesome-actions",
    "description": "A curated list of awesome actions to use on GitHub",
    "watchers_count": 10,
    "forks_count": 1
  },
  {
    "full_name": "tj/aws",
    "url": "https://api.github.com/repos/tj/aws",
    "description": "Higher level AWS package for Go",
    "watchers_count": 39,
    "forks_count": 4
  },
  ...
]
```

Get the download url of a file.

```
$ mctl query 'github:users.one(name:"tj").repos.one(name:"aws").content(path:"logs/log.go")' '{ download_url }'
{
  "download_url": "https://raw.githubusercontent.com/tj/aws/master/logs/log.go"
}
```

## Examples actions

Close an issue
```
mctl action 'github:users.one(name:"juancampa").repos.one(name:"membrane-driver-github").issues.one(number:1).close'
```

Create comment in a issue 
```
mctl action 'github:users.one(name:"juancampa").repos.one(name:"membrane-driver-github").issues.one(number:1).createComment(body:"<comment text>")'
```
