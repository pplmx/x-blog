module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // 新功能
        'fix',      // bug 修复
        'docs',     // 文档更新
        'style',    // 代码格式
        'refactor', // 代码重构
        'perf',     // 性能优化
        'test',     // 测试
        'chore',    // 其他更新
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
  },
};