import GithubApi from '@octokit/rest';
import axios from 'axios';

let { ACCESS_TOKEN } = process.env;
if (!ACCESS_TOKEN) {
  throw new Error('Please provide ACCESS_TOKEN as an environment variable');
}

let { url: webhookUrl } = program.endpoints.webhook;
if (!webhookUrl) {
  throw new Error('Failed to determine webhook URL');
}

export const client = new GithubApi({
});

client.authenticate({
  type: 'token',
  token: ACCESS_TOKEN,
})

 
const instance = axios.create({
  headers: {
    'Content-Type': 'Accept: application/vnd.github.diff',
    Authorization: 'token ' + ACCESS_TOKEN,
  }
});

export async function getDiff(url, params) {
  const result = await instance.get(url, { params });
  return result.data;
}
// TODO: axios client
export async function graphql(query, variables){
  const body = {
      query: query,
      variables: variables
    }
    const client = axios.create({
      headers: {'Authorization': `token ${process.env.ACCESS_TOKEN}`}
    });
    const reult = await client.post(`https://api.github.com/graphql`, body)
     console.log(result);
}