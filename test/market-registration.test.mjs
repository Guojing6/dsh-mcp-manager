import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessRegistration,
  findRegistryPlugin,
  normalizeRepository,
  registryPlugins,
} from '../scripts/check-market-registration.mjs';

const expected = {
  expectedName: 'dsh-mcp-manager',
  expectedRepository: 'https://github.com/Guojing6/dsh-mcp-manager',
};
// normalizeRepository 统一小写以做大小写不敏感比较（owner 现在是混合大小写的 Guojing6）
const normalizedRepository = 'https://github.com/guojing6/dsh-mcp-manager';

test('规范化 GitHub 仓库地址', () => {
  assert.equal(normalizeRepository('git+https://github.com/Guojing6/dsh-mcp-manager.git'), normalizedRepository);
  assert.equal(normalizeRepository('https://github.com/Guojing6/dsh-mcp-manager/'), normalizedRepository);
});

test('兼容官网 plugins.json 与 DSH Market 包装格式', () => {
  const plugin = { name: expected.expectedName, url: expected.expectedRepository };
  assert.deepEqual(registryPlugins({ plugins: [plugin] }), [plugin]);
  assert.deepEqual(registryPlugins({ registry: { plugins: [plugin] } }), [plugin]);
  assert.equal(findRegistryPlugin({ plugins: [plugin] }, expected), plugin);
});

test('PR 未合并时保持等待且不误报失败', () => {
  const result = assessRegistration({ pullRequest: { state: 'open', merged_at: null }, ...expected });
  assert.equal(result.status, 'awaiting-merge');
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
});

test('PR 已合并但目录未同步时进入待同步状态', () => {
  const result = assessRegistration({
    pullRequest: { state: 'closed', merged_at: '2026-08-22T00:00:00Z' },
    registrationText: `name: duhu2000/${expected.expectedName}\nurl: ${expected.expectedRepository}`,
    registry: { plugins: [] },
    ...expected,
  });
  assert.equal(result.status, 'awaiting-directory-sync');
  assert.equal(result.ok, false);
  assert.equal(result.checks.registrationPresent, true);
  assert.equal(result.checks.directoryPresent, false);
});

test('YAML 和 plugins.json 均生效后验收通过', () => {
  const result = assessRegistration({
    pullRequest: { state: 'closed', merged_at: '2026-08-22T00:00:00Z' },
    registrationText: `name: ${expected.expectedName}\nrepository: ${expected.expectedRepository}.git`,
    registry: { plugins: [{ name: expected.expectedName, url: expected.expectedRepository, npm: expected.expectedName }] },
    ...expected,
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.ok, true);
  assert.equal(result.plugin?.npm, expected.expectedName);
});

test('PR 关闭但未合并时明确失败', () => {
  const result = assessRegistration({ pullRequest: { state: 'closed', merged_at: null }, ...expected });
  assert.equal(result.status, 'closed-without-merge');
  assert.equal(result.ok, false);
  assert.equal(result.pending, false);
});
