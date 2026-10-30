import { beforeEach, describe, expect, it, vi } from 'vitest';

// 测试价值
// - 生产入口与可观察结果：fillFormViaPlaywright（外置浏览器 act kind=fill 的多字段路径）；
//   任一字段是密码／验证码框时抛错，且一个字段都不写入。
// - 规则依据：docs/product-rules/input-handoff.md §1、§2.1（密码、验证码由主人经代输入填写，
//   值不进模型）；补丁见 scripts/browser-runtime/sync.mjs LOCAL_PATCHES。
// - 现有覆盖缺口：interaction-proxy-policy.test.ts 只覆盖导航与代理策略，不覆盖填写目标。
// - 最小失败输入：fields 第二项指向 <input type="password">。
// - tier：unit（mock pw-session 的 refLocator／getPageForTargetId，不启动浏览器）。

const mocks = vi.hoisted(() => ({
  getPageForTargetId: vi.fn(),
  refLocator: vi.fn(),
}));

vi.mock('../_generated/extension/src/browser/pw-session.js', () => ({
  assertPageNavigationCompletedSafely: vi.fn(async () => undefined),
  closeBlockedNavigationTarget: vi.fn(async () => undefined),
  quarantineTargetWithoutClosing: vi.fn(async () => undefined),
  createObservedDialogAbortSignalForPage: () => ({ signal: undefined, cleanup: vi.fn() }),
  ensurePageState: vi.fn(),
  forceDisconnectPlaywrightForTarget: vi.fn(async () => undefined),
  getPageForTargetId: mocks.getPageForTargetId,
  isBrowserObservedDialogBlockedError: () => false,
  markObservedDialogsHandledRemotelyForPage: vi.fn(),
  refLocator: mocks.refLocator,
  restoreRoleRefsForTarget: vi.fn(),
}));

import { fillFormViaPlaywright } from '../_generated/extension/src/browser/pw-tools-core.interactions.js';

function fakeField(secret: boolean) {
  return { evaluate: vi.fn(async () => secret), fill: vi.fn(async () => undefined), setChecked: vi.fn() };
}

describe('external multi-field fill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPageForTargetId.mockResolvedValue({ url: () => 'https://example.com/form', on: vi.fn(), off: vi.fn() });
  });

  it('throws before typing anything when any field is a secret input', async () => {
    const name = fakeField(false);
    const password = fakeField(true);
    mocks.refLocator.mockImplementation((_page: unknown, ref: string) => (ref === 'e1' ? name : password));
    await expect(fillFormViaPlaywright({
      cdpUrl: 'http://127.0.0.1:18800',
      targetId: 'page-1',
      fields: [{ ref: 'e1', type: 'text', value: 'Ada' }, { ref: 'e2', type: 'text', value: 'x' }],
    })).rejects.toThrow('request_input_handoff');
    expect(name.fill).not.toHaveBeenCalled();
    expect(password.fill).not.toHaveBeenCalled();
  });

  it('fills normally when no field is secret', async () => {
    const first = fakeField(false);
    const second = fakeField(false);
    mocks.refLocator.mockImplementation((_page: unknown, ref: string) => (ref === 'e1' ? first : second));
    await fillFormViaPlaywright({
      cdpUrl: 'http://127.0.0.1:18800',
      targetId: 'page-1',
      fields: [{ ref: 'e1', type: 'text', value: 'Ada' }, { ref: 'e2', type: 'text', value: 'Lovelace' }],
    });
    expect(first.fill).toHaveBeenCalledWith('Ada', expect.anything());
    expect(second.fill).toHaveBeenCalledWith('Lovelace', expect.anything());
  });
});
