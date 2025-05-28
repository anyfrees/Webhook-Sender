// electron-vite.config.js

// 使用 CommonJS 模块导入，与项目默认模块系统保持一致
const { resolve } = require('path');
const { defineConfig, externalizeDeps } = require('electron-vite');

module.exports = defineConfig({
  main: {
    entry: 'electron/main.js', // 显式指定主进程入口文件
    plugins: [externalizeDeps()]
  },
  preload: {
    entry: 'electron/preload.js', // 显式指定预加载脚本入口文件
    plugins: [externalizeDeps()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/') // 确保 @ 别名指向 src 目录
      }
    },
    plugins: [] // 渲染器不需要额外插件 (因为我们用的是原生JS)
  }
});
