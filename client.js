//import GithubApi from "@octokit/rest";
// import axios from "axios";

// const instance = axios.create({
//   headers: {
//     Authorization: "token " + ACCESS_TOKEN
//   }
// });

// export async function getDiff(url, params) {
//   const result = await instance.get(
//     url,
//     { params },
//     {
//       headers: {
//         "Content-Type": "Accept: application/vnd.github.diff"
//       }
//     }
//   );
//   return result.data;
// }

// export async function graphql(query, variables) {
//   const body = {
//     query: query,
//     variables: variables
//   };
//   await instance.post(`https://api.github.com/graphql`, body);
// }
