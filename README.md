# Github Driver

A [Membrane.io](https://membrane.io/) driver for Github.

## Setup

Get your [Personal access tokens (classic)](https://github.com/settings/tokens) and configure.

$~~~~$`mctl action 'github:configure(token:"<Token>")'`

## Examples of queries

Get user repos

$~~~~$`mctl query 'github:users.one(name:"tj").repos.page.items' '{ full_name watchers_count forks_count }'`
```
Result:
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
  ...others
]
```

Get the download url of a file.

$~~~~$`mctl query 'github:users.one(name:"tj").repos.one(name:"aws").content(path:"logs/log.go")' '{ download_url }'`

```
Result:
{
  "download_url": "https://raw.githubusercontent.com/tj/aws/master/logs/log.go"
}
```

## Examples of actions

close a issue 

$~~~~$`mctl action 'github:users.one(name:"juancampa").repos.one(name:"membrane-driver-github").issues.one(number:1).close'`

create comment in a issue 

$~~~~$`mctl action 'github:users.one(name:"juancampa").repos.one(name:"membrane-driver-github").issues.one(number:1).createComment(body:"<comment text>")'`
