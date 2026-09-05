// 仅由隔离测试进程预加载，不进入应用运行代码。
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ["2026-09-07T00:29:00.000Z"])); }
  static now() { return new RealDate("2026-09-07T00:29:00.000Z").getTime(); }
};
