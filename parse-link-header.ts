// import { parse as parseUrl } from "url";
// import { parse as parseQuery } from "querystring";

function hasRel(x: { rel: any; }) {
  return x && x.rel;
}

function intoRels(acc, x) {
  function splitRel(rel) {
    acc[rel] = Object.assign(x, { rel });
  }

  x.rel.split(/\s+/).forEach(splitRel);

  return acc;
}

function createObjects(acc, p) {
  // rel="next" => 1: rel 2: next
  var m = p.match(/\s*(.+)\s*=\s*"?([^"]+)"?/);
  if (m) acc[m[1]] = m[2];
  return acc;
}

function parseLink(link: string) {
  try {
    const m = link.match(/<?([^>]*)>(.*)/);
    if (!m) {
      return null;
    }
    const linkUrl = m?.[1];
    const parts = m[2].split(";");
    const parsedUrl = new URL(linkUrl);
    const query = new URLSearchParams(parsedUrl.searchParams);

    parts.shift();

    const info = Object.assign(query, parts.reduce(createObjects, {}));
    info.url = linkUrl;
    return info;
  } catch (e) {
    return null;
  }
}

export default function (linkHeader: string) {
  if (!linkHeader) return null;

  return linkHeader
    .split(/,\s*</)
    .map(parseLink)
    .filter(hasRel)
    .reduce(intoRels, {});
}
