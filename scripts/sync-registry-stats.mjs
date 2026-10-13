#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_STATS_URL =
  'https://raw.githubusercontent.com/duhu2000/dsh-mcp-connector-registry/main/catalog-stats.json';
export const STATS_START = '<!-- catalog-stats:start -->';
export const STATS_END = '<!-- catalog-stats:end -->';

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/** 随包内置卡片数允许为 0：目录可以完全由远程 Registry 承载。 */
function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

export function normalizeStats(value) {
  if (!value || Array.isArray(value) || value.schemaVersion !== 1) {
    throw new Error('registry stats must use schemaVersion 1');
  }
  const registryCount = positiveInteger(value.registryCount, 'registryCount');
  const bundledUniqueCount = nonNegativeInteger(value.bundledUniqueCount, 'bundledUniqueCount');
  const marketCount = positiveInteger(value.marketCount, 'marketCount');
  const featuredCount = positiveInteger(value.featuredCount, 'featuredCount');
  const categoryCount = positiveInteger(value.categoryCount, 'categoryCount');
  if (marketCount !== registryCount + bundledUniqueCount) {
    throw new Error('marketCount must equal registryCount + bundledUniqueCount');
  }
  if (featuredCount > marketCount) throw new Error('featuredCount must not exceed marketCount');
  if (!Array.isArray(value.categoryNames) || value.categoryNames.length !== categoryCount) {
    throw new Error('categoryNames length must equal categoryCount');
  }
  const categoryNames = value.categoryNames.map((name) => {
    if (typeof name !== 'string' || !/^[\p{L}\p{N} .&+/-]{1,40}$/u.test(name)) {
      throw new Error('categoryNames contains an unsafe value');
    }
    return name;
  });
  if (new Set(categoryNames).size !== categoryNames.length) throw new Error('categoryNames must be unique');
  if (typeof value.updatedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.updatedOn)) {
    throw new Error('updatedOn must use YYYY-MM-DD');
  }
  return {
    schemaVersion: 1,
    registryCount,
    bundledUniqueCount,
    marketCount,
    featuredCount,
    categoryCount,
    categoryNames,
    updatedOn: value.updatedOn,
  };
}

export function renderChineseStats(stats) {
  const merged = stats.bundledUniqueCount > 0
    ? `；与随包内置的 ${stats.bundledUniqueCount} 张卡片合并去重后，市场页可浏览 ${stats.marketCount} 张卡片`
    : `，市场页可浏览 ${stats.marketCount} 张卡片`;
  const bundling = stats.bundledUniqueCount > 0
    ? ''
    : '本插件不再内置连接器卡片，市场内容完全来自远程 Registry。';
  return `${STATS_START}\n截至 ${stats.updatedOn}，公共 Registry 已发布 ${stats.registryCount} 条连接器描述${merged}，覆盖${stats.categoryNames.join('、')} ${stats.categoryCount} 类，其中推荐位 ${stats.featuredCount} 张。${bundling}Registry 可独立持续更新，实际数量以客户端刷新后的市场页签徽标和上方实时统计徽标为准。\n${STATS_END}`;
}

export function renderEnglishStats(stats) {
  const merged = stats.bundledUniqueCount > 0
    ? ` After merging and deduplicating them with the ${stats.bundledUniqueCount} bundled cards, the Marketplace exposes ${stats.marketCount} cards`
    : ` The plugin no longer bundles connector cards, and the Marketplace exposes ${stats.marketCount} cards`;
  return `${STATS_START}\nAs of ${stats.updatedOn}, the public Registry publishes ${stats.registryCount} connector descriptors.${merged} across ${stats.categoryCount} business categories, with ${stats.featuredCount} featured cards. The Registry evolves independently; the badge shown after a client refresh and the live badges above are the authoritative current counts.\n${STATS_END}`;
}

export function replaceStatsBlock(text, replacement) {
  const start = text.indexOf(STATS_START);
  const end = text.indexOf(STATS_END);
  if (start === -1 || end === -1 || end < start) throw new Error('README catalog stats markers are missing or invalid');
  return `${text.slice(0, start)}${replacement}${text.slice(end + STATS_END.length)}`;
}

async function fetchStats(url, { fetchImpl = fetch, attempts = 3, timeoutMs = 15_000 } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'raw.githubusercontent.com') {
    throw new Error('stats URL must use https://raw.githubusercontent.com');
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        headers: { Accept: 'application/json', 'User-Agent': 'dsh-mcp-connector-stats-sync' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return normalizeStats(await response.json());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`unable to fetch registry stats after ${attempts} attempts: ${lastError?.message ?? lastError}`);
}

export async function syncRegistryStats({
  sourcePath,
  statsUrl = DEFAULT_STATS_URL,
  chineseReadmePath = 'README.md',
  englishReadmePath = 'README.en.md',
  snapshotPath = 'docs/registry-stats.json',
  fetchImpl,
} = {}) {
  const stats = sourcePath
    ? normalizeStats(JSON.parse(await readFile(resolve(sourcePath), 'utf8')))
    : await fetchStats(statsUrl, { fetchImpl });
  const [chinese, english] = await Promise.all([
    readFile(resolve(chineseReadmePath), 'utf8'),
    readFile(resolve(englishReadmePath), 'utf8'),
  ]);
  await Promise.all([
    writeFile(resolve(chineseReadmePath), replaceStatsBlock(chinese, renderChineseStats(stats))),
    writeFile(resolve(englishReadmePath), replaceStatsBlock(english, renderEnglishStats(stats))),
    writeFile(resolve(snapshotPath), `${JSON.stringify(stats, null, 2)}\n`),
  ]);
  return stats;
}

function sourceArgument(argv) {
  const index = argv.indexOf('--source');
  if (index === -1) return undefined;
  if (!argv[index + 1]) throw new Error('--source requires a local JSON path');
  return argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncRegistryStats({ sourcePath: sourceArgument(process.argv.slice(2)) }).then((stats) => {
    console.log(`registry-stats: synced ${stats.registryCount} registry / ${stats.marketCount} market connectors`);
  }).catch((error) => {
    console.error(`registry-stats: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
