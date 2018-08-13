import GithubApi from '@octokit/rest';

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
   headers: {'Content-Type': 'Accept: application/vnd.github.diff'}
});

export async function get(url, params) {
  const result = await instance.get(url, { params });
  return result.data;
}