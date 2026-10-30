import { beforeEach, describe, expect, it, vi } from 'vitest';

// 测试价值
// - 生产入口与可观察结果：createBrowserControlRuntime().call({ action: 'act' })；嵌套
//   request.targetId 指向另一个标签页时返回 INVALID_REQUEST，且不派发 /act。
// - Bug／规则依据：planDispatch 把 request.targetId ?? targetId 合并成一个值交给 /act，
//   外置浏览器的 resolveActionTargetIds 因此看不到冲突，动作落在嵌套指定的标签页上；
//   内置浏览器已拒绝同类冲突（rsb-webview-backend handleAct）。
// - 现有覆盖缺口：runtime.test.ts 只覆盖 shim 的别名归一，不经过 runtime.call 的合并。
// - 最小失败输入：{ targetId: 'checkout', request: { targetId: 'RAW-B' } }。
// - tier：unit（mock 进程内 dispatcher，不启动浏览器）。
// - 实测耗时：见 PR 描述。

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../_generated/extension/src/browser/local-dispatch.runtime.js', () => ({
  dispatchBrowserControlRequest: dispatch,
}));

import { createBrowserControlRuntime } from '../runtime.js';

const TABS = {
  status: 200,
  body: { tabs: [{ targetId: 'RAW-A', label: 'checkout' }, { targetId: 'RAW-B', label: 'account-b' }] },
};

const act = (outer?: string, inner?: string) =>
  ({ action: 'act', targetId: outer, request: { kind: 'click', ref: 'e1', targetId: inner } }) as never;
const callsTo = (path: string) =>
  dispatch.mock.calls.filter(([req]) => (req as { path: string }).path === path);

describe('act with a nested targetId', () => {
  beforeEach(() => {
    dispatch.mockReset();
    dispatch.mockImplementation(async (req: { path: string }) =>
      req.path === '/tabs' ? TABS : { status: 200, body: { ok: true } });
  });

  it('refuses a nested target that is a different tab, without acting', async () => {
    const res = await createBrowserControlRuntime().call(act('checkout', 'RAW-B'));
    expect(res).toMatchObject({ ok: false, errorCode: 'BROWSER_RUNTIME_INVALID_REQUEST' });
    expect(callsTo('/act')).toHaveLength(0);
  });

  it('allows a label and a raw id that name the same tab', async () => {
    const res = await createBrowserControlRuntime().call(act('checkout', 'RAW-A'));
    expect(res.ok).toBe(true);
    expect(callsTo('/act')).toHaveLength(1);
    expect(callsTo('/act')[0][0]).toMatchObject({ body: { targetId: 'RAW-A' } });
  });

  it.each([
    ['an unknown nested target', TABS, 'missing'],
    ['a failed tab list', { status: 500, body: { error: 'down' } }, 'RAW-A'],
  ])('fails closed on %s', async (_label, tabs, inner) => {
    dispatch.mockImplementation(async (req: { path: string }) =>
      req.path === '/tabs' ? tabs : { status: 200, body: { ok: true } });
    const res = await createBrowserControlRuntime().call(act('checkout', inner));
    expect(res).toMatchObject({ ok: false, errorCode: 'BROWSER_RUNTIME_INVALID_REQUEST' });
    expect(callsTo('/act')).toHaveLength(0);
  });

  it.each([[undefined, 'RAW-A'], ['RAW-A', undefined], ['RAW-A', 'RAW-A']])(
    'does not list tabs when only one or matching ids are given (%s, %s)',
    async (outer, inner) => {
      const res = await createBrowserControlRuntime().call(act(outer, inner));
      expect(res.ok).toBe(true);
      expect(callsTo('/tabs')).toHaveLength(0);
      expect(callsTo('/act')).toHaveLength(1);
    },
  );
});
